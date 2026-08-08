import { join, resolve } from "node:path";

export function localStateDirectory(environment = process.env, cwd = process.cwd()) {
  return join(resolve(environment.CODEPILOT_STATE_ROOT ?? cwd), ".codepilot");
}

export function modelStateDirectory(environment = process.env, cwd = process.cwd()) {
  return join(resolve(environment.CODEPILOT_MODEL_STATE_ROOT ?? environment.CODEPILOT_STATE_ROOT ?? cwd), ".codepilot");
}
