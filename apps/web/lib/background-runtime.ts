import { all, type WorkspaceRow } from "@/lib/db";
import { runWorkspace } from "@/lib/office-runtime";

declare global { var __technoQueueBackgroundStarted: boolean | undefined; }

export function startBackgroundRuntime() {
  if (globalThis.__technoQueueBackgroundStarted || process.env.TECHNOQUEUE_BACKGROUND_RUNTIME === "false") return;
  globalThis.__technoQueueBackgroundStarted = true;
  const tick = async () => {
    const workspaces = all<WorkspaceRow>("SELECT * FROM workspaces ORDER BY created_at");
    for (const workspace of workspaces) await runWorkspace(workspace).catch((error: unknown) => console.error("[runtime]", workspace.slug, error));
  };
  const timer = setInterval(() => void tick(), Math.max(3_000, Number(process.env.TECHNOQUEUE_RUNTIME_INTERVAL_MS ?? 5_000)));
  timer.unref(); void tick();
}
