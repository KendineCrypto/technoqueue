#!/usr/bin/env node
import { password } from "@inquirer/prompts";
import { Command, Option } from "commander";
import {
  TechnoQueue,
  TechnocoreRateLimitError,
  TechnocoreTimeoutError,
  TechnocoreUnavailableError,
  createExecutor,
  createIdentity,
  loadIdentity,
  resourcesForWorkspace,
  saveEncryptedIdentity,
  serializeTask,
  sha256,
  type TaskRole
} from "@technoqueue/core";
import { resolve } from "node:path";

const program = new Command().name("technoqueue").description("Technocore-coordinated agent runner").version("0.1.0");
const providerOption = new Option("--provider <provider>", "executor provider").choices(["mock", "openai"]).default("mock");
const roleOption = new Option("--role <role>").choices(["general", "planner", "researcher", "writer", "coder", "analyst"]);

function log(message: string) { console.log(`[${new Date().toLocaleTimeString("en-GB", { hour12: false })}] ${message}`); }
function sleep(ms: number) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }

async function retryTransient<T>(action: () => Promise<T>, description: string): Promise<T> {
  let backoff = 1000;
  while (true) {
    try { return await action(); }
    catch (error) {
      if (error instanceof TechnocoreRateLimitError) {
        log(`${description} rate limited; retrying in ${Math.ceil(error.retryAfterMs / 1000)}s`);
        await sleep(error.retryAfterMs);
      } else if (error instanceof TechnocoreUnavailableError || error instanceof TechnocoreTimeoutError) {
        const reason = error instanceof TechnocoreTimeoutError ? "Technocore timed out" : "Technocore unavailable";
        log(`${reason} during ${description}; retrying in ${backoff / 1000}s`);
        await sleep(backoff); backoff = Math.min(30_000, backoff * 2);
      } else throw error;
    }
  }
}

async function identityPassphrase(confirm = false): Promise<string> {
  const first = await password({ message: "Passphrase (minimum 12 characters):", mask: "*", validate: (value) => value.length >= 12 || "Use at least 12 characters" });
  if (confirm) {
    const second = await password({ message: "Confirm passphrase:", mask: "*" });
    if (first !== second) throw new Error("Passphrases do not match");
  }
  return first;
}

program.command("identity:create")
  .description("Create an encrypted local Ed25519 agent identity")
  .option("--name <name>", "identity filename", "agent")
  .option("--output <path>", "explicit output path")
  .action(async ({ name, output }: { name: string; output?: string }) => {
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(name)) throw new Error("Identity name must be lowercase and URL-safe");
    const target = resolve(output ?? `.secrets/${name}.pem`);
    const passphrase = await identityPassphrase(true);
    const identity = createIdentity();
    await saveEncryptedIdentity(identity, target, passphrase);
    console.log(`\nIdentity saved: ${target}\nPublic DID: ${identity.did}\n`);
  });

type WorkerOptions = { workspace: string; role: TaskRole; identity: string; provider: "mock" | "openai"; label: string; once?: boolean };

async function loadLocalIdentity(path: string) {
  const passphrase = process.env.TECHNOQUEUE_IDENTITY_PASSPHRASE ?? await identityPassphrase();
  return loadIdentity(resolve(path), passphrase);
}

async function workerLoop(options: WorkerOptions) {
  const identity = await loadLocalIdentity(options.identity);
  const queue = new TechnoQueue(options.workspace);
  const executor = createExecutor(options.provider, options.label);
  const lease = Number(process.env.TECHNOQUEUE_LEASE_SECONDS ?? 120);
  let cursor = 0;
  let backoff = 1000;
  console.log(`\nTechnoQueue Worker\n\nWorkspace: ${options.workspace}\nRole: ${options.role}\nProvider: ${options.provider}\nDID: ${identity.did}\n`);
  await retryTransient(() => queue.signedEvent(identity, { type: "agent_online", role: options.role, label: options.label, version: "1" }), "agent_online publish");
  log("connected to Technocore; signed agent_online published");
  while (true) {
    try {
      const tasks = await queue.listTasks();
      let processed = false;
      for (const stored of tasks) {
        if (stored.task.office) continue; // Hosted-office tasks are bound to specific session-held DIDs.
        const expired = stored.task.status === "running" && stored.task.worker_lease_until && new Date(stored.task.worker_lease_until) < new Date();
        const ownActiveClaim = stored.task.status === "running" && stored.task.worker_did === identity.did && stored.task.worker_lease_until !== null && new Date(stored.task.worker_lease_until) >= new Date();
        if (stored.task.role !== options.role || (stored.task.status !== "open" && !expired && !ownActiveClaim)) continue;
        let claimedTask: typeof stored.task; let claimedRaw: string;
        if (ownActiveClaim) {
          log(`${stored.task.id} has an active claim by this DID; resuming after uncertain outcome`);
          await retryTransient(() => queue.signedEvent(identity, { type: "task_claimed", task_id: stored.task.id, prompt_sha256: sha256(stored.task.prompt), attempt: stored.task.attempt }), "claim attestation");
          claimedTask = stored.task; claimedRaw = stored.raw;
        } else {
          log(`${stored.task.id} discovered; attempting atomic claim`);
          const claim = await queue.claimWork(stored, identity, lease);
          if (!claim) { log(`${stored.task.id} claimed by another agent`); continue; }
          log(`${claim.reclaimed ? "reclaim" : "claim"} successful; executing validated task prompt`);
          claimedTask = claim.task; claimedRaw = serializeTask(claim.task);
        }
        const result = await executor.execute(claimedTask);
        const current = { task: claimedTask, raw: claimedRaw };
        const finished = await queue.completeWork(current, identity, result.text);
        if (finished) log(`${finished.id} moved to ${finished.status}; signed result attestation published`);
        else log(`${claimedTask.id} changed before result commit; result was not written`);
        processed = true;
        break;
      }
      if (options.once) return;
      const room = await queue.client.longPollRoom(queue.resources.room, cursor, 10);
      cursor = room.lastSeq;
      if (!processed && room.messages.length === 0) log("waiting for work");
      backoff = 1000;
    } catch (error) {
      if (error instanceof TechnocoreRateLimitError) { log(`rate limited; retrying in ${Math.ceil(error.retryAfterMs / 1000)}s`); await sleep(error.retryAfterMs); }
      else if (error instanceof TechnocoreUnavailableError || error instanceof TechnocoreTimeoutError) { log(`${error instanceof TechnocoreTimeoutError ? "Technocore timed out" : "Technocore unavailable"}; retrying in ${backoff / 1000}s`); await sleep(backoff); backoff = Math.min(30_000, backoff * 2); }
      else throw error;
    }
  }
}

program.command("worker")
  .requiredOption("--workspace <workspace>")
  .addOption(roleOption.makeOptionMandatory())
  .requiredOption("--identity <path>")
  .addOption(providerOption)
  .option("--label <label>", "self-declared display label", "WorkerAgent")
  .option("--once", "scan once and exit")
  .action(workerLoop);

type ReviewerOptions = Omit<WorkerOptions, "role">;
async function reviewerLoop(options: ReviewerOptions) {
  const identity = await loadLocalIdentity(options.identity);
  const queue = new TechnoQueue(options.workspace);
  const executor = createExecutor(options.provider, options.label);
  const lease = Number(process.env.TECHNOQUEUE_LEASE_SECONDS ?? 120);
  console.log(`\nTechnoQueue Reviewer\n\nWorkspace: ${options.workspace}\nProvider: ${options.provider}\nDID: ${identity.did}\n`);
  await retryTransient(() => queue.signedEvent(identity, { type: "agent_online", role: "reviewer", label: options.label, version: "1" }), "agent_online publish");
  log("connected to Technocore; signed agent_online published");
  let cursor = 0;
  let backoff = 1000;
  while (true) {
    try {
      const tasks = await queue.listTasks();
      let processed = false;
      for (const stored of tasks) {
        if (stored.task.office) continue; // Hosted-office review steps are routed to a configured employee DID.
        const reviewExpired = stored.task.status === "review" && stored.task.reviewer_did && stored.task.reviewer_lease_until && new Date(stored.task.reviewer_lease_until) < new Date();
        const ownActiveClaim = stored.task.status === "review" && stored.task.reviewer_did === identity.did && stored.task.reviewer_lease_until !== null && new Date(stored.task.reviewer_lease_until) >= new Date();
        if (stored.task.status !== "review" || (stored.task.reviewer_did !== null && !reviewExpired && !ownActiveClaim)) continue;
        let claimed: typeof stored.task; let claimedRaw: string;
        if (ownActiveClaim) {
          if (!stored.task.result_sha256) continue;
          log(`${stored.task.id} has an active review claim by this DID; resuming after uncertain outcome`);
          await retryTransient(() => queue.signedEvent(identity, { type: "review_claimed", task_id: stored.task.id, result_sha256: stored.task.result_sha256! }), "review claim attestation");
          claimed = stored.task; claimedRaw = stored.raw;
        } else {
          log(`${stored.task.id} awaiting review; attempting atomic claim`);
          const freshClaim = await queue.claimReview(stored, identity, lease);
          if (!freshClaim) continue;
          claimed = freshClaim; claimedRaw = serializeTask(freshClaim);
        }
        const decision = await executor.review(claimed);
        const finished = await queue.finishReview({ task: claimed, raw: claimedRaw }, identity, decision.approved ? { approved: true } : { approved: false, feedback: decision.feedback ?? "Changes requested." });
        if (finished) log(`${finished.id} ${finished.status === "done" ? "approved" : finished.status === "open" ? "returned to queue" : "failed"}; signed review event published`);
        processed = true;
        break;
      }
      if (options.once) return;
      const room = await queue.client.longPollRoom(queue.resources.room, cursor, 10);
      cursor = room.lastSeq;
      if (!processed && room.messages.length === 0) log("waiting for review work");
      backoff = 1000;
    } catch (error) {
      if (error instanceof TechnocoreRateLimitError) {
        log(`rate limited; retrying in ${Math.ceil(error.retryAfterMs / 1000)}s`);
        await sleep(error.retryAfterMs);
      } else if (error instanceof TechnocoreUnavailableError || error instanceof TechnocoreTimeoutError) {
        log(`${error instanceof TechnocoreTimeoutError ? "Technocore timed out" : "Technocore unavailable"}; retrying in ${backoff / 1000}s`);
        await sleep(backoff); backoff = Math.min(30_000, backoff * 2);
      } else throw error;
    }
  }
}

program.command("reviewer")
  .requiredOption("--workspace <workspace>")
  .requiredOption("--identity <path>")
  .addOption(providerOption)
  .option("--label <label>", "self-declared display label", "ReviewAgent")
  .option("--once", "scan once and exit")
  .action(reviewerLoop);

program.command("inspect").requiredOption("--workspace <workspace>").action(async ({ workspace }: { workspace: string }) => {
  const queue = new TechnoQueue(workspace);
  const [tasks, events] = await Promise.all([queue.listTasks(), queue.listEvents()]);
  console.log(JSON.stringify({ resources: resourcesForWorkspace(workspace), tasks: tasks.map((item) => item.task), events }, null, 2));
});

program.parseAsync().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
