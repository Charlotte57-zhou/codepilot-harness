import { resolve } from "node:path";
import { validateDeliveryContract } from "./delivery-contract.mjs";

const settingSourceValues = new Set(["user", "project", "local"]);
const permissionModes = new Set(["ask", "auto", "full"]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

/** Canonical, immutable, renderer-safe per-run configuration snapshot. */
export function createRuntimeOptions({
  runId,
  workspaceRoot,
  cwd = workspaceRoot,
  settingSources = ["project"],
  permissionMode = "ask",
  budgets,
  model = {},
  completion = {},
  deliveryContract
} = {}) {
  if (typeof runId !== "string" || !runId) throw new TypeError("RuntimeOptions requires runId");
  if (typeof workspaceRoot !== "string" || !workspaceRoot) throw new TypeError("RuntimeOptions requires workspaceRoot");
  if (!Array.isArray(settingSources) || settingSources.some((source) => !settingSourceValues.has(source))) {
    throw new TypeError("settingSources must contain only user, project, or local");
  }
  if (!permissionModes.has(permissionMode)) throw new TypeError("permissionMode must be ask, auto, or full");
  if (deliveryContract) validateDeliveryContract(deliveryContract);
  const normalizedBudgets = {
    maxTurns: positiveInteger(budgets?.maxTurns, "maxTurns"),
    maxRetries: positiveInteger(budgets?.maxRetries, "maxRetries"),
    deadlineMs: positiveInteger(budgets?.deadlineMs, "deadlineMs"),
    maxOutputTokens: positiveInteger(budgets?.maxOutputTokens, "maxOutputTokens"),
    compactionOutputTokens: positiveInteger(budgets?.compactionOutputTokens, "compactionOutputTokens")
  };
  return deepFreeze({
    schemaVersion: 1,
    runId,
    workspaceRoot: resolve(workspaceRoot),
    cwd: resolve(cwd),
    settingSources: [...new Set(settingSources)],
    permissionMode,
    budgets: normalizedBudgets,
    model: {
      provider: String(model.provider ?? "unknown"),
      name: String(model.name ?? "unknown"),
      capabilities: { ...(model.capabilities ?? {}) },
      reasoning: {
        enabled: model.reasoning?.enabled === true,
        effort: model.reasoning?.effort ?? null,
        supportedEfforts: [...(model.reasoning?.supportedEfforts ?? [])],
        thinkingMode: model.reasoning?.thinkingMode ?? "none",
        budgetTokens: model.reasoning?.budgetTokens ?? null
      }
    },
    deliveryContract: deliveryContract ? structuredClone(deliveryContract) : null,
    completion: {
      maxContinuationTurns: positiveInteger(completion.maxContinuationTurns ?? 3, "maxContinuationTurns")
    }
  });
}
