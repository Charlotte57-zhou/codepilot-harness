import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { collectPublicSourceFiles, PUBLIC_MANIFEST, publicExcludedPrefixes, publicRequiredFiles } from "./public-release-contract.mjs";

const textExtensions = new Set(["", ".cjs", ".css", ".example", ".html", ".js", ".json", ".md", ".mjs", ".ps1", ".py", ".ts", ".txt", ".yaml", ".yml"]);
const allowedBinaryExtensions = new Set([".ico", ".png"]);
const secretPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["AWS access key", /\bAKIA[A-Z0-9]{16}\b/],
  ["credential assignment", /\b(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|INVITE_CODE)\s*=\s*["']?(?!example|placeholder|your-|test-|<)[^\s"']{12,}/i]
];
const codexTaskPattern = new RegExp(`(?:${["Codex", "Thread"].join("-")}|${["session", "codex_"].join(":")}|${["codex", "[0-9a-f-]{16,}"].join("_")})`, "i");
const privacyPatterns = [
  ["Windows user path", /[A-Za-z]:[\\/]Users[\\/](?!USER(?:NAME)?[\\/]|<)[^\\/\s"']+/i],
  ["macOS user path", /\/Users\/(?!USER(?:NAME)?\/|<)[^/\s"']+/],
  ["Codex task identifier", codexTaskPattern],
  ["Trellis workspace metadata", /\.trellis[\\/]workspace/i]
];

function portable(path) {
  return path.split(sep).join("/");
}

function parseRoot() {
  const argument = process.argv.find((value) => value.startsWith("--root="));
  return resolve(argument ? argument.slice("--root=".length) : process.cwd());
}

async function walk(root, directory = "") {
  const files = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, path));
    else if (entry.isFile()) files.push(portable(path));
  }
  return files.sort();
}

export async function verifyPublicPrivacy(root, { exported = false } = {}) {
  const files = exported ? (await walk(root)).filter((path) => path !== PUBLIC_MANIFEST) : await collectPublicSourceFiles(root);
  const findings = [];
  for (const required of publicRequiredFiles) {
    if (!files.includes(required)) findings.push(`missing required file: ${required}`);
  }
  for (const path of files) {
    if (publicExcludedPrefixes.some((prefix) => path.startsWith(prefix))) findings.push(`excluded path: ${path}`);
    if (/\.jsonl$/i.test(path) || /(?:^|\/)\.env$/i.test(path) || /\.(?:log|pem|pfx|key)$/i.test(path)) findings.push(`runtime or secret file: ${path}`);
    const extension = extname(path).toLowerCase();
    if (!textExtensions.has(extension)) {
      if (!allowedBinaryExtensions.has(extension)) findings.push(`unexpected binary type: ${path}`);
      continue;
    }
    const content = await readFile(join(root, path), "utf8");
    for (const [label, pattern] of [...secretPatterns, ...privacyPatterns]) {
      if (pattern.test(content)) findings.push(`${label}: ${path}`);
    }
  }
  if (findings.length) throw new Error(`Public privacy check failed:\n- ${[...new Set(findings)].join("\n- ")}`);
  return { files: files.length, root: portable(relative(process.cwd(), root) || ".") };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = parseRoot();
  const exported = process.argv.includes("--exported");
  const result = await verifyPublicPrivacy(root, { exported });
  console.log(`Public privacy check passed: ${result.files} files (${result.root})`);
}
