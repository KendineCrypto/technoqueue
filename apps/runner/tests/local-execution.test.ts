import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyChanges, collectContext } from "../src/cli";

async function main() {
  const root = await mkdtemp(join(tmpdir(), "technoqueue-local-execution-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "index.ts"), "export const before = true;\n");
    await writeFile(join(root, ".env"), "PRIVATE_TOKEN=never-upload\n");
    const context = JSON.parse(await collectContext(root, 20, 20_000)) as { files: Array<{ path: string; content: string }> };
    assert.ok(context.files.some((file) => file.path === "src/index.ts"));
    assert.ok(!context.files.some((file) => file.path.includes(".env")));

    await applyChanges(root, [{ path: "src/index.ts", content: "export const after = true;\n" }]);
    assert.equal(await readFile(join(root, "src", "index.ts"), "utf8"), "export const after = true;\n");

    await assert.rejects(applyChanges(root, [{ path: "../escape.ts", content: "no" }]), /escapes project/);
    await assert.rejects(applyChanges(root, [{ path: ".env", content: "no" }]), /Protected path/);
    console.log("✓ local context filtering, confined writes, and protected-path rejection");
  } finally { await rm(root, { recursive: true, force: true }); }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
