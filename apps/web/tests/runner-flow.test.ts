import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentity, runnerHeartbeatPayload, runnerJobResultPayload, runnerPairingPayload, runnerProjectRequestPayload, sha256, signPayload } from "@technoqueue/core";

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "technoqueue-runner-test-"));
  process.env.TECHNOQUEUE_DB_PATH = join(directory, "runner.sqlite");
  process.env.TECHNOQUEUE_PUBLIC_FEED = "false";

  const { createRunnerPairing, pairingByCode } = await import("@/lib/local-runner");
  const { db, one, run, nowIso } = await import("@/lib/db");
  const pairRoute = await import("@/app/api/runners/pair/route");
  const heartbeatRoute = await import("@/app/api/runners/[runnerId]/heartbeat/route");
  const projectRoute = await import("@/app/api/runners/[runnerId]/projects/route");
  const nextJobRoute = await import("@/app/api/runners/[runnerId]/jobs/next/route");
  const completeJobRoute = await import("@/app/api/runners/[runnerId]/jobs/[jobId]/complete/route");
  const { createRunnerJob, publicJob, purgeExpiredRunnerSnapshots } = await import("@/lib/local-projects");
  const { revealRunnerJobResult } = await import("@/lib/job-results");
  const { assertSameOrigin } = await import("@/lib/auth");
  const { requestAddress } = await import("@/lib/rate-limit");
  const { assertWithinUsageLimit } = await import("@/lib/usage-ledger");

  try {
  const owner = createIdentity();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const timestamp = nowIso();
  run("INSERT INTO users(id, username, password_hash, account_did, account_private_key_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", userId, `runner-test-${userId.slice(0, 8)}`, "test", owner.did, "test", timestamp, timestamp);
  run("INSERT INTO workspaces(id, owner_user_id, slug, name, event_room, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", workspaceId, userId, `runner-${userId.slice(0, 8)}`, "Runner Test Office", `d-tq-runner-${userId.slice(0, 8)}`, timestamp, timestamp);

  const pairing = createRunnerPairing({ workspaceId, userId, label: "Test PC" });
  const storedPairing = pairingByCode(pairing.code);
  assert.ok(storedPairing);
  const runnerIdentity = createIdentity();
  const pairPayload = runnerPairingPayload({ code: pairing.code, challenge: storedPairing.challenge, did: runnerIdentity.did, label: "Test PC", platform: "win32", version: "0.3.3" });
  const pairResponse = await pairRoute.POST(new Request("https://technoqueue.test/api/runners/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pairing.code, did: runnerIdentity.did, label: "Test PC", platform: "win32", version: "0.3.3", signature: signPayload(runnerIdentity, pairPayload) }) }));
  assert.equal(pairResponse.status, 200);
  const paired = await pairResponse.json() as { runnerId: string; token: string };
  assert.match(paired.runnerId, /^runner-/);
  assert.equal(pairingByCode(pairing.code), undefined, "pairing code must be consumed");

  const capabilities = ["heartbeat-v1", "identity-v1"];
  const heartbeatPayload = runnerHeartbeatPayload({ runnerId: paired.runnerId, sequence: 1, label: "Test PC", platform: "win32", version: "0.3.3", capabilities });
  const heartbeatBody = { sequence: 1, label: "Test PC", platform: "win32", version: "0.3.3", capabilities, signature: signPayload(runnerIdentity, heartbeatPayload) };
  const heartbeatRequest = () => new Request(`https://technoqueue.test/api/runners/${paired.runnerId}/heartbeat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${paired.token}` }, body: JSON.stringify(heartbeatBody) });
  const heartbeatResponse = await heartbeatRoute.POST(heartbeatRequest(), { params: Promise.resolve({ runnerId: paired.runnerId }) });
  assert.equal(heartbeatResponse.status, 200);
  assert.equal(one<{ last_sequence: number }>("SELECT last_sequence FROM local_runners WHERE id = ?", paired.runnerId)?.last_sequence, 1);
  const replayResponse = await heartbeatRoute.POST(heartbeatRequest(), { params: Promise.resolve({ runnerId: paired.runnerId }) });
  assert.equal(replayResponse.status, 409, "replayed heartbeat must be rejected");
  assert.throws(() => assertSameOrigin(new Request("https://technoqueue.test/api/write")), /Missing Origin/, "mutations without Origin must be rejected");
  assert.doesNotThrow(() => assertSameOrigin(new Request("https://technoqueue.test/api/write", { headers: { origin: "https://technoqueue.test" } })));
  assert.equal(requestAddress(new Request("https://technoqueue.test", { headers: { "x-forwarded-for": "203.0.113.9, 198.51.100.4" } })), "proxy:198.51.100.4", "the proxy-appended address must win over a spoofed first XFF value");

  const rootFingerprint = sha256("private local project root");
  const projectPayload = runnerProjectRequestPayload({ runnerId: paired.runnerId, label: "Test Project", rootFingerprint });
  const projectResponse = await projectRoute.POST(new Request(`https://technoqueue.test/api/runners/${paired.runnerId}/projects`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${paired.token}` }, body: JSON.stringify({ label: "Test Project", rootFingerprint, signature: signPayload(runnerIdentity, projectPayload) }) }), { params: Promise.resolve({ runnerId: paired.runnerId }) });
  assert.equal(projectResponse.status, 201);
  const projectBody = await projectResponse.json() as { project: { id: string } };
  const projectTimestamp = nowIso();
  run("UPDATE runner_projects SET permissions_json = ?, approved_at = ?, updated_at = ? WHERE id = ?", JSON.stringify(["read"]), projectTimestamp, projectTimestamp, projectBody.project.id);
  const projectRow = one<import("@/lib/db").RunnerProjectRow>("SELECT * FROM runner_projects WHERE id = ?", projectBody.project.id)!;
  const job = createRunnerJob({ workspaceId, project: projectRow, request: { kind: "context", maxFiles: 10, maxBytes: 10_000 }, approvalRequired: false });
  const nextResponse = await nextJobRoute.GET(new Request(`https://technoqueue.test/api/runners/${paired.runnerId}/jobs/next`, { headers: { authorization: `Bearer ${paired.token}` } }), { params: Promise.resolve({ runnerId: paired.runnerId }) });
  assert.equal(nextResponse.status, 200); const nextBody = await nextResponse.json() as { job: { id: string } }; assert.equal(nextBody.job.id, job.id);
  const resultText = JSON.stringify({ files: [{ path: "README.md", content: "hello" }] }); const resultSha256 = sha256(resultText); const completedAt = new Date().toISOString();
  const resultPayload = runnerJobResultPayload({ jobId: job.id, status: "succeeded", resultSha256, completedAt });
  const completeRequest = () => new Request(`https://technoqueue.test/api/runners/${paired.runnerId}/jobs/${job.id}/complete`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${paired.token}` }, body: JSON.stringify({ jobId: job.id, status: "succeeded", result: resultText, resultSha256, completedAt, signature: signPayload(runnerIdentity, resultPayload) }) });
  const completeResponse = await completeJobRoute.POST(completeRequest(), { params: Promise.resolve({ runnerId: paired.runnerId, jobId: job.id }) });
  assert.equal(completeResponse.status, 200);
  const completedJob = one<import("@/lib/db").RunnerJobRow>("SELECT * FROM runner_jobs WHERE id = ?", job.id)!;
  assert.equal(completedJob.status, "succeeded");
  assert.notEqual(completedJob.result_text, resultText, "project snapshots must not be stored as plaintext");
  assert.ok(!completedJob.result_text?.includes("README.md"), "encrypted snapshot storage must not expose filenames");
  assert.equal(await revealRunnerJobResult(completedJob.kind, completedJob.result_text!), resultText);
  assert.equal(publicJob(completedJob).result, undefined, "project snapshots must never be returned by the owner API");
  process.env.TECHNOQUEUE_RUNNER_SNAPSHOT_TTL_HOURS = "1";
  run("UPDATE runner_jobs SET completed_at = ? WHERE id = ?", "2000-01-01T00:00:00.000Z", job.id);
  purgeExpiredRunnerSnapshots(workspaceId);
  const purgedSnapshot = one<{ status: string; result_text: string | null }>("SELECT status, result_text FROM runner_jobs WHERE id = ?", job.id)!;
  assert.equal(purgedSnapshot.status, "cancelled", "unconsumed encrypted snapshots must expire");
  assert.equal(purgedSnapshot.result_text, null, "expired snapshot ciphertext must be deleted");
  const replayResult = await completeJobRoute.POST(completeRequest(), { params: Promise.resolve({ runnerId: paired.runnerId, jobId: job.id }) });
  assert.equal(replayResult.status, 409, "a completed local job receipt cannot be replayed");
  const changedAfterApproval = createRunnerJob({ workspaceId, project: projectRow, request: { kind: "context", maxFiles: 5, maxBytes: 5_000 }, approvalRequired: false });
  run("UPDATE runner_jobs SET request_json = ? WHERE id = ?", JSON.stringify({ kind: "context", maxFiles: 99, maxBytes: 99_000 }), changedAfterApproval.id);
  const digestMismatch = await nextJobRoute.GET(new Request(`https://technoqueue.test/api/runners/${paired.runnerId}/jobs/next`, { headers: { authorization: `Bearer ${paired.token}` } }), { params: Promise.resolve({ runnerId: paired.runnerId }) });
  assert.equal(digestMismatch.status, 200);
  assert.equal((await digestMismatch.json() as { job: unknown }).job, null);
  assert.equal(one<{ status: string }>("SELECT status FROM runner_jobs WHERE id = ?", changedAfterApproval.id)?.status, "cancelled", "a mutated approved request must never be leased");
  const expiringJob = createRunnerJob({ workspaceId, project: projectRow, request: { kind: "context", maxFiles: 5, maxBytes: 5_000 }, approvalRequired: false });
  const leasedResponse = await nextJobRoute.GET(new Request(`https://technoqueue.test/api/runners/${paired.runnerId}/jobs/next`, { headers: { authorization: `Bearer ${paired.token}` } }), { params: Promise.resolve({ runnerId: paired.runnerId }) });
  assert.equal(leasedResponse.status, 200);
  run("UPDATE runner_jobs SET lease_expires_at = ? WHERE id = ?", "2000-01-01T00:00:00.000Z", expiringJob.id);
  const expiredText = "late snapshot"; const expiredAt = new Date().toISOString(); const expiredHash = sha256(expiredText);
  const expiredPayload = runnerJobResultPayload({ jobId: expiringJob.id, status: "succeeded", resultSha256: expiredHash, completedAt: expiredAt });
  const expiredReceipt = await completeJobRoute.POST(new Request(`https://technoqueue.test/api/runners/${paired.runnerId}/jobs/${expiringJob.id}/complete`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${paired.token}` }, body: JSON.stringify({ jobId: expiringJob.id, status: "succeeded", result: expiredText, resultSha256: expiredHash, completedAt: expiredAt, signature: signPayload(runnerIdentity, expiredPayload) }) }), { params: Promise.resolve({ runnerId: paired.runnerId, jobId: expiringJob.id }) });
  assert.equal(expiredReceipt.status, 409, "a receipt after the lease must be rejected");
  assert.equal(one<{ status: string }>("SELECT status FROM runner_jobs WHERE id = ?", expiringJob.id)?.status, "failed");
  const staleWriteJob = createRunnerJob({ workspaceId, project: projectRow, request: { kind: "apply_changes", summary: "Must not run without a current write grant", changes: [{ path: "README.md", content: "blocked" }] }, approvalRequired: false });
  const blockedWriteResponse = await nextJobRoute.GET(new Request(`https://technoqueue.test/api/runners/${paired.runnerId}/jobs/next`, { headers: { authorization: `Bearer ${paired.token}` } }), { params: Promise.resolve({ runnerId: paired.runnerId }) });
  assert.equal(blockedWriteResponse.status, 409, "a queued write must be re-checked against the current project grant");
  assert.equal(one<{ status: string }>("SELECT status FROM runner_jobs WHERE id = ?", staleWriteJob.id)?.status, "cancelled");
  const limitedAgent = "agent-abcdefgh";
  run("INSERT INTO agent_usage_limits(workspace_id, agent_id, daily_request_limit, daily_token_limit, updated_at) VALUES (?, ?, 1, NULL, ?)", workspaceId, limitedAgent, nowIso());
  assert.doesNotThrow(() => assertWithinUsageLimit(workspaceId, limitedAgent));
  run("INSERT INTO provider_usage(id, workspace_id, agent_id, task_id, provider, model, prompt_tokens, output_tokens, total_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", `usage-${randomUUID()}`, workspaceId, limitedAgent, "task-abcdefgh", "openai", "test", 10, 5, 15, nowIso());
  assert.throws(() => assertWithinUsageLimit(workspaceId, limitedAgent), /Daily request limit reached/);
  console.log("✓ runner pairing, origin/IP controls, encrypted snapshots, approval digests, leases, live grants, replay protection, and provider budget guard");
  } finally {
    db().close();
    await rm(directory, { recursive: true, force: true });
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
