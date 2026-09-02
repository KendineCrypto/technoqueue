"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function TaskRetryButton({ workspace, taskId }: { workspace: string; taskId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function retry() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "retry" }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Retry failed");
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Retry failed"); }
    finally { setBusy(false); }
  }
  return <div className="paper-route-recovery"><button type="button" className="pixel-button primary" disabled={busy} onClick={() => void retry()}><RefreshCw size={13}/>{busy ? "RESETTING…" : "RESET & RETRY NOW"}</button>{error && <span>⚠ {error}</span>}</div>;
}

export function TaskCheckpointControls({ workspace, taskId, step }: { workspace: string; taskId: string; step: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(action: "approve_checkpoint" | "reject_checkpoint") {
    const feedback = action === "reject_checkpoint" ? window.prompt("What must this employee revise?")?.trim() : undefined;
    if (action === "reject_checkpoint" && (!feedback || feedback.length < 3)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, step, ...(feedback ? { feedback } : {}) }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Checkpoint update failed");
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Checkpoint update failed"); }
    finally { setBusy(false); }
  }
  return <div className="checkpoint-controls"><button type="button" disabled={busy} onClick={() => void decide("approve_checkpoint")}>✓ APPROVE HANDOFF</button><button type="button" disabled={busy} onClick={() => void decide("reject_checkpoint")}>↩ REQUEST REVISION</button>{error && <span>⚠ {error}</span>}</div>;
}
