#!/usr/bin/env node
import {
  createIdentity,
  exportPrivateKeyPem,
  identityFromPrivateKeyPem,
  runnerHeartbeatPayload,
  runnerPairingPayload,
  signPayload
} from "@technoqueue/core";
import { Command } from "commander";
import { chmod, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { hostname, homedir, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const VERSION = "0.3.0";
const HEARTBEAT_INTERVAL_MS = 10_000;
const runnerConfigSchema = z.object({
  version: z.literal(1),
  site: z.string().url(),
  runnerId: z.string(),
  workspace: z.string(),
  workspaceName: z.string(),
  did: z.string(),
  privateKeyPem: z.string(),
  token: z.string(),
  label: z.string(),
  platform: z.enum(["win32", "darwin", "linux"]),
  sequence: z.number().int().nonnegative()
}).strict();
type RunnerConfig = z.infer<typeof runnerConfigSchema>;

function configPath() {
  return resolve(process.env.TECHNOQUEUE_RUNNER_HOME ?? resolve(homedir(), ".technoqueue"), "runner.json");
}

function normalizedSite(value: string) {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("Runner sites must use HTTPS (HTTP is allowed only for localhost)");
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000), headers: { "content-type": "application/json", ...init.headers } });
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error || `TechnoQueue returned HTTP ${response.status}`);
  return body;
}

async function loadConfig() {
  try {
    return runnerConfigSchema.parse(JSON.parse(await readFile(configPath(), "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new Error("No runner is paired. Run `pnpm runner connect --site <url> --code <code>` first.");
    throw error;
  }
}

async function saveConfig(config: RunnerConfig) {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { await chmod(path, 0o600); } catch { /* Windows protects this through the user profile ACL */ }
}

async function configExists() {
  try { await stat(configPath()); return true; } catch { return false; }
}

async function pair(siteValue: string, code: string, labelValue?: string) {
  if (await configExists()) throw new Error(`A runner is already configured at ${configPath()}. Revoke it in the office before replacing the local identity.`);
  const site = normalizedSite(siteValue);
  const challenge = await requestJson<{ challenge: string; label: string; workspace: string; workspaceName: string }>(`${site}/api/runners/pair/challenge`, {
    method: "POST",
    body: JSON.stringify({ code })
  });
  const identity = createIdentity();
  const runnerPlatform = platform();
  if (runnerPlatform !== "win32" && runnerPlatform !== "darwin" && runnerPlatform !== "linux") throw new Error(`Unsupported platform: ${runnerPlatform}`);
  const label = labelValue?.trim() || challenge.label || hostname();
  const payload = runnerPairingPayload({ code, challenge: challenge.challenge, did: identity.did, label, platform: runnerPlatform, version: VERSION });
  const paired = await requestJson<{ runnerId: string; token: string; workspace: string; workspaceName: string; sequence: number }>(`${site}/api/runners/pair`, {
    method: "POST",
    body: JSON.stringify({ code, did: identity.did, label, platform: runnerPlatform, version: VERSION, signature: signPayload(identity, payload) })
  });
  await saveConfig({ version: 1, site, runnerId: paired.runnerId, workspace: paired.workspace, workspaceName: paired.workspaceName, did: identity.did, privateKeyPem: exportPrivateKeyPem(identity), token: paired.token, label, platform: runnerPlatform, sequence: paired.sequence });
  console.log(`\n✓ Paired ${label} with ${paired.workspaceName}`);
  console.log(`  DID: ${identity.did}`);
  console.log(`  Config: ${configPath()}`);
  console.log("\nRun `pnpm runner start` to bring this runner online.\n");
}

async function sendHeartbeat(config: RunnerConfig) {
  const sequence = config.sequence + 1;
  const capabilities = ["heartbeat-v1", "identity-v1"];
  const payload = runnerHeartbeatPayload({ runnerId: config.runnerId, sequence, label: config.label, platform: config.platform, version: VERSION, capabilities });
  const identity = identityFromPrivateKeyPem(config.privateKeyPem);
  if (identity.did !== config.did) throw new Error("Local runner identity does not match its saved DID");
  await requestJson(`${config.site}/api/runners/${encodeURIComponent(config.runnerId)}/heartbeat`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ sequence, label: config.label, platform: config.platform, version: VERSION, capabilities, signature: signPayload(identity, payload) })
  });
  config.sequence = sequence;
  await saveConfig(config);
  return config;
}

async function start() {
  let config = await loadConfig();
  console.log(`\nTechnoQueue Runner v${VERSION}`);
  console.log(`Office: ${config.workspaceName} (${config.workspace})`);
  console.log(`DID: ${config.did}`);
  console.log("Press Ctrl+C to stop.\n");
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  while (!stopping) {
    try {
      config = await sendHeartbeat(config);
      console.log(`[${new Date().toLocaleTimeString()}] online · heartbeat #${config.sequence}`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ${error instanceof Error ? error.message : "Heartbeat failed"}`);
    }
    if (!stopping) await new Promise((resolveWait) => setTimeout(resolveWait, HEARTBEAT_INTERVAL_MS));
  }
  console.log("\nRunner stopped. The office will mark it offline shortly.\n");
}

async function status() {
  const config = await loadConfig();
  const result = await requestJson<{ runner: { state: string; lastSeenAt: number | null; version: string } }>(`${config.site}/api/runners/${encodeURIComponent(config.runnerId)}/heartbeat`, {
    method: "GET",
    headers: { authorization: `Bearer ${config.token}` }
  });
  console.log(`\n${config.label}`);
  console.log(`Office: ${config.workspaceName} (${config.workspace})`);
  console.log(`State: ${result.runner.state}`);
  console.log(`DID: ${config.did}`);
  console.log(`Last seen: ${result.runner.lastSeenAt ? new Date(result.runner.lastSeenAt).toISOString() : "never"}\n`);
}

async function forget() {
  const config = await loadConfig();
  await unlink(configPath());
  console.log(`\n✓ Forgot local runner ${config.label} (${config.did})`);
  console.log("The server connection was not revoked. Use the office Runner panel to revoke it before pairing again.\n");
}

const program = new Command()
  .name("technoqueue-runner")
  .description("Secure local workforce bridge for TechnoQueue")
  .version(VERSION);

program.command("connect")
  .description("Pair this computer with an office using a one-time code")
  .requiredOption("--site <url>", "TechnoQueue site URL")
  .requiredOption("--code <code>", "one-time pairing code")
  .option("--label <label>", "runner name shown in the office")
  .action(async ({ site, code, label }: { site: string; code: string; label?: string }) => pair(site, code, label));

program.command("start").description("Start signed runner heartbeats").action(start);
program.command("status").description("Show this runner's current office status").action(status);
program.command("forget").description("Delete this computer's saved runner identity after revoking it in the office").action(forget);

program.parseAsync().catch((error) => {
  console.error(`\nRunner error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
