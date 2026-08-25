import {
  TechnocoreRateLimitError,
  TechnocoreTimeoutError,
  TechnocoreUnavailableError,
  analyzeIntegrity,
  taskIdSchema,
  workspaceSchema
} from "@technoqueue/core";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Check, CircleAlert, CircleDashed, ExternalLink } from "lucide-react";
import { queueForSlug } from "@/lib/workspace-technocore";
import { currentUser, ownedWorkspace } from "@/lib/auth";
import { verifiedRecord } from "@/lib/technocore-integrity";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ workspace: string; taskId: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { const { taskId } = await params; return { title: taskId.toUpperCase() }; }
function shortDid(did: string) { return `${did.slice(0, 22)}…${did.slice(-8)}`; }
const labels = { valid: "Attested · hash matches", mismatch: "Integrity mismatch", unavailable: "Attestation unavailable", not_applicable: "Not applicable" } as const;
function Attestation({ state, subject }: { state: keyof typeof labels; subject: string }) { const Icon = state === "valid" ? Check : state === "mismatch" ? CircleAlert : CircleDashed; return <div className={`attestation ${state}`}><Icon size={13}/><span>{subject}: {labels[state]}</span></div>; }

export default async function TaskPage({ params }: Props) {
  const values = await params; const ws = workspaceSchema.safeParse(values.workspace); const id = taskIdSchema.safeParse(values.taskId); if (!ws.success || !id.success) notFound();
  const user = await currentUser(); if (!user) redirect("/login");
  const owned = await ownedWorkspace(ws.data, user.id).catch(() => notFound());
  const queue = queueForSlug(ws.data);
  const [taskResult, eventResult] = await Promise.allSettled([verifiedRecord(owned, id.data, "task", queue.client), queue.listEvents()]);
  if (taskResult.status === "rejected") {
    if (isTransientTechnocoreError(taskResult.reason)) return <TaskUnavailable workspace={ws.data} taskId={id.data}/>;
    throw taskResult.reason;
  }
  const stored = taskResult.value;
  const events = eventResult.status === "fulfilled" ? eventResult.value : [];
  const eventHistoryUnavailable = eventResult.status === "rejected";
  const task = stored.value; const integrity = analyzeIntegrity(task, events); const relevant = events.filter((item) => item.event.task_id === task.id); const workerEvent = [...relevant].reverse().find((item) => item.event.type === "task_submitted" || item.event.type === "office_step_completed"); const reviewEvent = [...relevant].reverse().find((item) => item.event.type === "task_approved");
  return <main className="detail-shell">
    <header className="proof-head"><div><div className="eyebrow">Owner-only verified view / {task.id.toUpperCase()}</div><h1>{task.title}</h1></div><span className="status-pill">{task.status}</span></header>
    {eventHistoryUnavailable && <div className="degraded-banner"><span>Technocore activity is temporarily unavailable. Task state is visible, but attestations could not be refreshed.</span><span className="mono">Event history unavailable</span></div>}
    <div className="detail-grid"><div>
      <section className="detail-section"><h2>Task prompt</h2><p>{task.prompt}</p></section>
      {task.office && <section className="detail-section"><h2>Office workflow · {task.office.workflow_name}</h2><div className="detail-workflow">{task.office.steps.map((step, index) => <div className={`detail-workflow-step step-${step.status}`} key={`${step.agent_id}-${index}`}><b>{index + 1}</b><div><strong>{step.name}</strong><span>{step.label} · {step.role}</span></div><em>{step.status.replaceAll("_", " ")}</em></div>)}</div></section>}
      {task.review_feedback && <section className="detail-section"><h2>Review feedback</h2><p>{task.review_feedback}</p></section>}
      <section className="detail-section"><h2>Result</h2><p>{task.result ?? "No result has been submitted."}</p></section>
      <section className="detail-section"><h2>Technocore events</h2>{relevant.length ? relevant.map((item) => <a key={item.message.seq} className="activity" style={{ gridTemplateColumns: "80px 1fr" }} href={`https://technocore.chat/humans#r/tq-${ws.data}/${item.message.seq}`} target="_blank" rel="noreferrer"><time>SEQ {item.message.seq}</time><div><p><strong>{item.event.type.replaceAll("_", " ")}</strong> · {shortDid(item.message.from)}</p><span className="signed">{item.signed ? "✓ Signed agent event" : "Dashboard event"}</span></div></a>) : <p>Historical events are unavailable from the current Technocore room ring.</p>}</section>
    </div><aside>
      <div className="proof-box"><div className="proof-line"><span>Technocore workspace</span><strong className="mono">tq-{ws.data}</strong></div><div className="proof-line"><span>Attempt</span><strong className="mono">{task.attempt} / {task.max_attempts}</strong></div>
        <div className="proof-line"><span>Worker DID</span><code>{task.worker_did ?? "Unassigned"}</code></div><div className="proof-line"><Attestation state={integrity.prompt} subject="Prompt"/></div><div className="proof-line"><Attestation state={integrity.result} subject="Result"/></div>
        <div className="proof-line"><span>Reviewer DID</span><code>{task.reviewer_did ?? "Unassigned"}</code></div><div className="proof-line"><Attestation state={integrity.review} subject="Approval"/></div>
        {integrity.warnings.length > 0 && <div className="proof-line"><span>Integrity notes</span>{integrity.warnings.map((warning) => <p key={warning} style={{ color: "var(--amber)", fontSize: 10 }}>{warning}</p>)}</div>}
        {(workerEvent || reviewEvent) && <div className="proof-line"><span>Original records</span>{workerEvent && <a className="attestation valid" href={`https://technocore.chat/humans#r/tq-${ws.data}/${workerEvent.message.seq}`} target="_blank" rel="noreferrer"><ExternalLink size={12}/> Worker event</a>}{reviewEvent && <a className="attestation valid" style={{ marginTop: 8 }} href={`https://technocore.chat/humans#r/tq-${ws.data}/${reviewEvent.message.seq}`} target="_blank" rel="noreferrer"><ExternalLink size={12}/> Review event</a>}</div>}
      </div>
    </aside></div>
  </main>;
}

function isTransientTechnocoreError(error: unknown): boolean {
  return error instanceof TechnocoreUnavailableError || error instanceof TechnocoreRateLimitError || error instanceof TechnocoreTimeoutError;
}

function TaskUnavailable({ workspace, taskId }: { workspace: string; taskId: string }) {
  return <main className="not-found"><div><div className="eyebrow">Technocore degraded</div><h1>Task temporarily unavailable.</h1><p style={{ color: "var(--muted)", maxWidth: 560, lineHeight: 1.6 }}>Technocore could not provide the current KV record. No cached or mock task state has been substituted. Retry when the upstream service recovers.</p><div className="actions" style={{ justifyContent: "center" }}><a className="button primary" href={`/task/${workspace}/${taskId}`}>Try again</a><a className="button" href={`/board/${workspace}`}>Back to board</a></div></div></main>;
}
