import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PUBLIC_MANIFEST, publicRequiredFiles } from "./public-release-contract.mjs";
import { verifyPublicPrivacy } from "./privacy-check.mjs";

function inputPath() {
  const inline = process.argv.find((value) => value.startsWith("--input="));
  const index = process.argv.indexOf("--input");
  return resolve(inline ? inline.slice("--input=".length) : index >= 0 ? process.argv[index + 1] : process.cwd());
}

const root = inputPath();
const manifest = JSON.parse(await readFile(join(root, PUBLIC_MANIFEST), "utf8"));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error("Public manifest schema is invalid");
const paths = manifest.files.map((entry) => entry.path);
if (new Set(paths).size !== paths.length) throw new Error("Public manifest contains duplicate paths");
for (const required of publicRequiredFiles) if (!paths.includes(required)) throw new Error(`Public manifest is missing ${required}`);
for (const entry of manifest.files) {
  const path = join(root, entry.path);
  if (!(await stat(path)).isFile()) throw new Error(`Manifest path is not a file: ${entry.path}`);
  const content = await readFile(path);
  const sha256 = createHash("sha256").update(content).digest("hex");
  if (content.length !== entry.bytes || sha256 !== entry.sha256) throw new Error(`Manifest mismatch: ${entry.path}`);
}
await verifyPublicPrivacy(root, { exported: true });
console.log(`Public release verified: ${manifest.files.length} files, version ${manifest.version}`);
