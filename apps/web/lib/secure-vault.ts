import type { AgentIdentity } from "@technoqueue/core";
import { didFromPublicKey } from "@technoqueue/core";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, createHmac, createPrivateKey, createPublicKey, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const ENVELOPE_VERSION = 1;

declare global {
  var __technoQueueMasterKey: Buffer | undefined;
}

function masterKey(): Buffer {
  if (globalThis.__technoQueueMasterKey) return globalThis.__technoQueueMasterKey;
  const configured = process.env.TECHNOQUEUE_MASTER_KEY;
  if (configured) {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.length !== 32) throw new Error("TECHNOQUEUE_MASTER_KEY must be a base64-encoded 32-byte key");
    globalThis.__technoQueueMasterKey = decoded;
    return decoded;
  }
  if (process.env.NODE_ENV === "production") throw new Error("TECHNOQUEUE_MASTER_KEY is required in production");
  const path = resolve(process.cwd(), ".secrets", "master.key");
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString("base64"), { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { chmodSync(path, 0o600); } catch { /* Windows permissions are managed by the user profile */ }
  const decoded = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
  if (decoded.length !== 32) throw new Error("Local master key is invalid; restore it from backup before continuing");
  globalThis.__technoQueueMasterKey = decoded;
  return decoded;
}

export function assertVaultReady() { masterKey(); }

export function createLocalTrustTag(value: string) {
  return createHmac("sha256", masterKey()).update("technoqueue-trust-v1\0").update(value).digest("base64url");
}

export function verifyLocalTrustTag(value: string, tag: string) {
  const expected = Buffer.from(createLocalTrustTag(value), "base64url");
  const actual = Buffer.from(tag, "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function aesEncrypt(plaintext: string, key: Buffer) {
  const { createCipheriv } = await import("node:crypto");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}

async function aesDecrypt(envelope: { iv: string; ciphertext: string; tag: string }, key: Buffer) {
  const { createDecipheriv } = await import("node:crypto");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export async function encryptSecret(value: string): Promise<string> {
  const encrypted = await aesEncrypt(value, masterKey());
  return JSON.stringify({ v: ENVELOPE_VERSION, ...encrypted });
}

export async function decryptSecret(value: string): Promise<string> {
  const parsed = JSON.parse(value) as { v: number; iv: string; ciphertext: string; tag: string };
  if (parsed.v !== ENVELOPE_VERSION) throw new Error("Unsupported encrypted secret version");
  return aesDecrypt(parsed, masterKey());
}

export function exportIdentityPrivateKey(identity: AgentIdentity) {
  return String(identity.privateKey.export({ type: "pkcs8", format: "pem" }));
}

export function importIdentityPrivateKey(pem: string): AgentIdentity {
  const privateKey = createPrivateKey({ key: pem, format: "pem" });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey, did: didFromPublicKey(publicKey) };
}

export function publicFeedIdentity(): AgentIdentity {
  const seed = createHmac("sha256", masterKey()).update("technoqueue-service-identity-v1\0public-feed").digest();
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const privateKey = createPrivateKey({ key: Buffer.concat([pkcs8Prefix, seed]), type: "pkcs8", format: "der" });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey, did: didFromPublicKey(publicKey) };
}

export async function encryptIdentity(identity: AgentIdentity) {
  return encryptSecret(exportIdentityPrivateKey(identity));
}

export async function decryptIdentity(value: string) {
  return importIdentityPrivateKey(await decryptSecret(value));
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, saltValue, digestValue] = stored.split("$");
  if (algorithm !== "scrypt" || !saltValue || !digestValue) return false;
  const expected = Buffer.from(digestValue, "base64url");
  const actual = await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createIdentityBackup(identity: AgentIdentity, passphrase: string, label: string) {
  if (passphrase.length < 12) throw new Error("Backup passphrase must be at least 12 characters");
  const salt = randomBytes(16);
  const key = await scrypt(passphrase, salt, 32) as Buffer;
  const encrypted = await aesEncrypt(exportIdentityPrivateKey(identity), key);
  return JSON.stringify({ format: "technoqueue-identity", version: 1, did: identity.did, label, createdAt: new Date().toISOString(), kdf: "scrypt", salt: salt.toString("base64url"), ...encrypted }, null, 2);
}

export async function readIdentityBackup(serialized: string, passphrase: string) {
  const value = JSON.parse(serialized) as { format: string; version: number; did: string; salt: string; iv: string; ciphertext: string; tag: string };
  if (value.format !== "technoqueue-identity" || value.version !== 1) throw new Error("This is not a supported TechnoQueue identity backup");
  const key = await scrypt(passphrase, Buffer.from(value.salt, "base64url"), 32) as Buffer;
  const identity = importIdentityPrivateKey(await aesDecrypt(value, key));
  if (identity.did !== value.did) throw new Error("Backup DID does not match its private key");
  return identity;
}
