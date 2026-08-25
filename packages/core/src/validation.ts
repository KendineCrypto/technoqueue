import { z } from "zod";

export const technocoreNameRegex = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const workspaceRegex = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const taskIdRegex = /^task-[a-z0-9]{8,20}$/;
export const didRegex = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]+$/;

export const workspaceSchema = z.string().regex(workspaceRegex);
export const technocoreNameSchema = z.string().regex(technocoreNameRegex);
export const taskIdSchema = z.string().regex(taskIdRegex);
export const didSchema = z.string().regex(didRegex);

export function resourcesForWorkspace(workspace: string) {
  const safe = workspaceSchema.parse(workspace);
  const name = `tq-${safe}`;
  return { workspace: safe, room: technocoreNameSchema.parse(name), namespace: name };
}

export function assertSafeBaseUrl(value: string): URL {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname))) {
    throw new Error("TECHNOCORE_BASE_URL must be HTTPS, or HTTP on localhost");
  }
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}
