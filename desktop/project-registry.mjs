import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { isWorkspaceTargetId, workspaceTargetIdForPath } from "../src/workspace-target-identity.mjs";

const schemaVersion = 3;

function pathIdentity(path) {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export function projectIdForPath(path) {
  return `project-${createHash("sha256").update(pathIdentity(path)).digest("hex").slice(0, 16)}`;
}

function projectName(path) {
  return basename(path) || path;
}

function normalizedProjectName(name, workspacePath) {
  if (name === undefined) return projectName(workspacePath);
  if (typeof name !== "string" || !name.trim()) throw new TypeError("Project name must be a non-empty string");
  return name.trim().slice(0, 80);
}

async function canonicalDirectory(path) {
  const canonical = await realpath(resolve(path));
  if (!(await stat(canonical)).isDirectory()) throw new Error("Project workspace must be a directory");
  return canonical;
}

async function writeAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function normalizeTarget(target, fallback = {}) {
  const workspacePath = typeof target?.workspacePath === "string" ? resolve(target.workspacePath) : fallback.workspacePath;
  if (!workspacePath) return null;
  const kind = target?.kind === "worktree" ? "worktree" : "main";
  return Object.freeze({
    id: isWorkspaceTargetId(target?.id) ? target.id : workspaceTargetIdForPath(workspacePath),
    kind,
    workspacePath,
    branch: kind === "worktree" && typeof target?.branch === "string" ? target.branch : null,
    baseCommit: kind === "worktree" && typeof target?.baseCommit === "string" ? target.baseCommit : null,
    createdAt: target?.createdAt ?? fallback.createdAt ?? null
  });
}

function normalizeRecord(project) {
  if (!project || typeof project !== "object") return null;
  if (typeof project.id !== "string" || typeof project.name !== "string" || typeof project.workspacePath !== "string") return null;
  const workspacePath = resolve(project.workspacePath);
  const savedTargets = Array.isArray(project.targets) ? project.targets.map((target) => normalizeTarget(target)).filter(Boolean) : [];
  const mainTarget = savedTargets.find((target) => target.kind === "main" && pathIdentity(target.workspacePath) === pathIdentity(workspacePath))
    ?? normalizeTarget(null, { workspacePath, createdAt: project.createdAt });
  const targets = [mainTarget, ...savedTargets.filter((target) => target.id !== mainTarget.id && target.kind === "worktree")];
  return Object.freeze({
    id: project.id,
    name: project.name.trim().slice(0, 80) || projectName(project.workspacePath),
    workspacePath,
    pinned: project.pinned === true,
    targets: Object.freeze(targets),
    createdAt: project.createdAt ?? null,
    lastOpenedAt: project.lastOpenedAt ?? null
  });
}

function parseCurrentTarget(target) {
  if (!target || typeof target !== "object") throw new Error("Project registry contains an invalid workspace target");
  if (!isWorkspaceTargetId(target.id)) throw new Error("Project registry target id is invalid");
  if (!["main", "worktree"].includes(target.kind)) throw new Error("Project registry target kind is invalid");
  if (typeof target.workspacePath !== "string" || !target.workspacePath) throw new Error("Project registry target path is invalid");
  return normalizeTarget(target);
}

function parseCurrentRecord(project) {
  if (!project || typeof project !== "object") throw new Error("Project registry contains an invalid project");
  if (typeof project.id !== "string" || !project.id) throw new Error("Project registry project id is invalid");
  if (typeof project.name !== "string" || !project.name.trim()) throw new Error("Project registry project name is invalid");
  if (typeof project.workspacePath !== "string" || !project.workspacePath) throw new Error("Project registry workspace path is invalid");
  if (typeof project.pinned !== "boolean") throw new Error("Project registry pinned state is invalid");
  if (!Array.isArray(project.targets) || !project.targets.length) throw new Error("Project registry targets are required");
  const workspacePath = resolve(project.workspacePath);
  const targets = project.targets.map(parseCurrentTarget);
  const mainTargets = targets.filter((target) => target.kind === "main" && pathIdentity(target.workspacePath) === pathIdentity(workspacePath));
  if (mainTargets.length !== 1) throw new Error("Project registry requires exactly one matching main target");
  if (new Set(targets.map((target) => target.id)).size !== targets.length) throw new Error("Project registry target ids must be unique");
  return Object.freeze({
    id: project.id,
    name: project.name.trim().slice(0, 80),
    workspacePath,
    pinned: project.pinned,
    targets: Object.freeze(targets),
    createdAt: project.createdAt ?? null,
    lastOpenedAt: project.lastOpenedAt ?? null
  });
}

function pinnedFirst(projects) {
  return [...projects].sort((left, right) => Number(right.pinned) - Number(left.pinned));
}

export class ProjectRegistry {
  constructor({ registryPath, defaultWorkspacePath, now = () => new Date().toISOString() } = {}) {
    if (!registryPath) throw new TypeError("ProjectRegistry requires registryPath");
    if (!defaultWorkspacePath) throw new TypeError("ProjectRegistry requires defaultWorkspacePath");
    this.registryPath = resolve(registryPath);
    this.defaultWorkspacePath = resolve(defaultWorkspacePath);
    this.now = now;
    this.state = null;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    const defaultPath = await canonicalDirectory(this.defaultWorkspacePath);
    let saved = null;
    try {
      saved = JSON.parse(await readFile(this.registryPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("Project registry is unreadable", { cause: error });
    }
    if (saved && saved.schemaVersion !== schemaVersion) throw new Error(`Unsupported Project registry schema: ${saved.schemaVersion ?? "missing"}`);
    if (saved && !Array.isArray(saved.projects)) throw new Error("Project registry projects are required");
    const projects = saved ? saved.projects.map(parseCurrentRecord) : [];
    let defaultProject = projects.find((project) => pathIdentity(project.workspacePath) === pathIdentity(defaultPath));
    if (!defaultProject) {
      const timestamp = this.now();
      defaultProject = normalizeRecord({
        id: projectIdForPath(defaultPath),
        name: projectName(defaultPath),
        workspacePath: defaultPath,
        createdAt: timestamp,
        lastOpenedAt: timestamp
      });
      projects.unshift(defaultProject);
    }
    if (saved && !projects.some((project) => project.id === saved.selectedProjectId)) throw new Error("Project registry selected Project is invalid");
    const selectedProjectId = saved ? saved.selectedProjectId : defaultProject.id;
    const selectedProject = projects.find((project) => project.id === selectedProjectId);
    if (saved && !selectedProject.targets.some((target) => target.id === saved.selectedTargetId)) throw new Error("Project registry selected target is invalid");
    const selectedTargetId = saved ? saved.selectedTargetId : selectedProject.targets[0].id;
    this.state = { schemaVersion, defaultProjectId: defaultProject.id, selectedProjectId, selectedTargetId, projects };
    await this.#persist();
    return this.snapshot();
  }

  snapshot() {
    if (!this.state) throw new Error("ProjectRegistry has not been loaded");
    return Object.freeze({
      schemaVersion,
      defaultProjectId: this.state.defaultProjectId,
      selectedProjectId: this.state.selectedProjectId,
      selectedTargetId: this.state.selectedTargetId,
      projects: Object.freeze(this.state.projects.map((project) => Object.freeze({ ...project })))
    });
  }

  current() {
    const snapshot = this.snapshot();
    return snapshot.projects.find((project) => project.id === snapshot.selectedProjectId);
  }

  get(projectId) {
    return this.snapshot().projects.find((project) => project.id === projectId);
  }

  target(projectId, targetId) {
    const project = this.get(projectId);
    if (!project) return null;
    return project.targets.find((target) => target.id === targetId) ?? null;
  }

  async add(workspacePath, { name } = {}) {
    const canonical = await canonicalDirectory(workspacePath);
    const existing = this.state.projects.find((project) => pathIdentity(project.workspacePath) === pathIdentity(canonical));
    if (existing) return existing;
    const timestamp = this.now();
    const project = normalizeRecord({
      id: projectIdForPath(canonical),
      name: normalizedProjectName(name, canonical),
      workspacePath: canonical,
      createdAt: timestamp,
      lastOpenedAt: timestamp
    });
    this.state = { ...this.state, projects: pinnedFirst([project, ...this.state.projects]) };
    await this.#persist();
    return project;
  }

  async select(projectId, targetId) {
    const project = this.get(projectId);
    if (!project) throw new Error("Project not found");
    const target = targetId ? project.targets.find((candidate) => candidate.id === targetId) : project.targets[0];
    if (!target) throw new Error("Workspace target not found");
    const timestamp = this.now();
    const projects = this.state.projects.map((candidate) => candidate.id === projectId
      ? normalizeRecord({ ...candidate, lastOpenedAt: timestamp })
      : candidate);
    this.state = { ...this.state, selectedProjectId: projectId, selectedTargetId: target.id, projects };
    await this.#persist();
    return this.get(projectId);
  }

  async rename(projectId, name) {
    const project = this.get(projectId);
    if (!project) throw new Error("Project not found");
    const projects = this.state.projects.map((candidate) => candidate.id === projectId
      ? normalizeRecord({ ...candidate, name: normalizedProjectName(name, candidate.workspacePath) })
      : candidate);
    this.state = { ...this.state, projects: pinnedFirst(projects) };
    await this.#persist();
    return this.get(projectId);
  }

  async setPinned(projectId, pinned) {
    const project = this.get(projectId);
    if (!project) throw new Error("Project not found");
    const projects = this.state.projects.map((candidate) => candidate.id === projectId
      ? normalizeRecord({ ...candidate, pinned: pinned === true })
      : candidate);
    this.state = { ...this.state, projects: pinnedFirst(projects) };
    await this.#persist();
    return this.get(projectId);
  }

  async addTarget(projectId, value) {
    const project = this.get(projectId);
    if (!project) throw new Error("Project not found");
    const canonical = await canonicalDirectory(value?.workspacePath);
    const target = normalizeTarget({ ...value, workspacePath: canonical, kind: "worktree" });
    if (!target) throw new TypeError("Workspace target requires a path");
    if (project.targets.some((candidate) => pathIdentity(candidate.workspacePath) === pathIdentity(target.workspacePath))) {
      throw new Error("Workspace target already exists");
    }
    const projects = this.state.projects.map((candidate) => candidate.id === projectId
      ? normalizeRecord({ ...candidate, targets: [...candidate.targets, target] })
      : candidate);
    this.state = { ...this.state, projects };
    await this.#persist();
    return this.target(projectId, target.id);
  }

  async removeTarget(projectId, targetId) {
    const project = this.get(projectId);
    if (!project) throw new Error("Project not found");
    const target = this.target(projectId, targetId);
    if (!target) throw new Error("Workspace target not found");
    if (target.kind === "main") throw new Error("Main workspace target cannot be removed");
    const projects = this.state.projects.map((candidate) => candidate.id === projectId
      ? normalizeRecord({ ...candidate, targets: candidate.targets.filter((item) => item.id !== targetId) })
      : candidate);
    this.state = {
      ...this.state,
      selectedTargetId: this.state.selectedTargetId === targetId ? project.targets[0].id : this.state.selectedTargetId,
      projects
    };
    await this.#persist();
  }

  async remove(projectId) {
    if (projectId === this.state.defaultProjectId) throw new Error("Default Project cannot be removed");
    if (!this.get(projectId)) throw new Error("Project not found");
    const projects = this.state.projects.filter((project) => project.id !== projectId);
    const defaultProject = projects.find((project) => project.id === this.state.defaultProjectId);
    this.state = {
      ...this.state,
      selectedProjectId: this.state.selectedProjectId === projectId ? defaultProject.id : this.state.selectedProjectId,
      selectedTargetId: this.state.selectedProjectId === projectId ? defaultProject.targets[0].id : this.state.selectedTargetId,
      projects
    };
    await this.#persist();
  }

  #persist() {
    const snapshot = this.snapshot();
    const operation = this.writeQueue.catch(() => {}).then(() => writeAtomically(this.registryPath, snapshot));
    this.writeQueue = operation;
    return operation;
  }
}
