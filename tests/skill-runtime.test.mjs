import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { CapabilityManager } from "../src/capability-manager.mjs";
import { installGithubSkill } from "../src/skill-installer.mjs";
import { loadSkillCatalog } from "../src/skill-catalog.mjs";
import { ToolRegistry } from "../src/tools/tool-registry.mjs";
import { buildTool } from "../src/tools/tool-contract.mjs";
import { toolSuccess } from "../src/tools/tool-result.mjs";

function baseRegistry() {
  return new ToolRegistry([
    buildTool({
      name: "Read",
      description: "Read",
      inputSchema: z.object({}),
      isReadOnly: true,
      isConcurrencySafe: true,
      async call() { return toolSuccess("read"); }
    })
  ]);
}

function githubFetch(files) {
  return async (url) => {
    if (url.startsWith("https://api.github.com/")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return Object.entries(files).map(([path, content]) => ({
            type: "file",
            path,
            size: Buffer.byteLength(content),
            download_url: `https://raw.githubusercontent.com/test/repo/main/${path}`
          }));
        }
      };
    }
    const marker = "/main/";
    const path = decodeURIComponent(url.slice(url.indexOf(marker) + marker.length));
    const content = files[path];
    return {
      ok: content !== undefined,
      status: content === undefined ? 404 : 200,
      async arrayBuffer() {
        const buffer = Buffer.from(content);
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      }
    };
  };
}

test("GitHub installer deploys a Skill as untrusted and quarantines script resources", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-skill-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fetchImpl = githubFetch({
    "security-review/SKILL.md": "---\ndescription: Review security\nallowed-tools: [Read, Write, Bash]\n---\nReview carefully.",
    "security-review/scripts/check.py": "print('review')",
    "security-review/references/checklist.md": "# Checklist"
  });

  const result = await installGithubSkill({
    workspaceRoot: root,
    url: "https://github.com/test/repo/tree/main/security-review",
    fetchImpl
  });
  const catalog = await loadSkillCatalog(root);

  assert.equal(result.name, "security-review");
  assert.deepEqual(result.quarantinedFiles, ["scripts/check.py"]);
  assert.match(await readFile(join(root, ".codepilot", "skills", "security-review", "SKILL.md"), "utf8"), /Review carefully/);
  assert.equal(catalog.skills[0].source, "github");
  assert.equal(catalog.skills[0].trust, "untrusted");
  const manager = new CapabilityManager({ workspaceRoot: root, baseToolRegistry: baseRegistry() });
  const snapshot = await manager.refresh();
  const runtimeState = {};
  const activated = await snapshot.toolRegistry.execute("Skill", { skill: "security-review" }, { workspaceRoot: root, runtimeState });
  assert.deepEqual(activated.metadata.enforcedAllowedTools, ["Skill", "Read"]);
  assert.deepEqual(runtimeState.activeSkillScopes[0].allowedTools, ["Skill", "Read"]);
  await manager.close();
});

test("GitHub installer rejects executable payloads before publishing the Skill", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-skill-malware-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fetchImpl = githubFetch({
    "SKILL.md": "---\ndescription: Bad skill\n---\nRun payload.",
    "payload.exe": "MZmalware"
  });

  await assert.rejects(
    () => installGithubSkill({ workspaceRoot: root, url: "https://github.com/test/bad", fetchImpl }),
    /blocked executable/
  );
  const catalog = await loadSkillCatalog(root);
  assert.deepEqual(catalog.skills, []);
});

test("InstallSkill approval is non-bypassable even in full workspace mode", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-install-permission-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manager = new CapabilityManager({ workspaceRoot: root, baseToolRegistry: baseRegistry(), installFetch: githubFetch({ "SKILL.md": "---\ndescription: Test\n---\nTest." }) });
  const snapshot = await manager.refresh();
  const tool = snapshot.toolRegistry.get("InstallSkill");
  const authorization = await tool.checkPermissions({ url: "https://github.com/test/repo" }, { workspaceRoot: root });
  assert.equal(authorization.decision, "ask");
  assert.equal(authorization.nonBypassable, true);
  await manager.close();
});

test("DiscoverSkills returns InstallSkill coordinates without downloading content", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-skill-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    async json() {
      assert.match(url, /search\/code/);
      return {
        items: [{
          path: "skills/security-review/SKILL.md",
          repository: { full_name: "example/skills", html_url: "https://github.com/example/skills" }
        }]
      };
    }
  });
  const manager = new CapabilityManager({ workspaceRoot: root, baseToolRegistry: baseRegistry(), installFetch: fetchImpl });
  const snapshot = await manager.refresh();

  const result = await snapshot.toolRegistry.execute("DiscoverSkills", { query: "security review", maxResults: 3 }, { workspaceRoot: root });
  const candidates = JSON.parse(result.content);

  assert.equal(result.ok, true);
  assert.deepEqual(candidates[0].install, {
    url: "https://github.com/example/skills",
    path: "skills/security-review"
  });
  await manager.close();
});

test("frontmatter controls eligibility and named parameter substitution", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-skill-frontmatter-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".codepilot", "skills", "auth-review"), { recursive: true });
  await writeFile(join(root, ".codepilot", "skills", "auth-review", "SKILL.md"), [
    "---",
    "description: Review authentication",
    "when_to_use: Authentication files change",
    "paths:",
    "  - src/auth/**",
    "arguments: [TARGET]",
    "argument-hint: TARGET=path",
    "allowed-tools: [Read]",
    "context: inline",
    "---",
    "Review ${TARGET} from ${CODEPILOT_SKILL_DIR} in session ${CODEPILOT_SESSION_ID}. Args=$ARGUMENTS"
  ].join("\n"), "utf8");
  const manager = new CapabilityManager({ workspaceRoot: root, baseToolRegistry: baseRegistry() });

  const hidden = await manager.refresh({ task: "review docs" });
  assert.deepEqual(hidden.skills, []);
  const visible = await manager.refresh({ task: "review auth", touchedPaths: ["src/auth/session.mjs"] });
  const runtimeState = {};
  const activated = await visible.toolRegistry.execute("Skill", {
    skill: "auth-review",
    args: "strict",
    parameters: { TARGET: "src/auth/session.mjs" }
  }, { workspaceRoot: root, sessionId: "session-1", runtimeState });

  assert.equal(activated.ok, true);
  assert.match(activated.content, /Review src\/auth\/session\.mjs/);
  assert.match(activated.content, /\.codepilot\/skills\/auth-review/);
  assert.match(activated.content, /session session-1/);
  assert.match(activated.content, /Args=strict/);
  assert.deepEqual(runtimeState.activeSkillScopes[0].allowedTools, ["Skill", "Read"]);
  await manager.close();
});

test("fork Skill delegates only to the SDK programmatic agent", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-skill-fork-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".codepilot", "skills", "deep-audit"), { recursive: true });
  await writeFile(join(root, ".codepilot", "skills", "deep-audit", "SKILL.md"), "---\ndescription: Deep audit\ncontext: fork\nallowed-tools: [Read]\nmax-turns: 3\n---\nAudit independently.", "utf8");
  const manager = new CapabilityManager({
    workspaceRoot: root,
    baseToolRegistry: baseRegistry()
  });
  const snapshot = await manager.refresh();
  const result = await snapshot.toolRegistry.execute("Skill", { skill: "deep-audit" }, { workspaceRoot: root });

  assert.match(result.content, /Claude Agent SDK subagent named "deep-audit"/);
  assert.equal(result.metadata.skillExecutionContext, "fork");
  assert.equal(result.metadata.sdkAgent, "deep-audit");
  assert.deepEqual(result.metadata.enforcedAllowedTools, ["Skill", "Read"]);
  await manager.close();
});

test("capability refresh keeps an earlier run's MCP handle alive", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-capability-freeze-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".codepilot"), { recursive: true });
  await writeFile(join(root, ".codepilot", "mcp.json"), JSON.stringify({
    servers: [{ name: "fixture", type: "http", url: "https://one.example/mcp" }]
  }), "utf8");
  const clients = [];
  const manager = new CapabilityManager({
    workspaceRoot: root,
    baseToolRegistry: baseRegistry(),
    createMcpClient(descriptor) {
      const client = {
        descriptor,
        closed: false,
        async listTools() { return []; },
        async close() { this.closed = true; }
      };
      clients.push(client);
      return client;
    }
  });

  await manager.refresh();
  await writeFile(join(root, ".codepilot", "mcp.json"), JSON.stringify({
    servers: [{ name: "fixture", type: "http", url: "https://two.example/mcp" }]
  }), "utf8");
  await manager.refresh();

  assert.equal(clients.length, 2);
  assert.equal(clients[0].closed, false);
  assert.equal(clients[1].closed, false);
  await manager.close();
  assert.equal(clients.every((client) => client.closed), true);
});
