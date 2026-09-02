import { sha256 } from "./hash";
import { taskSchema, type Task } from "./task";

function iso(date: Date) { return date.toISOString(); }

function activePaperRoute(task: Task) {
  return { ...task.paper_route, state: "working" as const, next_retry_at: null, reason: null, error_code: null };
}

function readyPaperRoute(task: Task) {
  return { ...task.paper_route, state: "ready" as const, retry_count: 0, next_retry_at: null, reason: null, error_code: null, provider: null, used_fallback: false };
}

export function claimForWork(task: Task, did: string, leaseSeconds: number, now = new Date()): Task {
  const expired = task.status === "running" && task.worker_lease_until !== null && new Date(task.worker_lease_until) < now;
  if (task.status !== "open" && !expired) throw new Error("Task is not claimable");
  if (task.attempt >= task.max_attempts) throw new Error("Task has exhausted its attempts");
  return taskSchema.parse({ ...task, status: "running", attempt: task.attempt + 1, updated_at: iso(now), worker_did: did, worker_claimed_at: iso(now), worker_lease_until: iso(new Date(now.getTime() + leaseSeconds * 1000)), reviewer_did: null, reviewer_claimed_at: null, reviewer_lease_until: null, review_decision: null, paper_route: activePaperRoute(task) });
}

export function renewWorkerLease(task: Task, did: string, leaseSeconds: number, now = new Date()): Task {
  if (task.status !== "running" || task.worker_did !== did) throw new Error("Worker no longer owns this task");
  return taskSchema.parse({ ...task, updated_at: iso(now), worker_lease_until: iso(new Date(now.getTime() + leaseSeconds * 1000)) });
}

export function submitResult(task: Task, did: string, result: string, now = new Date()): Task {
  if (task.status !== "running" || task.worker_did !== did) throw new Error("Worker no longer owns this task");
  const safeResult = result.length <= 3500 ? result : `${result.slice(0, 3479)}\n[result truncated]`;
  return taskSchema.parse({ ...task, status: task.requires_review ? "review" : "done", updated_at: iso(now), worker_lease_until: null, result: safeResult, result_sha256: sha256(safeResult), reviewer_did: null, reviewer_claimed_at: null, reviewer_lease_until: null, paper_route: readyPaperRoute(task) });
}

export function claimForReview(task: Task, did: string, leaseSeconds: number, now = new Date()): Task {
  const expired = task.status === "review" && task.reviewer_did !== null && task.reviewer_lease_until !== null && new Date(task.reviewer_lease_until) < now;
  if (task.status !== "review" || (task.reviewer_did !== null && !expired) || !task.result_sha256) throw new Error("Task is not reviewable");
  return taskSchema.parse({ ...task, updated_at: iso(now), reviewer_did: did, reviewer_claimed_at: iso(now), reviewer_lease_until: iso(new Date(now.getTime() + leaseSeconds * 1000)), paper_route: activePaperRoute(task) });
}

export function approveTask(task: Task, did: string, now = new Date()): Task {
  if (task.status !== "review" || task.reviewer_did !== did) throw new Error("Reviewer no longer owns this task");
  return taskSchema.parse({ ...task, status: "done", updated_at: iso(now), reviewer_lease_until: null, review_decision: "approved", review_feedback: null, paper_route: readyPaperRoute(task) });
}

export function requestChanges(task: Task, did: string, feedback: string, now = new Date()): Task {
  if (task.status !== "review" || task.reviewer_did !== did) throw new Error("Reviewer no longer owns this task");
  const exhausted = task.attempt >= task.max_attempts;
  return taskSchema.parse({
    ...task,
    status: exhausted ? "failed" : "open",
    updated_at: iso(now),
    previous_result: task.result,
    worker_did: exhausted ? task.worker_did : null,
    worker_claimed_at: exhausted ? task.worker_claimed_at : null,
    worker_lease_until: null,
    reviewer_lease_until: null,
    review_decision: "changes_requested",
    review_feedback: feedback.slice(0, 1000),
    paper_route: readyPaperRoute(task)
  });
}

export function failTask(task: Task, now = new Date()): Task {
  if (task.status !== "running" && task.status !== "review") throw new Error("Only active tasks can fail");
  return taskSchema.parse({ ...task, status: "failed", updated_at: iso(now), worker_lease_until: null, reviewer_lease_until: null, paper_route: { ...task.paper_route, state: "exhausted", next_retry_at: null } });
}

function safeResult(result: string) {
  return result.length <= 3500 ? result : `${result.slice(0, 3479)}\n[result truncated]`;
}

type OfficeSteps = NonNullable<Task["office"]>["steps"];

function stageOutput(steps: OfficeSteps, stage: number) {
  const outputs = steps.filter((step) => step.stage === stage && step.output).map((step) => `${step.label} — ${step.name}\n${step.output}`);
  return safeResult(outputs.join("\n\n--- BRANCH HANDOFF ---\n\n"));
}

function finishStage(task: Task, steps: OfficeSteps, completedIndex: number, now: Date): Task {
  if (!task.office) throw new Error("Task has no office workflow");
  const completedStage = steps[completedIndex]!.stage;
  const stageMembers = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.stage === completedStage);
  const nextRunnable = stageMembers.find(({ step }) => step.status === "pending" || step.status === "changes_requested");
  if (nextRunnable) return taskSchema.parse({ ...task, status: "open", updated_at: iso(now), worker_did: null, worker_claimed_at: null, worker_lease_until: null, reviewer_did: null, reviewer_claimed_at: null, reviewer_lease_until: null, paper_route: readyPaperRoute(task), office: { ...task.office, current_step: nextRunnable.index, steps } });
  const awaiting = stageMembers.find(({ step }) => step.status === "awaiting_approval");
  if (awaiting) return taskSchema.parse({ ...task, status: "open", updated_at: iso(now), worker_did: null, worker_claimed_at: null, worker_lease_until: null, reviewer_did: null, reviewer_claimed_at: null, reviewer_lease_until: null, paper_route: { ...readyPaperRoute(task), state: "waiting", reason: `Boss approval required for ${awaiting.step.label}` }, office: { ...task.office, current_step: awaiting.index, steps } });
  const nextIndex = steps.findIndex((step) => step.stage > completedStage);
  const result = stageMembers.length > 1 ? stageOutput(steps, completedStage) || task.result : task.result;
  if (nextIndex < 0) return taskSchema.parse({ ...task, status: "done", updated_at: iso(now), worker_did: null, worker_claimed_at: null, worker_lease_until: null, reviewer_did: null, reviewer_claimed_at: null, reviewer_lease_until: null, result, result_sha256: result ? sha256(result) : task.result_sha256, paper_route: readyPaperRoute(task), office: { ...task.office, current_step: completedIndex, steps } });
  const next = steps[nextIndex]!;
  return taskSchema.parse({ ...task, status: next.kind === "review" ? "review" : "open", role: next.kind === "work" && next.role !== "reviewer" ? next.role : task.role, updated_at: iso(now), worker_did: null, worker_claimed_at: null, worker_lease_until: null, reviewer_did: null, reviewer_claimed_at: null, reviewer_lease_until: null, review_decision: null, review_feedback: null, previous_result: task.result, result, result_sha256: result ? sha256(result) : task.result_sha256, paper_route: readyPaperRoute(task), office: { ...task.office, current_step: nextIndex, steps } });
}

export function claimOfficeStep(task: Task, did: string, leaseSeconds: number, now = new Date(), requestedStep = task.office?.current_step): Task {
  if (!task.office) throw new Error("Task has no office workflow");
  if (requestedStep === undefined) throw new Error("Workflow step is missing");
  const activeStage = task.office.steps[task.office.current_step]?.stage;
  const step = task.office.steps[requestedStep];
  if (!step || step.agent_did !== did) throw new Error("This task is assigned to another employee");
  if (step.stage !== activeStage || (step.status !== "pending" && step.status !== "changes_requested")) throw new Error("Workflow step is not active");
  const claimed = step.kind === "review" ? claimForReview(task, did, leaseSeconds, now) : taskSchema.parse({ ...task, status: "running", attempt: task.attempt + 1, updated_at: iso(now), worker_did: did, worker_claimed_at: iso(now), worker_lease_until: iso(new Date(now.getTime() + leaseSeconds * 1000)), reviewer_did: null, reviewer_claimed_at: null, reviewer_lease_until: null, review_decision: null, paper_route: activePaperRoute(task) });
  const steps = claimed.office!.steps.map((value, index) => index === requestedStep ? { ...value, status: "running" as const } : value);
  return taskSchema.parse({ ...claimed, office: { ...claimed.office, current_step: requestedStep, steps } });
}

export function completeOfficeWork(task: Task, did: string, result: string, now = new Date()): Task {
  if (!task.office) throw new Error("Task has no office workflow");
  const currentIndex = task.office.current_step;
  const current = task.office.steps[currentIndex];
  if (!current || current.kind !== "work" || current.agent_did !== did || task.status !== "running" || task.worker_did !== did) throw new Error("Employee no longer owns this workflow step");
  const output = safeResult(result);
  const stepOutput = output.length <= 1200 ? output : `${output.slice(0, 1179)}\n[handoff truncated]`;
  const outputHash = sha256(output);
  const steps = task.office.steps.map((step, index) => index === currentIndex ? { ...step, status: step.requires_approval ? "awaiting_approval" as const : "done" as const, output: stepOutput, output_sha256: outputHash, feedback: null } : step);
  return finishStage({ ...task, result: task.office.steps.filter((step) => step.stage === current.stage).length === 1 ? output : task.result, result_sha256: task.office.steps.filter((step) => step.stage === current.stage).length === 1 ? outputHash : task.result_sha256 } as Task, steps, currentIndex, now);
}

export function finishOfficeReview(task: Task, did: string, decision: { approved: true } | { approved: false; feedback: string }, now = new Date()): Task {
  if (!task.office) throw new Error("Task has no office workflow");
  const currentIndex = task.office.current_step;
  const current = task.office.steps[currentIndex];
  if (!current || current.kind !== "review" || current.agent_did !== did || task.status !== "review" || task.reviewer_did !== did || !task.result_sha256) throw new Error("Reviewer no longer owns this workflow step");
  if (decision.approved) {
    const steps = task.office.steps.map((step, index) => index === currentIndex ? { ...step, status: "done" as const, output_sha256: task.result_sha256, feedback: null } : step);
    return taskSchema.parse({ ...task, status: "done", updated_at: iso(now), reviewer_lease_until: null, review_decision: "approved", review_feedback: null, paper_route: readyPaperRoute(task), office: { ...task.office, steps } });
  }
  const feedback = decision.feedback.slice(0, 500) || "The result needs revision.";
  const previousIndex = task.office.rejection_target_step ?? task.office.steps.map((step, index) => ({ step, index })).filter(({ step, index }) => index < currentIndex && step.kind === "work").at(-1)?.index;
  const previous = previousIndex === undefined ? undefined : task.office.steps[previousIndex];
  if (!previous || previous.kind !== "work" || previous.role === "reviewer") throw new Error("Review step has no work step to return to");
  const revisionCount = previous.revision_count + 1;
  const exhausted = revisionCount > previous.max_revisions;
  const steps = task.office.steps.map((step, index) => index === currentIndex
    ? { ...step, status: "pending" as const, feedback, output: null, output_sha256: null }
    : index === previousIndex ? { ...step, status: "changes_requested" as const, revision_count: revisionCount, feedback }
      : step.stage > previous.stage ? { ...step, status: "pending" as const, output: null, output_sha256: null, feedback: null } : step);
  const priorStage = previous.stage - 1;
  const priorResult = priorStage >= 0 ? stageOutput(steps, priorStage) || null : null;
  return taskSchema.parse({
    ...task,
    status: exhausted ? "failed" : "open",
    role: previous.role,
    updated_at: iso(now),
    worker_did: exhausted ? task.worker_did : null,
    worker_claimed_at: exhausted ? task.worker_claimed_at : null,
    worker_lease_until: null,
    reviewer_lease_until: null,
    review_decision: "changes_requested",
    review_feedback: feedback,
    previous_result: task.result,
    result: priorResult,
    result_sha256: priorResult ? sha256(priorResult) : null,
    paper_route: exhausted ? { ...task.paper_route, state: "exhausted", reason: `${previous.label} exceeded its revision limit`, error_code: "REVISION_LIMIT", next_retry_at: null } : readyPaperRoute(task),
    office: { ...task.office, current_step: previousIndex, steps }
  });
}

export function approveOfficeCheckpoint(task: Task, stepIndex: number, now = new Date()): Task {
  if (!task.office) throw new Error("Task has no office workflow");
  const step = task.office.steps[stepIndex];
  if (!step || step.status !== "awaiting_approval") throw new Error("Checkpoint is not waiting for approval");
  const steps = task.office.steps.map((value, index) => index === stepIndex ? { ...value, status: "done" as const, feedback: null } : value);
  return finishStage(task, steps, stepIndex, now);
}

export function rejectOfficeCheckpoint(task: Task, stepIndex: number, feedback: string, now = new Date()): Task {
  if (!task.office) throw new Error("Task has no office workflow");
  const step = task.office.steps[stepIndex];
  if (!step || step.status !== "awaiting_approval" || step.kind !== "work") throw new Error("Checkpoint is not waiting for approval");
  const revisionCount = step.revision_count + 1;
  const exhausted = revisionCount > step.max_revisions;
  const safeFeedback = feedback.slice(0, 500) || "The boss requested another revision.";
  const steps = task.office.steps.map((value, index) => index === stepIndex ? { ...value, status: "changes_requested" as const, revision_count: revisionCount, feedback: safeFeedback } : value);
  return taskSchema.parse({ ...task, status: exhausted ? "failed" : "open", role: step.role === "reviewer" ? task.role : step.role, updated_at: iso(now), worker_did: null, worker_claimed_at: null, worker_lease_until: null, reviewer_did: null, reviewer_claimed_at: null, reviewer_lease_until: null, review_feedback: safeFeedback, previous_result: task.result, paper_route: exhausted ? { ...task.paper_route, state: "exhausted", reason: `${step.label} exceeded its revision limit`, error_code: "REVISION_LIMIT", next_retry_at: null } : readyPaperRoute(task), office: { ...task.office, current_step: stepIndex, steps } });
}

export function deferOfficeStep(task: Task, input: { reason: string; errorCode: string; provider?: string; retryable: boolean; usedFallback?: boolean }, now = new Date()): Task {
  if (!task.office || task.status === "done" || task.status === "failed") throw new Error("Only an unfinished office step can be deferred");
  const retryCount = task.paper_route.retry_count + 1;
  const exhausted = input.retryable && retryCount >= task.paper_route.max_retries;
  const delaySeconds = Math.min(900, task.paper_route.base_retry_seconds * (2 ** Math.max(0, retryCount - 1)));
  const nextRetry = input.retryable && !exhausted ? iso(new Date(now.getTime() + delaySeconds * 1000)) : null;
  return taskSchema.parse({
    ...task,
    status: exhausted ? "failed" : task.status,
    updated_at: iso(now),
    worker_lease_until: null,
    reviewer_lease_until: null,
    paper_route: {
      ...task.paper_route,
      state: exhausted ? "exhausted" : input.retryable ? "retrying" : "blocked",
      retry_count: retryCount,
      next_retry_at: nextRetry,
      reason: input.reason.slice(0, 300),
      error_code: input.errorCode.slice(0, 50),
      provider: input.provider?.slice(0, 30) ?? null,
      used_fallback: Boolean(input.usedFallback)
    }
  });
}

export function markOfficeWaiting(task: Task, reason: string, now = new Date()): Task {
  if (!task.office || task.status === "done" || task.status === "failed") return task;
  return taskSchema.parse({ ...task, updated_at: iso(now), paper_route: { ...task.paper_route, state: "waiting", next_retry_at: null, reason: reason.slice(0, 300), error_code: null } });
}

export function resumeOfficeStep(task: Task, did: string, leaseSeconds: number, now = new Date()): Task {
  if (!task.office || task.paper_route.state !== "retrying") throw new Error("Paper route is not waiting for a retry");
  if (task.paper_route.next_retry_at && new Date(task.paper_route.next_retry_at) > now) throw new Error("Paper route retry is not due yet");
  const current = task.office.steps[task.office.current_step];
  if (!current || current.agent_did !== did) throw new Error("This retry belongs to another employee");
  if (current.kind === "review" && (task.status !== "review" || task.reviewer_did !== did)) throw new Error("Reviewer no longer owns this retry");
  if (current.kind === "work" && (task.status !== "running" || task.worker_did !== did)) throw new Error("Worker no longer owns this retry");
  const leaseUntil = iso(new Date(now.getTime() + leaseSeconds * 1000));
  return taskSchema.parse({ ...task, updated_at: iso(now), worker_lease_until: current.kind === "work" ? leaseUntil : task.worker_lease_until, reviewer_lease_until: current.kind === "review" ? leaseUntil : task.reviewer_lease_until, paper_route: activePaperRoute(task) });
}

export function recoverOfficeTask(task: Task, now = new Date()): Task {
  if (!task.office) throw new Error("Task has no office workflow");
  if (!["waiting", "retrying", "blocked", "exhausted"].includes(task.paper_route.state)) throw new Error("Task does not need recovery");
  if (task.paper_route.error_code === "REVISION_LIMIT") throw new Error("The workflow revision limit is final. Start a new task or create a workflow with a larger revision allowance.");
  const currentIndex = task.office.current_step;
  const current = task.office.steps[currentIndex];
  if (!current) throw new Error("Task workflow step is missing");
  const steps = task.office.steps.map((step, index) => index === currentIndex ? { ...step, status: step.status === "changes_requested" ? "changes_requested" as const : "pending" as const } : step);
  return taskSchema.parse({
    ...task,
    status: current.kind === "review" ? "review" : "open",
    updated_at: iso(now),
    worker_did: current.kind === "work" ? null : task.worker_did,
    worker_claimed_at: current.kind === "work" ? null : task.worker_claimed_at,
    worker_lease_until: null,
    reviewer_did: null,
    reviewer_claimed_at: null,
    reviewer_lease_until: null,
    paper_route: readyPaperRoute(task),
    office: { ...task.office, steps }
  });
}
