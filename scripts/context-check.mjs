import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ignoredDirectories = new Set([".git", ".codepilot", "node_modules", "coverage", "dist", "artifacts"]);
const externalScheme = /^[a-z][a-z0-9+.-]*:/i;

async function markdownFilesUnder(directory) {
  const files = [];
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return files;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await markdownFilesUnder(join(directory, entry.name)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(join(directory, entry.name));
  }
  return files;
}

export async function canonicalMarkdownFiles(root) {
  const candidates = [join(root, "README.md"), join(root, "AGENTS.md")];
  for (const directory of ["docs", "design-plans"]) candidates.push(...await markdownFilesUnder(join(root, directory)));
  const existing = [];
  for (const path of candidates) {
    if ((await stat(path).catch(() => null))?.isFile()) existing.push(path);
  }
  return existing;
}

function localDestination(raw) {
  const value = raw.trim().replace(/^<|>$/g, "").split(/\s+["']/)[0];
  if (!value || value.startsWith("#") || value.startsWith("//") || externalScheme.test(value)) return null;
  return decodeURIComponent(value.split("#")[0].split("?")[0]);
}

export async function findBrokenLocalLinks(root, files) {
  const selectedFiles = files ?? await canonicalMarkdownFiles(root);
  const broken = [];
  for (const file of selectedFiles) {
    const text = await readFile(file, "utf8");
    const links = text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g);
    for (const match of links) {
      const destination = localDestination(match[1]);
      if (!destination) continue;
      const target = isAbsolute(destination) ? destination : resolve(dirname(file), destination);
      if (!await stat(target).catch(() => null)) {
        broken.push({ file: relative(root, file).replaceAll("\\", "/"), destination });
      }
    }
  }
  return broken;
}

export async function findStaleContextClaims(root) {
  const checks = [
    { file: "README.md", pattern: /SessionAggregate 单写入者|`ContextManager` 根据/, rule: "removed-runtime-owner" },
    { file: "docs/CURRENT_STATE.md", pattern: /226\/227|fixture 当前缺失/, rule: "stale-test-baseline" },
    { file: "docs/PROJECT_MEMORY.md", pattern: /Git work tree 元数据需要先修复/, rule: "stale-git-state" }
  ];
  const stale = [];
  for (const check of checks) {
    const path = join(root, check.file);
    if (!await stat(path).catch(() => null)) continue;
    const text = await readFile(path, "utf8");
    if (check.pattern.test(text)) stale.push({ file: check.file, rule: check.rule });
  }
  return stale;
}

export async function checkRepositoryContext(root = process.cwd()) {
  return {
    brokenLinks: await findBrokenLocalLinks(root),
    staleClaims: await findStaleContextClaims(root)
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkRepositoryContext();
  for (const item of result.brokenLinks) console.error(`context-check: broken link in ${item.file}: ${item.destination}`);
  for (const item of result.staleClaims) console.error(`context-check: stale claim in ${item.file}: ${item.rule}`);
  if (result.brokenLinks.length || result.staleClaims.length) process.exitCode = 1;
  else console.log("Context and Markdown link check passed.");
}
