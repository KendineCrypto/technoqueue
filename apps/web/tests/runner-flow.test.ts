import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentity, runnerHeartbeatPayload, runnerPairingPayload, signPayload } from "@technoqueue/core";

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "technoqueue-runner-test-"));
  process.env.TECHNOQUEUE_DB_PATH = join(directory, "runner.sqlite");
  process.env.TECHNOQUEUE_PUBLIC_FEED = "false";

  const { createRunnerPairing, pairingByCode } = await import("@/lib/local-runner");
  const { db, one, run, nowIso } = await import("@/lib/db");
  const pairRoute = await import("@/app/api/runners/pair/route");
  const heartbeatRoute = await import("@/app/api/runners/[runnerId]/heartbeat/route");

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
  const pairPayload = runnerPairingPayload({ code: pairing.code, challenge: storedPairing.challenge, did: runnerIdentity.did, label: "Test PC", platform: "win32", version: "0.3.0" });
  const pairResponse = await pairRoute.POST(new Request("https://technoqueue.test/api/runners/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pairing.code, did: runnerIdentity.did, label: "Test PC", platform: "win32", version: "0.3.0", signature: signPayload(runnerIdentity, pairPayload) }) }));
  assert.equal(pairResponse.status, 200);
  const paired = await pairResponse.json() as { runnerId: string; token: string };
  assert.match(paired.runnerId, /^runner-/);
  assert.equal(pairingByCode(pairing.code), undefined, "pairing code must be consumed");

  const capabilities = ["heartbeat-v1", "identity-v1"];
  const heartbeatPayload = runnerHeartbeatPayload({ runnerId: paired.runnerId, sequence: 1, label: "Test PC", platform: "win32", version: "0.3.0", capabilities });
  const heartbeatBody = { sequence: 1, label: "Test PC", platform: "win32", version: "0.3.0", capabilities, signature: signPayload(runnerIdentity, heartbeatPayload) };
  const heartbeatRequest = () => new Request(`https://technoqueue.test/api/runners/${paired.runnerId}/heartbeat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${paired.token}` }, body: JSON.stringify(heartbeatBody) });
  const heartbeatResponse = await heartbeatRoute.POST(heartbeatRequest(), { params: Promise.resolve({ runnerId: paired.runnerId }) });
  assert.equal(heartbeatResponse.status, 200);
  assert.equal(one<{ last_sequence: number }>("SELECT last_sequence FROM local_runners WHERE id = ?", paired.runnerId)?.last_sequence, 1);
  const replayResponse = await heartbeatRoute.POST(heartbeatRequest(), { params: Promise.resolve({ runnerId: paired.runnerId }) });
  assert.equal(replayResponse.status, 409, "replayed heartbeat must be rejected");
  console.log("✓ local runner pairing, signed heartbeat, and replay protection");
  } finally {
    db().close();
    await rm(directory, { recursive: true, force: true });
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
