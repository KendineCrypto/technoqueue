import { TechnocoreClient } from "@technoqueue/core";
import { all, nowIso, one, run } from "@/lib/db";
import { getPublicStats } from "@/lib/public-stats";
import { publicFeedIdentity, createLocalTrustTag } from "@/lib/secure-vault";
import { publicFeedEnabled, publicFeedRoom } from "@/lib/public-feed-policy";

type OutboxRow = {
  audit_id: number;
  action: string;
  metadata_json: string;
  attempts: number;
};

declare global { var __technoQueuePublicFeedRunning: boolean | undefined; }

function count(label: string, value: number) { return `${value} ${value === 1 ? label : `${label}s`}`; }

function safeRole(metadataJson: string) {
  try {
    const value = (JSON.parse(metadataJson) as { role?: unknown }).role;
    return typeof value === "string" && ["general", "planner", "researcher", "writer", "coder", "analyst", "reviewer"].includes(value)
      ? value.toUpperCase()
      : "SPECIALIST";
  } catch { return "SPECIALIST"; }
}

function publicMessage(row: OutboxRow) {
  const stats = getPublicStats();
  const workflows = one<{ count: number }>("SELECT COUNT(*) AS count FROM trusted_technocore_records WHERE kind = 'workflow'")?.count ?? 0;
  const receipt = createLocalTrustTag(`public-feed\0${row.audit_id}`).slice(0, 10);
  let body: string | null = null;

  if (row.action === "workspace.created") body = `OFFICE ONLINE · ${count("AI office", stats.offices)} now coordinating through TechnoQueue`;
  if (row.action === "employee.hired") body = `WORKER HIRED · ${safeRole(row.metadata_json)} joined an AI office · ${count("active worker", stats.workers)}`;
  if (row.action === "workflow.created") body = `WORKFLOW READY · A new multi-agent route is live · ${count("workflow", workflows)} configured`;
  if (row.action === "task.returned") body = "REVIEW LOOP · Changes requested · work returned for another pass";
  if (row.action === "task.approved") body = `TASK COMPLETED · A multi-agent workflow passed review · ${count("approved outcome", stats.completed)}`;

  return body ? `TQ LIVE · ${body} · ref ${receipt}` : null;
}

function recordFailure(row: OutboxRow, error: unknown) {
  const attempts = row.attempts + 1;
  const message = error instanceof Error ? error.message.slice(0, 240) : "Public feed publish failed";
  const terminal = attempts >= 12;
  const delay = Math.min(15 * 60_000, 5_000 * (2 ** Math.min(8, attempts - 1)));
  run(
    "UPDATE public_feed_outbox SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE audit_id = ?",
    terminal ? "failed" : "pending",
    attempts,
    terminal ? 0 : Date.now() + delay,
    message,
    nowIso(),
    row.audit_id
  );
  console.error("[public-feed]", terminal ? "delivery abandoned" : "delivery deferred", message);
}

export async function publishPublicFeedBatch(limit = 3) {
  if (!publicFeedEnabled() || globalThis.__technoQueuePublicFeedRunning) return;
  globalThis.__technoQueuePublicFeedRunning = true;
  try {
    const rows = all<OutboxRow>(`
      SELECT o.audit_id, o.attempts, a.action, a.metadata_json
      FROM public_feed_outbox o
      JOIN audit_log a ON a.id = o.audit_id
      WHERE o.status = 'pending' AND o.next_attempt_at <= ?
      ORDER BY o.audit_id
      LIMIT ?
    `, Date.now(), Math.max(1, Math.min(10, limit)));
    if (!rows.length) return;

    const identity = publicFeedIdentity();
    const client = new TechnocoreClient();
    const room = publicFeedRoom();
    let snapshot;
    try { snapshot = await client.readRoom(room, undefined, 200); }
    catch (error) {
      for (const row of rows) recordFailure(row, error);
      return;
    }
    const deliveredTexts = new Set(snapshot.messages.filter((message) => message.from === identity.did).map((message) => message.text));

    for (const row of rows) {
      const text = publicMessage(row);
      if (!text) {
        run("UPDATE public_feed_outbox SET status = 'skipped', updated_at = ? WHERE audit_id = ?", nowIso(), row.audit_id);
        continue;
      }
      try {
        let delivered = deliveredTexts.has(text);
        if (!delivered) {
          let publishError: unknown;
          try { await client.saySigned(room, text, identity); }
          catch (error) { publishError = error; }
          snapshot = await client.readRoom(room, snapshot.lastSeq, 200);
          for (const message of snapshot.messages) if (message.from === identity.did) deliveredTexts.add(message.text);
          delivered = deliveredTexts.has(text);
          if (!delivered && publishError) throw publishError;
        }
        if (!delivered) throw new Error("Technocore did not return the public feed event after publish");
        run(
          "UPDATE public_feed_outbox SET status = 'published', attempts = attempts + 1, last_error = NULL, published_at = ?, updated_at = ? WHERE audit_id = ?",
          nowIso(), nowIso(), row.audit_id
        );
      } catch (error) { recordFailure(row, error); }
    }
  } catch (error) { console.error("[public-feed] relay unavailable", error instanceof Error ? error.message : error); }
  finally { globalThis.__technoQueuePublicFeedRunning = false; }
}
