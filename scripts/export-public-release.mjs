import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectPublicSourceFiles, PUBLIC_MANIFEST } from "./public-release-contract.mjs";
import { verifyPublicPrivacy } from "./privacy-check.mjs";

const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function outputPath() {
  const inline = process.argv.find((value) => value.startsWith("--output="));
  const index = process.argv.indexOf("--output");
  return resolve(inline ? inline.slice("--output=".length) : index >= 0 ? process.argv[index + 1] : join(sourceRoot, ".release", "codepilot-v0.1.0"));
}

async function assertEmpty(path) {
  try {
    if ((await readdir(path)).length) throw new Error(`Public export directory must be empty: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const targetRoot = outputPath();
await assertEmpty(targetRoot);
await mkdir(targetRoot, { recursive: true });
const files = await collectPublicSourceFiles(sourceRoot);
const manifestFiles = [];
for (const path of files) {
  const source = join(sourceRoot, path);
  const target = join(targetRoot, path);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { errorOnExist: true, force: false });
  const content = await readFile(target);
  manifestFiles.push({ path, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") });
}
const packageJson = JSON.parse(await readFile(join(targetRoot, "package.json"), "utf8"));
await writeFile(join(targetRoot, PUBLIC_MANIFEST), `${JSON.stringify({ schemaVersion: 1, name: packageJson.name, version: packageJson.version, files: manifestFiles }, null, 2)}\n`, "utf8");
await verifyPublicPrivacy(targetRoot, { exported: true });
console.log(`Public release exported: ${targetRoot}`);
console.log(`Files: ${manifestFiles.length}`);
