import { cp, mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export function projectStateRoot(userDataPath, projectId) {
  if (!userDataPath || !projectId) throw new TypeError("userDataPath and projectId are required");
  return join(resolve(userDataPath), "projects", projectId);
}

export function applicationModelStateRoot(userDataPath) {
  if (!userDataPath) throw new TypeError("userDataPath is required");
  return resolve(userDataPath);
}

export function desktopUserDataPath({ appDataPath, currentUserDataPath, isPackaged }) {
  if (!appDataPath || !currentUserDataPath) throw new TypeError("appDataPath and currentUserDataPath are required");
  return isPackaged ? join(resolve(appDataPath), "CodePilot Desktop") : resolve(currentUserDataPath);
}

export function bundledDemoSource({ appRoot, resourcesPath, isPackaged }) {
  return join(resolve(isPackaged ? resourcesPath : appRoot), "demo-repo");
}

export function runtimeAppRoot({ appRoot, resourcesPath, isPackaged }) {
  return resolve(isPackaged ? join(resourcesPath, "app.asar.unpacked") : appRoot);
}

export async function ensureDemoWorkspace({ appRoot, resourcesPath, userDataPath, isPackaged }) {
  const source = bundledDemoSource({ appRoot, resourcesPath, isPackaged });
  if (!isPackaged) return source;

  const target = join(resolve(userDataPath), "demo-workspace");
  try {
    if ((await stat(target)).isDirectory()) return target;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await mkdir(resolve(userDataPath), { recursive: true });
  try {
    await cp(source, target, { recursive: true, errorOnExist: true, force: false });
  } catch (error) {
    if (error?.code !== "ERR_FS_CP_EEXIST") throw error;
  }
  return target;
}
