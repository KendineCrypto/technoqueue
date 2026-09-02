#!/usr/bin/env node
import {
  createIdentity,
  exportPrivateKeyPem,
  identityFromPrivateKeyPem,
  runnerJobRequestSchema,
  runnerJobResultPayload,
  runnerHeartbeatPayload,
  runnerPairingPayload,
  runnerProjectRequestPayload,
  runnerRelativePathSchema,
  sha256,
  signPayload
} from "@technoqueue/core";
import { Command } from "commander";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { hostname, homedir, platform } from "node:os";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const VERSION = "0.4.3";
const HEARTBEAT_INTERVAL_MS = 10_000;
const localProjectSchema = z.object({ path: z.string(), label: z.string(), rootFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const runnerConfigSchema = z.object({
  version: z.literal(2),
  site: z.string().url(),
  runnerId: z.string(),
  workspace: z.string(),
  workspaceName: z.string(),
  did: z.string(),
  privateKeyPem: z.string(),
  token: z.string(),
  label: z.string(),
  platform: z.enum(["win32", "darwin", "linux"]),
  sequence: z.number().int().nonnegative(),
  projects: z.record(z.string(), localProjectSchema)
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
    const raw = JSON.parse(await readFile(configPath(), "utf8")) as Record<string, unknown>;
    return runnerConfigSchema.parse(raw.version === 1 ? { ...raw, version: 2, projects: {} } : raw);
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
  await saveConfig({ version: 2, site, runnerId: paired.runnerId, workspace: paired.workspace, workspaceName: paired.workspaceName, did: identity.did, privateKeyPem: exportPrivateKeyPem(identity), token: paired.token, label, platform: runnerPlatform, sequence: paired.sequence, projects: {} });
  console.log(`\n✓ Paired ${label} with ${paired.workspaceName}`);
  console.log(`  DID: ${identity.did}`);
  console.log(`  Config: ${configPath()}`);
  console.log("\nRun `pnpm runner start` to bring this runner online.\n");
}

async function sendHeartbeat(config: RunnerConfig) {
  const sequence = config.sequence + 1;
  const capabilities = ["heartbeat-v1", "identity-v1", "project-context-v1", "project-write-v1", "project-verify-v1"];
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

function rootFingerprint(did: string, path: string) { return sha256(`technoqueue-project-v1\0${did}\0${path.toLowerCase()}`); }

async function addProject(pathValue: string, labelValue?: string) {
  const config = await loadConfig();
  const root = await realpath(resolve(pathValue));
  if (!(await stat(root)).isDirectory()) throw new Error("Project path must be a directory");
  const label = labelValue?.trim() || basename(root);
  const fingerprint = rootFingerprint(config.did, root);
  const identity = identityFromPrivateKeyPem(config.privateKeyPem);
  const payload = runnerProjectRequestPayload({ runnerId: config.runnerId, label, rootFingerprint: fingerprint });
  const response = await requestJson<{ project: { id: string; state: string } }>(`${config.site}/api/runners/${encodeURIComponent(config.runnerId)}/projects`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ label, rootFingerprint: fingerprint, signature: signPayload(identity, payload) })
  });
  config.projects[response.project.id] = { path: root, label, rootFingerprint: fingerprint };
  await saveConfig(config);
  console.log(`\n✓ Project request sent: ${label}`);
  console.log(`  Local path: ${root}`);
  console.log(`  State: ${response.project.state}`);
  console.log("  Approve its permissions from the office Runner panel.\n");
}

async function listProjectsCommand() {
  const config = await loadConfig(); const entries = Object.entries(config.projects);
  console.log("\nLocal project cabinet");
  if (!entries.length) console.log("  No projects connected.");
  for (const [id, project] of entries) console.log(`  ${id}\n    ${project.label} · ${project.path}\n    ${project.rootFingerprint}`);
  console.log();
}

const skippedNames = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".turbo", ".cache"]);
const protectedExactNames = new Set(["runner.json", ".npmrc", ".netrc", ".pypirc", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"]);
const protectedExtensions = new Set([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"]);
const textExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".css", ".scss", ".html", ".yml", ".yaml", ".toml", ".py", ".rs", ".go", ".java", ".kt", ".swift", ".sql", ".txt"]);
function allowedFile(name: string) { const lower = name.toLowerCase(); const dot = lower.lastIndexOf("."); return lower.startsWith("readme") || lower === "dockerfile" || lower === "package.json" || (dot >= 0 && textExtensions.has(lower.slice(dot))); }
function secretLike(path: string) {
  return path.split(/[\\/]/).some((part) => {
    const lower = part.toLowerCase(); const dot = lower.lastIndexOf(".");
    return lower === ".git"
      || lower.startsWith(".env")
      || protectedExactNames.has(lower)
      || lower.startsWith("id_rsa")
      || lower.startsWith("id_ed25519")
      || (dot >= 0 && protectedExtensions.has(lower.slice(dot)))
      || /(^|[-_.])(secrets?|credentials?|private[-_]?keys?|service[-_]?accounts?)([-_.]|$)/i.test(lower);
  });
}
function generatedPath(path: string) { return path.split(/[\\/]/).some((part) => skippedNames.has(part.toLowerCase())); }

export async function collectContext(root: string, maxFiles: number, maxBytes: number) {
  const files: Array<{ path: string; content: string }> = []; let bytes = 0; let omitted = 0;
  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles || bytes >= maxBytes) { omitted += 1; continue; }
      if (skippedNames.has(entry.name.toLowerCase()) || entry.isSymbolicLink()) continue;
      const absolute = resolve(directory, entry.name); const local = relative(root, absolute).replaceAll("\\", "/");
      if (secretLike(local)) continue;
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && allowedFile(entry.name)) {
        const info = await stat(absolute); if (info.size > 24_000) { omitted += 1; continue; }
        const content = await readFile(absolute, "utf8").catch(() => ""); const size = Buffer.byteLength(content);
        if (!content || bytes + size > maxBytes) { omitted += 1; continue; }
        files.push({ path: local, content }); bytes += size;
      }
    }
  }
  await walk(root);
  return JSON.stringify({ files, bytes, omitted });
}

async function assertWritablePath(root: string, localPath: string) {
  runnerRelativePathSchema.parse(localPath);
  if (secretLike(localPath)) throw new Error(`Protected path rejected: ${localPath}`);
  if (generatedPath(localPath)) throw new Error(`Generated or dependency path rejected: ${localPath}`);
  const rootReal = await realpath(root); const target = resolve(rootReal, localPath); const prefix = rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`;
  if (!target.startsWith(prefix)) throw new Error(`Path escapes project: ${localPath}`);
  const parentReal = await realpath(dirname(target));
  if (parentReal !== rootReal && !parentReal.startsWith(prefix)) throw new Error(`Parent escapes project: ${localPath}`);
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error(`Symlink writes are blocked: ${localPath}`); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  return target;
}

export async function applyChanges(root: string, changes: Array<{ path: string; content: string }>) {
  const plans: Array<{ path: string; content: string; target: string; temporary: string; previous: string | null }> = [];
  for (const change of changes) {
    const target = await assertWritablePath(root, change.path); const temporary = `${target}.technoqueue-${randomUUID()}.tmp`;
    const previous = await readFile(target, "utf8").catch((error: unknown) => { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; });
    plans.push({ ...change, target, temporary, previous });
  }
  const targetKeys = plans.map((plan) => platform() === "win32" ? plan.target.toLowerCase() : plan.target);
  if (new Set(targetKeys).size !== targetKeys.length) throw new Error("Duplicate resolved file paths are not allowed in one change set");
  const applied: typeof plans = [];
  const observed: Array<{ path: string; sha256: string }> = [];
  try {
    for (const plan of plans) await writeFile(plan.temporary, plan.content, { encoding: "utf8", flag: "wx" });
    for (const plan of plans) { await rename(plan.temporary, plan.target); applied.push(plan); }
    for (const plan of plans) {
      const content = await readFile(plan.target, "utf8");
      if (content !== plan.content) throw new Error(`Observed file content did not match the approved proposal: ${plan.path}`);
      observed.push({ path: plan.path, sha256: sha256(content) });
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const plan of [...applied].reverse()) {
      try { if (plan.previous === null) await unlink(plan.target); else await writeFile(plan.target, plan.previous, "utf8"); }
      catch { rollbackFailures.push(plan.path); }
    }
    for (const plan of plans) await unlink(plan.temporary).catch(() => undefined);
    const cause = error instanceof Error ? error.message : "Unknown filesystem error";
    const touched = applied.map((plan) => plan.path);
    throw new Error(`File update failed: ${cause}. Files replaced before failure: ${touched.length ? touched.join(", ") : "none"}. ${rollbackFailures.length ? `ROLLBACK INCOMPLETE; inspect manually: ${rollbackFailures.join(", ")}.` : "Rollback completed for every replaced file."}`);
  }
  return JSON.stringify({ changed: observed });
}

function safeRunnerError(error: unknown, root?: string) {
  let message = error instanceof Error ? error.message : "Local job failed";
  if (root) {
    for (const variant of new Set([root, root.replaceAll("\\", "/"), root.replaceAll("/", "\\")])) message = message.replaceAll(variant, "<project>");
  }
  return message.slice(0, 4_000);
}

export type VerificationResult = { command: "pnpm-test" | "pnpm-typecheck" | "pnpm-lint" | "npm-test"; exitCode: number | null; output: string };

export async function runVerification(root: string, command: VerificationResult["command"]) {
  const require = createRequire(import.meta.url);
  const pnpmCli = resolve(dirname(require.resolve("pnpm")), "bin", "pnpm.mjs");
  const npmCli = resolve(dirname(require.resolve("npm/package.json")), "bin", "npm-cli.js");
  const commands = {
    "pnpm-test": [pnpmCli, ["test"]],
    "pnpm-typecheck": [pnpmCli, ["typecheck"]],
    "pnpm-lint": [pnpmCli, ["lint"]],
    "npm-test": [npmCli, ["test", "--"]]
  } as const;
  const [cli, args] = commands[command];
  return new Promise<VerificationResult>((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, shell: false, windowsHide: true, env: { PATH: process.env.PATH, Path: process.env.Path, PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, CI: "1", NO_COLOR: "1" } });
    let output = ""; const append = (chunk: Buffer) => { if (output.length < 60_000) output += chunk.toString("utf8").slice(0, 60_000 - output.length); };
    child.stdout.on("data", append); child.stderr.on("data", append);
    const timer = setTimeout(() => { child.kill(); rejectRun(new Error("Verification timed out after 120 seconds")); }, 120_000);
    child.on("error", (error) => { clearTimeout(timer); rejectRun(error); });
    child.on("exit", (code) => { clearTimeout(timer); resolveRun({ command, exitCode: code, output }); });
  });
}

async function processNextJob(config: RunnerConfig) {
  const response = await requestJson<{ job: null | { id: string; kind: string; request: unknown; project: { id: string; label: string; rootFingerprint: string } } }>(`${config.site}/api/runners/${encodeURIComponent(config.runnerId)}/jobs/next`, { method: "GET", headers: { authorization: `Bearer ${config.token}` } });
  if (!response.job) return;
  const job = response.job; const local = config.projects[job.project.id];
  let status: "succeeded" | "failed" = "succeeded"; let result = "";
  try {
    if (!local || local.rootFingerprint !== job.project.rootFingerprint) throw new Error("Local project mapping does not match the approved fingerprint");
    const request = runnerJobRequestSchema.parse(job.request);
    if (request.kind === "context") result = await collectContext(local.path, request.maxFiles, request.maxBytes);
    else if (request.kind === "apply_changes") result = await applyChanges(local.path, request.changes);
    else {
      const verification = await runVerification(local.path, request.command);
      result = JSON.stringify(verification);
      if (verification.exitCode !== 0) status = "failed";
    }
  } catch (error) { status = "failed"; result = safeRunnerError(error, local?.path); }
  const completedAt = new Date().toISOString(); const resultSha256 = sha256(result); const identity = identityFromPrivateKeyPem(config.privateKeyPem);
  const payload = runnerJobResultPayload({ jobId: job.id, status, resultSha256, completedAt });
  await requestJson(`${config.site}/api/runners/${encodeURIComponent(config.runnerId)}/jobs/${encodeURIComponent(job.id)}/complete`, { method: "POST", headers: { authorization: `Bearer ${config.token}` }, body: JSON.stringify({ jobId: job.id, status, result, resultSha256, completedAt, signature: signPayload(identity, payload) }) });
  console.log(`[${new Date().toLocaleTimeString()}] ${status} · ${job.kind} · ${job.project.label}`);
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
      await processNextJob(config);
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
const project = program.command("project").description("Manage local project grants");
project.command("add").description("Request access for a local project folder").requiredOption("--path <path>", "local project directory").option("--label <label>", "project label shown in the office").action(({ path, label }: { path: string; label?: string }) => addProject(path, label));
project.command("list").description("List project paths stored only on this computer").action(listProjectsCommand);
program.command("forget").description("Delete this computer's saved runner identity after revoking it in the office").action(forget);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  program.parseAsync().catch((error) => {
    console.error(`\nRunner error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
