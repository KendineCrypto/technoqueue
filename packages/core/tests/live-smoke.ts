import {
  MockExecutor,
  TechnoQueue,
  analyzeIntegrity,
  createIdentity,
  serializeTask
} from "../src/index";

if (process.env.TECHNOQUEUE_LIVE_TESTS !== "1") throw new Error("Set TECHNOQUEUE_LIVE_TESTS=1 to write a unique live workspace");

const workspace = `live-${Date.now().toString(36)}`;
const queue = new TechnoQueue(workspace);
const workerA = createIdentity(); const workerB = createIdentity(); const reviewer = createIdentity();
const executor = new MockExecutor("LiveSmokeWorker", 30);

await queue.signedEvent(workerA, { type: "agent_online", role: "researcher", label: "LiveSmokeA", version: "1" });
await queue.signedEvent(workerB, { type: "agent_online", role: "researcher", label: "LiveSmokeB", version: "1" });
await queue.signedEvent(reviewer, { type: "agent_online", role: "reviewer", label: "LiveSmokeReviewer", version: "1" });
const task = await queue.create({ title: "TechnoQueue live smoke test", prompt: "Return a clearly marked mock result for the coordination smoke test.", role: "researcher", requires_review: true, max_attempts: 3 });
const stored = await queue.getTask(task.id); if (!stored) throw new Error("Task creation could not be confirmed");
const claims = await Promise.all([queue.claimWork(stored, workerA, 120), queue.claimWork(stored, workerB, 120)]);
const winners = claims.filter((claim) => claim !== null); if (winners.length !== 1) throw new Error(`Expected one CAS winner, got ${winners.length}`);
const winnerIdentity = claims[0] ? workerA : workerB; const claimed = winners[0]!.task;
const result = await executor.execute(claimed);
const submitted = await queue.completeWork({ task: claimed, raw: serializeTask(claimed) }, winnerIdentity, result.text); if (!submitted || submitted.status !== "review") throw new Error("Worker submission did not reach review");
const reviewClaim = await queue.claimReview({ task: submitted, raw: serializeTask(submitted) }, reviewer, 120); if (!reviewClaim) throw new Error("Reviewer claim failed");
const done = await queue.finishReview({ task: reviewClaim, raw: serializeTask(reviewClaim) }, reviewer, { approved: true }); if (!done || done.status !== "done") throw new Error("Review did not reach done");
const events = await queue.listEvents(); const integrity = analyzeIntegrity(done, events);
if (integrity.prompt !== "valid" || integrity.result !== "valid" || integrity.review !== "valid") throw new Error(`Integrity failed: ${JSON.stringify(integrity)}`);
console.log(JSON.stringify({ workspace, room: queue.resources.room, taskId: done.id, winner: winnerIdentity.did, reviewer: reviewer.did, status: done.status, integrity, eventCount: events.length }, null, 2));
