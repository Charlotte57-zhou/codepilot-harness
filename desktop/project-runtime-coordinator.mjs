import { isWorkspaceTargetId } from "../src/workspace-target-identity.mjs";

function normalizeNavigationIntent(value) {
  const intent = {};
  if (value?.newTask === true) intent.newTask = true;
  if (typeof value?.sessionId === "string" && /^[a-z0-9-]+$/i.test(value.sessionId)) {
    delete intent.newTask;
    intent.sessionId = value.sessionId;
  }
  if (isWorkspaceTargetId(value?.workspaceTargetId)) {
    intent.workspaceTargetId = value.workspaceTargetId;
  }
  return Object.freeze(intent);
}

export class ProjectRuntimeCoordinator {
  #queue = Promise.resolve();
  #runtimePool = new Map();
  #runtimeStarts = new Map();
  #maxWarmRuntimes;

  constructor({
    currentProject,
    currentTarget,
    currentRuntime,
    router,
    resolveProject,
    resolveTarget,
    inspectRuntime,
    startRuntime,
    stopRuntime,
    selectProject,
    maxWarmRuntimes = 3
  }) {
    this.currentProject = currentProject;
    this.currentTarget = currentTarget;
    this.currentRuntime = currentRuntime;
    this.router = router;
    this.resolveProject = resolveProject;
    this.resolveTarget = resolveTarget;
    this.inspectRuntime = inspectRuntime;
    this.startRuntime = startRuntime;
    this.stopRuntime = stopRuntime;
    this.selectProject = selectProject;
    this.#maxWarmRuntimes = Math.max(2, Number(maxWarmRuntimes) || 3);
    this.#runtimePool.set(this.#runtimeKey(currentProject, currentTarget), currentRuntime);
  }

  #runtimeKey(project, target) {
    return `${project.id}:${target.id}`;
  }

  #touchRuntime(key, runtime) {
    this.#runtimePool.delete(key);
    this.#runtimePool.set(key, runtime);
  }

  async #verifiedRuntime(project, target) {
    const key = this.#runtimeKey(project, target);
    const pooled = this.#runtimePool.get(key);
    if (pooled) {
      try {
        const state = await this.inspectRuntime(pooled, { refreshModelConfig: true });
        if (state.id !== project.id || state.workspaceTargetId !== target.id) throw new Error("Pooled Runtime identity mismatch");
        pooled.previewOrigin = state.previewOrigin;
        this.#touchRuntime(key, pooled);
        return pooled;
      } catch {
        this.#runtimePool.delete(key);
        await this.stopRuntime(pooled).catch(() => {});
      }
    }

    if (this.#runtimeStarts.has(key)) return this.#runtimeStarts.get(key);
    const starting = (async () => {
      const runtime = await this.startRuntime(project, target);
      try {
        const state = await this.inspectRuntime(runtime);
        if (state.id !== project.id) throw new Error("Target Runtime Project identity mismatch");
        if (state.workspaceTargetId !== target.id) throw new Error("Target Runtime Workspace identity mismatch");
        runtime.previewOrigin = state.previewOrigin;
        this.#touchRuntime(key, runtime);
        return runtime;
      } catch (error) {
        await this.stopRuntime(runtime).catch(() => {});
        throw error;
      }
    })();
    this.#runtimeStarts.set(key, starting);
    try {
      return await starting;
    } finally {
      this.#runtimeStarts.delete(key);
    }
  }

  async #trimRuntimePool() {
    while (this.#runtimePool.size > this.#maxWarmRuntimes) {
      const currentKey = this.#runtimeKey(this.currentProject, this.currentTarget);
      const entry = [...this.#runtimePool.entries()].find(([key]) => key !== currentKey);
      if (!entry) return;
      const [key, runtime] = entry;
      this.#runtimePool.delete(key);
      await this.stopRuntime(runtime).catch(() => {});
    }
  }

  async warmProject(projectId, navigationIntent = {}) {
    const project = this.resolveProject(projectId);
    if (!project) return false;
    const intent = normalizeNavigationIntent(navigationIntent);
    const target = await this.resolveTarget(project, intent);
    if (!target) return false;
    if (project.id === this.currentProject.id && target.id === this.currentTarget.id) return true;
    await this.#verifiedRuntime(project, target);
    await this.#trimRuntimePool();
    return true;
  }

  async discardProject(projectId, workspaceTargetId = null) {
    const prefix = `${projectId}:`;
    const keys = new Set([
      ...[...this.#runtimePool.keys()].filter((key) => key.startsWith(prefix)),
      ...[...this.#runtimeStarts.keys()].filter((key) => key.startsWith(prefix))
    ]);
    await Promise.allSettled([...keys].map(async (key) => {
      if (workspaceTargetId && key !== `${projectId}:${workspaceTargetId}`) return;
      await this.#runtimeStarts.get(key)?.catch(() => {});
      const runtime = this.#runtimePool.get(key);
      if (!runtime || runtime === this.currentRuntime) return;
      this.#runtimePool.delete(key);
      await this.stopRuntime(runtime);
    }));
  }

  switchProject(projectId, navigationIntent = {}) {
    const operation = this.#queue.catch(() => {}).then(() => this.#switchNow(projectId, navigationIntent));
    this.#queue = operation;
    return operation;
  }

  async #switchNow(projectId, navigationIntent) {
    const target = this.resolveProject(projectId);
    if (!target) throw new Error("Project not found");
    const intent = normalizeNavigationIntent(navigationIntent);
    const workspaceTarget = await this.resolveTarget(target, intent);
    if (!workspaceTarget) throw new Error("Workspace target not found");

    const currentState = await this.inspectRuntime(this.currentRuntime);
    if (currentState.running) {
      throw new Error(target.id === this.currentProject.id
        ? "当前任务正在运行，任务结束后才能切换任务。"
        : "当前任务正在运行，任务结束后才能切换项目。");
    }
    if (target.id === this.currentProject.id && workspaceTarget.id === this.currentTarget.id) {
      return Object.freeze({ projectId: target.id, workspaceTargetId: workspaceTarget.id, navigationIntent: intent, changed: false });
    }

    const previousProject = this.currentProject;
    const previousTarget = this.currentTarget;
    const previousRuntime = this.currentRuntime;
    let targetRuntime = null;
    let routerSwapped = false;
    try {
      targetRuntime = await this.#verifiedRuntime(target, workspaceTarget);

      this.router.swap(targetRuntime.port);
      routerSwapped = true;
      const selectedProject = await this.selectProject(target.id, workspaceTarget.id);
      this.currentProject = selectedProject;
      this.currentTarget = workspaceTarget;
      this.currentRuntime = targetRuntime;

      void this.#trimRuntimePool();
      return Object.freeze({ projectId: target.id, workspaceTargetId: workspaceTarget.id, navigationIntent: intent, changed: true });
    } catch (error) {
      if (routerSwapped) this.router.swap(previousRuntime.port);
      this.currentProject = previousProject;
      this.currentTarget = previousTarget;
      this.currentRuntime = previousRuntime;
      void this.#trimRuntimePool();
      throw error;
    }
  }

  async shutdown() {
    const starting = await Promise.allSettled([...this.#runtimeStarts.values()]);
    const runtimes = new Set(this.#runtimePool.values());
    for (const result of starting) {
      if (result.status === "fulfilled") runtimes.add(result.value);
    }
    await Promise.allSettled([...runtimes].map((runtime) => this.stopRuntime(runtime)));
    this.#runtimePool.clear();
  }
}
