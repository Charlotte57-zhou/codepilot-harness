import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export function summarizeResults(results, adapterNames) {
  return Object.fromEntries(adapterNames.map((name) => {
    const rows = results.filter((result) => result.adapter === name);
    const durations = rows.map((row) => row.durationMs).sort((a, b) => a - b);
    const passed = rows.filter((row) => row.validation.passed).length;
    return [name, {
      passed,
      total: rows.length,
      passRate: rows.length ? passed / rows.length : 0,
      medianDurationMs: durations[Math.floor(durations.length / 2)] ?? null
    }];
  }));
}

export function renderComparisonMarkdown(summary, cases) {
  const byAdapter = summary.byAdapter;
  return `# CodePilot controlled comparison\n\n- Architecture freeze: \`${summary.architectureFreeze}\`\n- Model: \`${summary.model}\`\n- Isolation: fresh workspace/session, Claude CLI \`--bare --no-session-persistence\`\n\n| Adapter | Passed | Pass rate | Median |\n| --- | ---: | ---: | ---: |\n${Object.entries(byAdapter).map(([name, value]) => `| ${name} | ${value.passed}/${value.total} | ${(value.passRate * 100).toFixed(0)}% | ${(value.medianDurationMs / 1000).toFixed(1)}s |`).join("\n")}\n\n## Case matrix\n\n| Case | Category | CodePilot | Claude CLI |\n| --- | --- | --- | --- |\n${cases.map((item) => `| ${item.id} | ${item.category} | ${summary.results.find((row) => row.caseId === item.id && row.adapter === "codepilot")?.validation.passed ? "PASS" : "FAIL"} | ${summary.results.find((row) => row.caseId === item.id && row.adapter === "claude-cli")?.validation.passed ? "PASS" : "FAIL"} |`).join("\n")}\n\nThis is a small synthetic engineering comparison, not a claim of production superiority. Native UI, permission, audit, recovery, and packaging are assessed separately.\n`;
}

async function atomicWrite(path, content) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

export async function writeComparisonReport({ resultsRoot, summary, cases }) {
  await mkdir(resultsRoot, { recursive: true });
  await atomicWrite(join(resultsRoot, "latest.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await atomicWrite(join(resultsRoot, "latest.md"), renderComparisonMarkdown(summary, cases));
}
