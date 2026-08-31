import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { PUBLIC_FEED_ACTIONS, publicFeedEnabled } from "./public-feed-policy";

export type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  account_did: string;
  account_private_key_enc: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceRow = {
  id: string;
  owner_user_id: string;
  slug: string;
  name: string;
  event_room: string;
  room_owned_at: string | null;
  integrity_initialized_at: string | null;
  integrity_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TrustedTechnocoreRecordRow = {
  workspace_id: string;
  record_key: string;
  kind: "agent" | "workflow" | "task";
  raw_value: string;
  auth_tag: string;
  compromised_at: string | null;
  observed_sha256: string | null;
  created_at: string;
  updated_at: string;
};

export type ProviderRow = {
  id: string;
  user_id: string;
  provider: string;
  label: string;
  last_four: string;
  api_key_enc: string;
  created_at: string;
  updated_at: string;
};

export type HostedAgentRow = {
  agent_id: string;
  workspace_id: string;
  owner_user_id: string;
  did: string;
  private_key_enc: string;
  connection_id: string;
  last_online_at: number | null;
  running_task_id: string | null;
  last_error: string | null;
  retry_after: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LocalRunnerRow = {
  id: string;
  workspace_id: string;
  did: string;
  label: string;
  platform: "win32" | "darwin" | "linux";
  version: string;
  token_hash: string;
  capabilities_json: string;
  last_seen_at: number | null;
  last_sequence: number;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RunnerPairingRow = {
  id: string;
  workspace_id: string;
  created_by_user_id: string;
  code_hash: string;
  challenge: string;
  label: string;
  expires_at: number;
  consumed_at: string | null;
  created_at: string;
};

export type RunnerProjectRow = {
  id: string;
  workspace_id: string;
  runner_id: string;
  label: string;
  root_fingerprint: string;
  permissions_json: string;
  requested_at: string;
  approved_at: string | null;
  revoked_at: string | null;
  updated_at: string;
};

export type RunnerJobRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  runner_id: string;
  task_id: string | null;
  agent_id: string | null;
  kind: "context" | "apply_changes" | "verify";
  status: "awaiting_approval" | "queued" | "running" | "succeeded" | "failed" | "rejected" | "cancelled";
  request_json: string;
  result_text: string | null;
  result_sha256: string | null;
  receipt_signature: string | null;
  approved_request_sha256: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  requested_at: string;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export type ProviderUsageRow = {
  id: string;
  workspace_id: string;
  agent_id: string;
  task_id: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_usd_micros: number | null;
  created_at: string;
};

declare global {
  var __technoQueueDb: DatabaseSync | undefined;
  var __technoQueueDbSchemaVersion: number | undefined;
}

function databasePath() {
  return resolve(process.env.TECHNOQUEUE_DB_PATH ?? resolve(process.cwd(), ".data", "technoqueue.sqlite"));
}

function openDatabase() {
  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      account_did TEXT NOT NULL UNIQUE,
      account_private_key_enc TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      event_room TEXT NOT NULL,
      room_owned_at TEXT,
      integrity_initialized_at TEXT,
      integrity_confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspaces_owner ON workspaces(owner_user_id);
    CREATE TABLE IF NOT EXISTS provider_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      last_four TEXT NOT NULL,
      api_key_enc TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS providers_user ON provider_connections(user_id);
    CREATE TABLE IF NOT EXISTS hosted_agents (
      agent_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      did TEXT NOT NULL UNIQUE,
      private_key_enc TEXT NOT NULL,
      connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE RESTRICT,
      last_online_at INTEGER,
      running_task_id TEXT,
      last_error TEXT,
      retry_after INTEGER,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agents_workspace ON hosted_agents(workspace_id, archived_at);
    CREATE TABLE IF NOT EXISTS local_runners (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      did TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('win32', 'darwin', 'linux')),
      version TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      last_seen_at INTEGER,
      last_sequence INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS local_runners_workspace ON local_runners(workspace_id, revoked_at);
    CREATE TABLE IF NOT EXISTS runner_pairings (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE,
      challenge TEXT NOT NULL,
      label TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runner_pairings_workspace ON runner_pairings(workspace_id, expires_at);
    CREATE TABLE IF NOT EXISTS trusted_technocore_records (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      record_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('agent', 'workflow', 'task')),
      raw_value TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      compromised_at TEXT,
      observed_sha256 TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id, record_key)
    );
    CREATE INDEX IF NOT EXISTS trusted_records_kind ON trusted_technocore_records(workspace_id, kind);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_workspace ON audit_log(workspace_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS public_feed_outbox (
      audit_id INTEGER PRIMARY KEY REFERENCES audit_log(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS public_feed_pending ON public_feed_outbox(status, next_attempt_at, audit_id);
    INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
  `);
  return database;
}

function migrate(database: DatabaseSync) {
  if ((globalThis.__technoQueueDbSchemaVersion ?? 0) >= 9) return;
  try { database.exec("ALTER TABLE workspaces ADD COLUMN event_room TEXT"); } catch { /* migrated already */ }
  try { database.exec("ALTER TABLE workspaces ADD COLUMN room_owned_at TEXT"); } catch { /* migrated already */ }
  database.exec("UPDATE workspaces SET event_room = 'd-tq-' || slug WHERE event_room IS NULL OR event_room = ''");
  database.exec("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, datetime('now'))");
  try { database.exec("ALTER TABLE workspaces ADD COLUMN integrity_initialized_at TEXT"); } catch { /* migrated already */ }
  database.exec(`
    CREATE TABLE IF NOT EXISTS trusted_technocore_records (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      record_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('agent', 'workflow', 'task')),
      raw_value TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      compromised_at TEXT,
      observed_sha256 TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id, record_key)
    );
    CREATE INDEX IF NOT EXISTS trusted_records_kind ON trusted_technocore_records(workspace_id, kind);
    INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, datetime('now'));
  `);
  try { database.exec("ALTER TABLE workspaces ADD COLUMN integrity_confirmed_at TEXT"); } catch { /* migrated already */ }
  database.exec("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, datetime('now'))");
  database.exec(`
    CREATE TABLE IF NOT EXISTS public_feed_outbox (
      audit_id INTEGER PRIMARY KEY REFERENCES audit_log(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS public_feed_pending ON public_feed_outbox(status, next_attempt_at, audit_id);
    INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (5, datetime('now'));
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS local_runners (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      did TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('win32', 'darwin', 'linux')),
      version TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      last_seen_at INTEGER,
      last_sequence INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS local_runners_workspace ON local_runners(workspace_id, revoked_at);
    CREATE TABLE IF NOT EXISTS runner_pairings (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE,
      challenge TEXT NOT NULL,
      label TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runner_pairings_workspace ON runner_pairings(workspace_id, expires_at);
    INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (6, datetime('now'));
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS runner_projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      runner_id TEXT NOT NULL REFERENCES local_runners(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      root_fingerprint TEXT NOT NULL,
      permissions_json TEXT NOT NULL DEFAULT '[]',
      requested_at TEXT NOT NULL,
      approved_at TEXT,
      revoked_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(runner_id, root_fingerprint)
    );
    CREATE INDEX IF NOT EXISTS runner_projects_workspace ON runner_projects(workspace_id, revoked_at, requested_at DESC);
    CREATE TABLE IF NOT EXISTS runner_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES runner_projects(id) ON DELETE CASCADE,
      runner_id TEXT NOT NULL REFERENCES local_runners(id) ON DELETE CASCADE,
      task_id TEXT,
      agent_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('context', 'apply_changes', 'verify')),
      status TEXT NOT NULL CHECK(status IN ('awaiting_approval', 'queued', 'running', 'succeeded', 'failed', 'rejected', 'cancelled')),
      request_json TEXT NOT NULL,
      result_text TEXT,
      result_sha256 TEXT,
      receipt_signature TEXT,
      approved_request_sha256 TEXT,
      lease_expires_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      requested_at TEXT NOT NULL,
      approved_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runner_jobs_workspace ON runner_jobs(workspace_id, status, requested_at DESC);
    CREATE INDEX IF NOT EXISTS runner_jobs_runner ON runner_jobs(runner_id, status, requested_at);
    CREATE INDEX IF NOT EXISTS runner_jobs_task ON runner_jobs(workspace_id, task_id, agent_id, requested_at);
    INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (7, datetime('now'));
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS provider_usage (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_usd_micros INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS provider_usage_workspace ON provider_usage(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS provider_usage_agent ON provider_usage(workspace_id, agent_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS agent_usage_limits (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      daily_request_limit INTEGER,
      daily_token_limit INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id, agent_id)
    );
    INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (8, datetime('now'));
  `);
  try { database.exec("ALTER TABLE runner_jobs ADD COLUMN approved_request_sha256 TEXT"); } catch { /* migrated already */ }
  try { database.exec("ALTER TABLE runner_jobs ADD COLUMN lease_expires_at TEXT"); } catch { /* migrated already */ }
  try { database.exec("ALTER TABLE runner_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0"); } catch { /* migrated already */ }
  database.exec("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (9, datetime('now'))");
  globalThis.__technoQueueDbSchemaVersion = 9;
}

export function db() {
  globalThis.__technoQueueDb ??= openDatabase();
  migrate(globalThis.__technoQueueDb);
  return globalThis.__technoQueueDb;
}

export function one<T>(sql: string, ...values: SQLInputValue[]): T | undefined {
  return db().prepare(sql).get(...values) as T | undefined;
}

export function all<T>(sql: string, ...values: SQLInputValue[]): T[] {
  return db().prepare(sql).all(...values) as T[];
}

export function run(sql: string, ...values: SQLInputValue[]) {
  return db().prepare(sql).run(...values);
}

export function nowIso() {
  return new Date().toISOString();
}

export function writeAudit(input: { userId?: string; workspaceId?: string; action: string; targetId?: string; metadata?: unknown }) {
  const createdAt = nowIso();
  const result = run(
    "INSERT INTO audit_log(user_id, workspace_id, action, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    input.userId ?? null,
    input.workspaceId ?? null,
    input.action,
    input.targetId ?? null,
    JSON.stringify(input.metadata ?? {}),
    createdAt
  );
  if (publicFeedEnabled() && PUBLIC_FEED_ACTIONS.has(input.action)) {
    run(
      "INSERT OR IGNORE INTO public_feed_outbox(audit_id, created_at, updated_at) VALUES (?, ?, ?)",
      Number(result.lastInsertRowid),
      createdAt,
      createdAt
    );
  }
}
