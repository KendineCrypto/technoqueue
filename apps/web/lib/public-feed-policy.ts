export const PUBLIC_FEED_ACTIONS = new Set([
  "workspace.created",
  "employee.hired",
  "workflow.created",
  "task.returned",
  "task.approved"
]);

export function publicFeedEnabled() {
  if (process.env.TECHNOQUEUE_PUBLIC_FEED === "true") return true;
  if (process.env.TECHNOQUEUE_PUBLIC_FEED === "false") return false;
  try { return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").hostname === "technoqueue.fun"; }
  catch { return false; }
}

export function publicFeedRoom() {
  return process.env.TECHNOQUEUE_PUBLIC_FEED_ROOM ?? "d-technoqueue";
}
