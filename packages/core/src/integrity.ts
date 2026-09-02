import { sha256 } from "./hash";
import type { ParsedEvent } from "./events";
import { taskContractSha256, type Task } from "./task";

export type AttestationState = "valid" | "mismatch" | "unavailable" | "not_applicable";
export type TaskIntegrity = { prompt: AttestationState; contract: AttestationState; result: AttestationState; review: AttestationState; warnings: string[] };

export function analyzeIntegrity(task: Task, events: ParsedEvent[]): TaskIntegrity {
  const relevant = events.filter((item) => item.event.task_id === task.id && item.signed);
  const claim = [...relevant].reverse().find((item) => item.event.type === "task_claimed" || item.event.type === "task_reclaimed" || item.event.type === "office_step_started");
  const contractEvent = [...relevant].reverse().find((item) => "contract_sha256" in item.event && Boolean(item.event.contract_sha256));
  const submitted = [...relevant].reverse().find((item) => item.event.type === "task_submitted" || item.event.type === "office_step_completed");
  const approved = [...relevant].reverse().find((item) => item.event.type === "task_approved");
  const warnings: string[] = [];

  let prompt: AttestationState = "unavailable";
  if (claim && "prompt_sha256" in claim.event && claim.event.prompt_sha256) {
    const expectedDid = claim.event.type === "office_step_started" ? task.office?.steps[claim.event.step]?.agent_did : task.worker_did;
    prompt = claim.message.from === expectedDid && claim.event.prompt_sha256 === sha256(task.prompt) ? "valid" : "mismatch";
    if (claim.message.from !== expectedDid) warnings.push("Assigned employee DID differs from signed claim DID.");
    if (claim.event.prompt_sha256 !== sha256(task.prompt)) warnings.push("Prompt changed after signed claim.");
  } else if (task.worker_did) warnings.push("Signed claim event is unavailable from the current room ring.");

  let contract: AttestationState = "unavailable";
  if (contractEvent && "contract_sha256" in contractEvent.event && contractEvent.event.contract_sha256) {
    contract = contractEvent.event.contract_sha256 === taskContractSha256(task) ? "valid" : "mismatch";
    if (contract === "mismatch") warnings.push("Outcome contract or assigned route changed after signed claim.");
  }

  let result: AttestationState = task.result === null ? "not_applicable" : "unavailable";
  if (submitted && (submitted.event.type === "task_submitted" || submitted.event.type === "office_step_completed") && task.result !== null) {
    result = submitted.message.from === task.worker_did && submitted.event.result_sha256 === sha256(task.result) && task.result_sha256 === sha256(task.result) ? "valid" : "mismatch";
    if (submitted.message.from !== task.worker_did) warnings.push("Worker DID differs from signed submission DID.");
    if (submitted.event.result_sha256 !== sha256(task.result)) warnings.push("Result changed after signed submission.");
  } else if (task.result) warnings.push("Signed result event is unavailable from the current room ring.");

  let review: AttestationState = !task.requires_review || task.review_decision !== "approved" ? "not_applicable" : "unavailable";
  if (approved && approved.event.type === "task_approved" && task.result !== null) {
    review = approved.message.from === task.reviewer_did && approved.event.result_sha256 === sha256(task.result) ? "valid" : "mismatch";
    if (approved.message.from !== task.reviewer_did) warnings.push("Reviewer DID in KV differs from signed approval DID.");
  } else if (task.review_decision === "approved") warnings.push("Signed approval is unavailable from the current room ring.");
  return { prompt, contract, result, review, warnings };
}
