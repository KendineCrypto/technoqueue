import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyChanges, collectContext, runVerification } from "../src/cli";

async function main() {
  const root = await mkdtemp(join(tmpdir(), "technoqueue-local-execution-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "index.ts"), "export const before = true;\n");
    await writeFile(join(root, "src", "secrets.ts"), "export const token = 'never-upload';\n");
    await writeFile(join(root, ".env"), "PRIVATE_TOKEN=never-upload\n");
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"", typecheck: "node -e \"process.exit(7)\"" } }));
    const context = JSON.parse(await collectContext(root, 20, 20_000)) as { files: Array<{ path: string; content: string }> };
    assert.ok(context.files.some((file) => file.path === "src/index.ts"));
    assert.ok(!context.files.some((file) => file.path.includes(".env")));
    assert.ok(!context.files.some((file) => file.path.includes("secrets.ts")));

    await applyChanges(root, [{ path: "src/index.ts", content: "export const after = true;\n" }]);
    assert.equal(await readFile(join(root, "src", "index.ts"), "utf8"), "export const after = true;\n");

    await assert.rejects(applyChanges(root, [{ path: "../escape.ts", content: "no" }]), /Path must stay relative/);
    await assert.rejects(applyChanges(root, [{ path: ".env", content: "no" }]), /Protected path/);
    await assert.rejects(applyChanges(root, [{ path: "src/credentials.json", content: "no" }]), /Protected path/);
    await assert.rejects(applyChanges(root, [{ path: "node_modules/owned.js", content: "no" }]), /Generated or dependency path/);
    await assert.rejects(applyChanges(root, [{ path: "NUL", content: "no" }]), /Path must stay relative/);
    await assert.rejects(applyChanges(root, [{ path: "src/index.ts", content: "one" }, { path: "src/../src/index.ts", content: "two" }]), /Path must stay relative|Duplicate resolved/);
    const passing = await runVerification(root, "pnpm-test");
    const failing = await runVerification(root, "pnpm-typecheck");
    assert.equal(passing.exitCode, 0, "the pinned pnpm CLI must execute without a shell on this platform");
    assert.equal(failing.exitCode, 7, "non-zero verification exits must remain observable to the signed job result");
    console.log("✓ local context filtering, confined writes, protected paths, and cross-platform verification");
  } finally { await rm(root, { recursive: true, force: true }); }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
