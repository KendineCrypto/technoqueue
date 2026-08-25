import { sha256 } from "./hash";
import { taskSchema, type Task } from "./task";

function iso(date: Date) { return date.toISOString(); }

export function claimForWork(task: Task, did: string, leaseSeconds: number, now = new Date()): Task {
  const expired = task.status === "running" && task.worker_lease_until !== null && new Date(task.worker_lease_until) < now;
  if (task.status !== "open" && !expired) throw new Error("Task is not claimable");
  if (task.attempt >= task.max_attempts) throw new Error("Task has exhausted its attempts");
  return taskSchema.parse({ ...task, status: "running", attempt: task.attempt + 1, updated_at: iso(now), worker_did: did, worker_claimed_at: iso(now), worker_lease_until: iso(new Date(now.getTime() + leaseSeconds * 1000)), reviewer_did: null, reviewer_claimed_at: null, reviewer_lease_until: null, review_decision: null });
}

export function renewWorkerLease(task: Task, did: string, leaseSeconds: number, now = new Date()): Task {
  if (task.status !== "running" || task.worker_did !== did) throw new Error("Worker no longer owns this task");
  return taskSchema.parse({ ...task, updated_at: iso(now), worker_lease_until: iso(new Date(now.getTime() + leaseSeconds * 1000)) });
}

export function submitResult(task: Task, did: string, result: string, now = new Date()): Task {
  if (task.status !== "running" || task.worker_did !== did) throw new Error("Worker no longer owns this task");
  const safeResult = result.length <= 3500 ? result : `${result.slice(0, 3479)}\n[result truncated]`;
  return taskSchema.parse({ ...task, status: task.requires_review ? "review" : "done", updated_at: iso(now), worker_lease_until: null, result: safeResult, result_sha256: sha256(safeResult), reviewer_did: null, reviewer_claimed_at: null, reviewer_lease_until: null });
}

export function claimForReview(task: Task, did: string, leaseSeconds: number, now = new Date()): Task {
  const expired = task.status === "review" && task.reviewer_did !== null && task.reviewer_lease_until !== null && new Date(task.reviewer_lease_until) < now;
  if (task.status !== "review" || (task.reviewer_did !== null && !expired) || !task.result_sha256) throw new Error("Task is not reviewable");
  return taskSchema.parse({ ...task, updated_at: iso(now), reviewer_did: did, reviewer_claimed_at: iso(now), reviewer_lease_until: iso(new Date(now.getTime() + leaseSeconds * 1000)) });
}

export function approveTask(task: Task, did: string, now = new Date()): Task {
  if (task.status !== "review" || task.reviewer_did !== did) throw new Error("Reviewer no longer owns this task");
  return taskSchema.parse({ ...task, status: "done", updated_at: iso(now), reviewer_lease_until: null, review_decision: "approved", review_feedback: null });
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
    review_feedback: feedback.slice(0, 1000)
  });
}

export function failTask(task: Task, now = new Date()): Task {
  if (task.status !== "running" && task.status !== "review") throw new Error("Only active tasks can fail");
  return taskSchema.parse({ ...task, status: "failed", updated_at: iso(now), worker_lease_until: null, reviewer_lease_until: null });
}

function safeResult(result: string) {
  return result.length <= 3500 ? result : `${result.slice(0, 3479)}\n[result truncated]`;
}

export function claimOfficeStep(task: Task, did: string, leaseSeconds: number, now = new Date()): Task {
  if (!task.office) throw new Error("Task has no office workflow");
  const step = task.office.steps[task.office.current_step];
  if (!step || step.agent_did !== did) throw new Error("This task is assigned to another employee");
  const claimed = step.kind === "review" ? claimForReview(task, did, leaseSeconds, now) : claimForWork(task, did, leaseSeconds, now);
  const steps = claimed.office!.steps.map((value, index) => index === claimed.office!.current_step ? { ...value, status: "running" as const } : value);
  return taskSchema.parse({ ...claimed, office: { ...claimed.office, steps } });
}

export function completeOfficeWork(task: Task, did: string, result: string, now = new Date()): Task {
  if (!task.office) throw new Error("Task has no office workflow");
  const currentIndex = task.office.current_step;
  const current = task.office.steps[currentIndex];
  if (!current || current.kind !== "work" || current.agent_did !== did || task.status !== "running" || task.worker_did !== did) throw new Error("Employee no longer owns this workflow step");
  const output = safeResult(result);
  const outputHash = sha256(output);
  const steps = task.office.steps.map((step, index) => index === currentIndex ? { ...step, status: "done" as const, output_sha256: outputHash, feedback: null } : step);
  const next = steps[currentIndex + 1];
  if (!next) return taskSchema.parse({ ...task, status: "done", updated_at: iso(now), worker_lease_until: null, result: output, result_sha256: outputHash, office: { ...task.office, steps } });
  const nextStatus = next.kind === "review" ? "review" : "open";
  return taskSchema.parse({
    ...task,
    status: nextStatus,
    role: next.kind === "work" && next.role !== "reviewer" ? next.role : task.role,
    updated_at: iso(now),
    worker_did: next.kind === "work" ? null : did,
    worker_claimed_at: next.kind === "work" ? null : task.worker_claimed_at,
    worker_lease_until: null,
    reviewer_did: null,
    reviewer_claimed_at: null,
    reviewer_lease_until: null,
    review_decision: null,
    review_feedback: null,
    previous_result: task.result,
    result: output,
    result_sha256: outputHash,
    office: { ...task.office, current_step: currentIndex + 1, steps }
  });
}

export function finishOfficeReview(task: Task, did: string, decision: { approved: true } | { approved: false; feedback: string }, now = new Date()): Task {
  if (!task.office) throw new Error("Task has no office workflow");
  const currentIndex = task.office.current_step;
  const current = task.office.steps[currentIndex];
  if (!current || current.kind !== "review" || current.agent_did !== did || task.status !== "review" || task.reviewer_did !== did || !task.result_sha256) throw new Error("Reviewer no longer owns this workflow step");
  if (decision.approved) {
    const steps = task.office.steps.map((step, index) => index === currentIndex ? { ...step, status: "done" as const, output_sha256: task.result_sha256, feedback: null } : step);
    return taskSchema.parse({ ...task, status: "done", updated_at: iso(now), reviewer_lease_until: null, review_decision: "approved", review_feedback: null, office: { ...task.office, steps } });
  }
  const feedback = decision.feedback.slice(0, 500) || "The result needs revision.";
  const previousIndex = currentIndex - 1;
  const previous = task.office.steps[previousIndex];
  const exhausted = task.attempt >= task.max_attempts;
  if (!previous || previous.kind !== "work" || previous.role === "reviewer") throw new Error("Review step has no work step to return to");
  const steps = task.office.steps.map((step, index) => index === currentIndex
    ? { ...step, status: "pending" as const, feedback }
    : index === previousIndex ? { ...step, status: "changes_requested" as const, feedback } : step);
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
    office: { ...task.office, current_step: previousIndex, steps }
  });
}
