import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  type KeyObject
} from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import bs58 from "bs58";
import { didSchema } from "./validation";

const ED25519_SPKI_PREFIX_LENGTH = 12;
const ED25519_MULTICODEC = Buffer.from([0xed, 0x01]);

export type AgentIdentity = { did: string; privateKey: KeyObject; publicKey: KeyObject };

export function publicKeyBytes(publicKey: KeyObject): Uint8Array {
  const spki = publicKey.export({ type: "spki", format: "der" });
  if (spki.length !== ED25519_SPKI_PREFIX_LENGTH + 32) throw new Error("Unexpected Ed25519 public key encoding");
  return spki.subarray(ED25519_SPKI_PREFIX_LENGTH);
}

export function didFromPublicKey(publicKey: KeyObject): string {
  return didSchema.parse(`did:key:z${bs58.encode(Buffer.concat([ED25519_MULTICODEC, Buffer.from(publicKeyBytes(publicKey))]))}`);
}

export function createIdentity(): AgentIdentity {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { did: didFromPublicKey(publicKey), privateKey, publicKey };
}

export async function saveEncryptedIdentity(identity: AgentIdentity, path: string, passphrase: string): Promise<void> {
  if (passphrase.length < 12) throw new Error("Passphrase must be at least 12 characters");
  await mkdir(dirname(path), { recursive: true });
  const pem = identity.privateKey.export({
    type: "pkcs8",
    format: "pem",
    cipher: "aes-256-cbc",
    passphrase
  });
  await writeFile(path, pem, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

export async function loadIdentity(path: string, passphrase: string): Promise<AgentIdentity> {
  const pem = await readFile(path, "utf8");
  const privateKey = createPrivateKey({ key: pem, format: "pem", passphrase });
  const publicKey = createPublicKey(privateKey);
  return { did: didFromPublicKey(publicKey), privateKey, publicKey };
}

export function signPayload(identity: AgentIdentity, payload: string): string {
  return nodeSign(null, Buffer.from(payload, "utf8"), identity.privateKey).toString("base64url");
}

let lastNonce = 0n;
export function nextNonce(nowMs = Date.now()): string {
  const timeNs = BigInt(nowMs) * 1_000_000n;
  const next = timeNs > lastNonce ? timeNs : lastNonce + 1n;
  lastNonce = next;
  return next.toString();
}
