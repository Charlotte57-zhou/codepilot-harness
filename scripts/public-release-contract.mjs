import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export const PUBLIC_MANIFEST = "PUBLIC_MANIFEST.json";

export const publicRootFiles = Object.freeze([
  ".env.example",
  ".gitignore",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "DESIGN.md",
  "LICENSE",
  "PRODUCT.md",
  "README.md",
  "ROADMAP.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "package-lock.json",
  "package.json",
  "server.mjs"
]);

export const publicDirectories = Object.freeze([
  ".github",
  "desktop",
  "public",
  "src",
  "tests"
]);

export const publicExactFiles = Object.freeze([
  "demo-repo/.codepilot/skills/harness-audit/SKILL.md",
  "demo-repo/AGENT.md",
  "demo-repo/README.md",
  "demo-repo/games/plane-war/index.html",
  "demo-repo/src/auth/session.ts",
  "demo-repo/src/middleware/auth.ts",
  "docs/ARCHITECTURE.md",
  "docs/CLAUDE_AGENT_SDK_ALIGNMENT.md",
  "docs/CURRENT_STATE.md",
  "docs/DEMO_SCRIPT.md",
  "docs/PROVIDER_COMPATIBILITY.md",
  "docs/QUALITY_GATES.md",
  "docs/README.md",
  "docs/assets/screenshots/mcp.png",
  "docs/assets/screenshots/model-settings.png",
  "docs/assets/screenshots/responsive.png",
  "docs/assets/screenshots/workbench.png",
  "docs/bash-security-boundary.md",
  "evaluation/BAD_CASE_LEDGER.md",
  "evaluation/README.md",
  "evaluation/cases.mjs",
  "evaluation/lib.mjs",
  "evaluation/rebuild-report.mjs",
  "evaluation/report.mjs",
  "evaluation/results/README.md",
  "evaluation/run-controlled.mjs",
  "scripts/capture-desktop-visuals.mjs",
  "scripts/context-check.mjs",
  "scripts/export-public-release.mjs",
  "scripts/git-privacy-check.ps1",
  "scripts/harness-eval.mjs",
  "scripts/package-windows.mjs",
  "scripts/privacy-check.mjs",
  "scripts/public-release-contract.mjs",
  "scripts/verify-public-release.mjs"
]);

export const publicRequiredFiles = Object.freeze([
  "README.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "THIRD_PARTY_NOTICES.md",
  "package.json",
  "server.mjs",
  "desktop/main.mjs",
  "src/claude-agent-runtime.mjs",
  "public/index.html",
  "tests/server-resume-route.test.mjs",
  "demo-repo/.codepilot/skills/harness-audit/SKILL.md"
]);

export const publicExcludedPrefixes = Object.freeze([
  ".agents/",
  ".codex/",
  ".trellis/",
  "deployment/",
  "design-plans/",
  "dist/",
  "node_modules/"
]);

function portable(path) {
  return path.split(sep).join("/");
}

async function walk(root, directory) {
  const absolute = join(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Public release does not accept symlinks: ${portable(path)}`);
    if (entry.isDirectory()) files.push(...await walk(root, path));
    else if (entry.isFile()) files.push(portable(path));
  }
  return files;
}

export async function collectPublicSourceFiles(sourceRoot) {
  const root = resolve(sourceRoot);
  const files = [...publicRootFiles, ...publicExactFiles];
  for (const directory of publicDirectories) files.push(...await walk(root, directory));
  const unique = [...new Set(files)].sort();
  for (const path of unique) {
    const metadata = await stat(join(root, path)).catch(() => null);
    if (!metadata?.isFile()) throw new Error(`Public release file is missing: ${path}`);
    const relation = relative(root, join(root, path));
    if (relation.startsWith("..") || relation === "") throw new Error(`Invalid public release path: ${path}`);
  }
  return unique;
}
