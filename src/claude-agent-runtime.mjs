import { query as claudeQuery } from "@anthropic-ai/claude-agent-sdk";
import { RunIncompleteError, RunProgressLedger } from "./run-progress-ledger.mjs";
import { diffWorkspaceSnapshots, snapshotWorkspace } from "./workspace-mutation-tracker.mjs";
import { verifyDeliveryContract } from "./delivery-verifier.mjs";
import { anthropicSdkEnvironment, resolveAnthropicProviderProfile } from "./anthropic-provider-profile.mjs";
import { isSdkTaskTool, normalizeSdkTaskResult } from "./sdk-task-event-normalizer.mjs";
import { codePilotToolName } from "./sdk-tool-bridge.mjs";
import { validateSdkBuiltInToolInput } from "./sdk-built-in-tool-policy.mjs";
import { resolveActivityTaxonomy } from "../public/activity-taxonomy.js";

const mutationTools = new Set(["Write", "Edit", "NotebookEdit", "Bash"]);

function bounded(value, max = 8_000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  return text.length <= max ? text : `${text.slice(0, max)}\n...[${text.length - max} chars omitted]`;
}

function boundedInput(input = {}) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (typeof value === "string" && value.length > 8_000) return [key, `${value.slice(0, 8_000)}\n...[${value.length - 8_000} chars omitted]`];
    return [key, value];
  }));
}

function permissionMode(mode) {
  if (mode === "full") return "acceptEdits";
  if (mode === "auto") return "acceptEdits";
  return "default";
}

function toolDetail(toolName, input) {
  return input.file_path ?? input.path ?? input.command ?? input.pattern ?? toolName;
}

function sdkToolPresentation(toolName, input, phase = "requested") {
  const detail = String(toolDetail(toolName, input));
  const completed = phase === "completed";
  if (toolName === "Bash") return { title: completed ? "已运行命令" : "运行命令", detail };
  if (toolName === "Write") return { title: completed ? "已写入文件" : "写入文件", detail };
  if (toolName === "Edit" || toolName === "NotebookEdit") return { title: completed ? "已编辑文件" : "编辑文件", detail };
  if (toolName === "Read") return { title: completed ? "已读取文件" : "读取文件", detail };
  if (toolName === "Glob" || toolName === "Grep") return { title: completed ? "已检查项目" : "检查项目", detail };
  if (isSdkTaskTool(toolName)) return { title: "更新任务清单", detail: input.activeForm ?? input.subject ?? input.taskId ?? "同步任务状态" };
  return { title: toolName, detail };
}

function cancellation(signal) {
  const reason = signal?.reason ?? {};
  return {
    reason: reason.reason ?? "user_stop",
    code: reason.code ?? "USER_STOP",
    message: reason.message ?? "用户停止了当前任务。"
  };
}

export class ClaudeAgentRuntime {
  constructor({ queryImpl = claudeQuery } = {}) {
    this.queryImpl = queryImpl;
  }

  async run({
    sessionId,
    runId,
    task,
    workspaceRoot,
    provider = "anthropic",
    providerProfile: suppliedProviderProfile,
    model,
    reasoning,
    apiKey,
    baseUrl,
    signal,
    permissionMode: codePilotPermissionMode = "ask",
    budgetPolicy,
    settingSources = ["project"],
    resume,
    requestApproval,
    appendEvent,
    beforeFinal,
    deliveryContract,
    browserRuntime,
    workspacePreviewOrigin,
    visualReviewer,
    mcpServers,
    extensionToolRegistry,
    extensionToolContext,
    additionalSystemContext = "",
    agents
  }) {
    const providerProfile = suppliedProviderProfile ?? resolveAnthropicProviderProfile({
      provider,
      baseUrl,
      model,
      apiKey
    });
    const abortController = new AbortController();
    const abort = () => abortController.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });

    let sdkSessionId = resume;
    let turn = 0;
    let lastResult;
    let successfulMutations = 0;
    const progressLedger = new RunProgressLedger({ task, deliveryContract, maxContinuationTurns: 3 });
    let workspaceSnapshot = await snapshotWorkspace(workspaceRoot);
    let evidenceSequence = 0;
    const calls = new Map();
    const completedCallIds = new Set();
    const mode = permissionMode(codePilotPermissionMode);
    const transition = (to, detail, terminalReason) => appendEvent(sessionId, "run_state_changed", {
      from: null, to, detail, terminalReason, runId, owner: "claude_agent_sdk"
    });
    const closePendingCalls = async ({ cancelled = false, code, message }) => {
      for (const [toolCallId, call] of calls) {
        if (completedCallIds.has(toolCallId)) continue;
        completedCallIds.add(toolCallId);
        await appendEvent(sessionId, cancelled ? "tool_cancelled" : "tool_completed", {
          tool: call.name,
          toolCallId,
          ok: false,
          error: { code, message },
          summary: message,
          batchId: call.batchId,
          runId,
          presentation: sdkToolPresentation(call.name, call.input, cancelled ? "cancelled" : "completed")
        });
      }
    };

    const observeWorkspaceMutation = async ({ sourceToolCallIds = [], owner = "delivery_verifier" } = {}) => {
      const nextSnapshot = await snapshotWorkspace(workspaceRoot);
      const mutation = diffWorkspaceSnapshots(workspaceSnapshot, nextSnapshot);
      workspaceSnapshot = nextSnapshot;
      if (mutation.fileChanges.length || mutation.opaqueChanges.length) {
        const result = { ok: true, content: `Detected ${mutation.fileChanges.length + mutation.opaqueChanges.length} SDK workspace changes`, metadata: mutation };
        progressLedger.observe({ name: "Bash", input: { access: "write" } }, result);
        successfulMutations += mutation.fileChanges.length + mutation.opaqueChanges.length;
        await appendEvent(sessionId, "workspace_mutation_observed", {
          version: 1,
          observationId: `sdk-workspace-diff-${++evidenceSequence}`,
          sourceToolCallIds,
          fileChanges: mutation.fileChanges,
          opaqueChanges: mutation.opaqueChanges,
          scanTruncated: mutation.scanTruncated,
          scannedFiles: mutation.scannedFiles,
          source: "claude_agent_sdk",
          owner,
          runId
        });
      }
      return nextSnapshot;
    };

    const refreshDeliveryEvidence = async () => {
      const nextSnapshot = await observeWorkspaceMutation();
      return verifyDeliveryContract({
        contract: deliveryContract,
        ledger: progressLedger,
        workspaceRoot,
        workspacePreviewOrigin,
        browserRuntime,
        changedPaths: [...nextSnapshot.files.keys()],
        task,
        visualReviewer,
        onEvidence: async ({ name, result, revision }) => appendEvent(sessionId, "delivery_evidence_recorded", {
          tool: name,
          ok: result.ok,
          metadata: result.metadata,
          error: result.error,
          revision,
          source: "claude_agent_sdk",
          runId
        })
      });
    };

    const canUseTool = async (toolName, input, options = {}) => {
      const workspaceDecision = await validateSdkBuiltInToolInput(toolName, input, workspaceRoot);
      if (workspaceDecision.behavior === "deny") return workspaceDecision;
      const extensionName = codePilotToolName(toolName);
      const extensionTool = extensionName ? extensionToolRegistry?.get(extensionName) : null;
      const effectiveToolName = extensionName ?? toolName;
      let requiresExplicitApproval = false;
      const permissionContext = extensionToolContext?.(effectiveToolName, { toolUseId: options.toolUseID })
        ?? { workspaceRoot, signal: abortController.signal };
      const blockingScope = (permissionContext.runtimeState?.activeSkillScopes ?? [])
        .find((scope) => Array.isArray(scope.allowedTools) && !scope.allowedTools.includes(effectiveToolName));
      if (blockingScope) {
        return {
          behavior: "deny",
          message: `Tool ${effectiveToolName} is outside active Skill ${blockingScope.skill}`,
          interrupt: false
        };
      }
      if (extensionTool) {
        const validation = await extensionToolRegistry.validate(extensionName, input, permissionContext);
        if (validation.result) {
          return {
            behavior: "deny",
            message: validation.result.error?.message ?? `CodePilot rejected invalid ${extensionName} input`,
            interrupt: false
          };
        }
        const policy = await extensionTool.checkPermissions(validation.input, permissionContext);
        if (policy.decision === "deny") {
          return { behavior: "deny", message: policy.message ?? `CodePilot policy denied ${extensionName}`, interrupt: false };
        }
        if (policy.decision === "allow") return { behavior: "allow", updatedInput: validation.input };
        requiresExplicitApproval = policy.nonBypassable === true;
        input = validation.input;
      }
      if (codePilotPermissionMode === "full" && !requiresExplicitApproval) {
        return { behavior: "allow", updatedInput: input };
      }
      await transition("awaiting_permission", `等待批准 ${toolName}`);
      const decision = await requestApproval({
        tool: extensionName ?? toolName,
        summary: `${extensionName ?? toolName} 请求执行`,
        matcher: { toolName: extensionName ?? toolName, path: input.file_path ?? input.path, command: input.command },
        presentation: extensionTool
          ? extensionTool.renderToolUseMessage(input, { phase: "requested" })
          : sdkToolPresentation(toolName, input),
        input: boundedInput(input),
        suggestions: options.suggestions?.length ?? 0
      });
      await transition("executing_tools", `${toolName} 权限已处理`);
      if (decision === "allow_once" || decision === "allow_session") {
        return { behavior: "allow", updatedInput: input };
      }
      return { behavior: "deny", message: "CodePilot permission policy denied this tool call", interrupt: false };
    };

    const env = {
      ...anthropicSdkEnvironment(providerProfile),
      CLAUDE_AGENT_SDK_CLIENT_APP: "codepilot-harness/0.1.0"
    };

    try {
      await transition("sampling", "Claude Agent SDK 已接管 Agent Loop");
      const stream = this.queryImpl({
        prompt: task,
        options: {
          cwd: workspaceRoot,
          model: providerProfile.model,
          thinking: reasoning?.enabled
            ? reasoning.thinkingMode === "enabled"
              ? { type: "enabled", budgetTokens: reasoning.budgetTokens ?? 8_192 }
              : { type: "adaptive" }
            : { type: "disabled" },
          effort: reasoning?.enabled && reasoning?.supportedEfforts?.includes(reasoning.effort)
            ? reasoning.effort
            : undefined,
          resume: resume || undefined,
          abortController,
          maxTurns: budgetPolicy.maxTurns,
          permissionMode: mode,
          allowDangerouslySkipPermissions: false,
          canUseTool,
          settingSources,
          tools: { type: "preset", preset: "claude_code" },
          mcpServers,
          agents,
          includePartialMessages: false,
          enableFileCheckpointing: true,
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: [
              "你在 CodePilot 桌面 Harness 中运行。复杂任务先建立任务清单，持续执行和验证，只有全部验收条件具备证据后再结束。Task 工具 ID 是跨轮次延续的不透明会话身份；不要把 Task ID 写成 X/Y 进度序号，可见任务进度由 CodePilot 的当前运行投影负责。",
              bounded(additionalSystemContext, 14_000)
            ].filter(Boolean).join("\n\n")
          },
          hooks: {
            Stop: [{ hooks: [async () => {
              const completion = await refreshDeliveryEvidence();
              await appendEvent(sessionId, "completion_gate_evaluated", {
                accepted: completion.accepted,
                exhausted: completion.exhausted ?? false,
                reasons: completion.reasons,
                progress: completion.snapshot,
                owner: "claude_agent_sdk_stop_hook",
                runId
              });
              if (completion.accepted || completion.exhausted) return { continue: true };
              return {
                continue: true,
                decision: "block",
                reason: completion.feedback,
                hookSpecificOutput: { hookEventName: "Stop", additionalContext: completion.feedback }
              };
            }] }]
          },
          env
        }
      });

      for await (const message of stream) {
        sdkSessionId = message.session_id ?? sdkSessionId;
        if (message.type === "system" && message.subtype === "init") {
          await appendEvent(sessionId, "claude_sdk_session_initialized", {
            sdkSessionId,
            model: message.model,
            provider: providerProfile.id,
            tools: message.tools,
            permissionMode: message.permissionMode,
            cwd: message.cwd,
            runId
          });
          continue;
        }
        if (message.type === "system" && message.subtype === "api_retry") {
          const status = Number.isFinite(message.error_status) ? message.error_status : null;
          const category = status === 401 || status === 403
            ? "authentication"
            : status === 429 ? "rate_limit" : status >= 500 ? "service" : "network";
          const attempt = Number(message.attempt ?? 1);
          const maxRetries = Number(message.max_retries ?? budgetPolicy.maxRetries ?? 0);
          const delayMs = Number(message.retry_delay_ms ?? 0);
          const detail = category === "authentication"
            ? "Provider rejected the configured credential"
            : status === 429
            ? `Provider rate limit; retry ${attempt}/${maxRetries} in ${delayMs} ms`
            : `Provider request failed; retry ${attempt}/${maxRetries} in ${delayMs} ms`;
          await appendEvent(sessionId, "model_attempt_failed", {
            turn: Math.max(turn, 1), attempt, maxAttempts: maxRetries + 1,
            category, status, message: bounded(message.error ?? detail, 400),
            retryable: category !== "authentication", source: "claude_agent_sdk", runId
          });
          if (category === "authentication") {
            const error = new Error(detail);
            error.code = "authentication_failed";
            error.status = status;
            throw error;
          }
          await transition("retry_wait", detail);
          await appendEvent(sessionId, "model_retry_scheduled", {
            turn: Math.max(turn, 1), attempt, nextAttempt: attempt + 1,
            maxAttempts: maxRetries + 1, delayMs, category,
            source: "claude_agent_sdk", runId
          });
          continue;
        }
        if (message.type === "system" && message.subtype === "compact_boundary") {
          await appendEvent(sessionId, "context_compacted", {
            reason: message.compact_metadata?.trigger === "auto" ? "sdk_auto" : "sdk_manual",
            beforeEstimatedTokens: message.compact_metadata?.pre_tokens ?? null,
            afterEstimatedTokens: message.compact_metadata?.post_tokens ?? null,
            source: "claude_agent_sdk",
            runId
          });
          continue;
        }
        if (message.type === "assistant") {
          turn += 1;
          await transition("streaming", `接收 Claude 第 ${turn} 轮响应`);
          for (const block of message.message?.content ?? []) {
            if (block.type === "text" && block.text) {
              await appendEvent(sessionId, "model_text_delta", { text: block.text, chars: block.text.length, turn, runId, source: "claude_agent_sdk" });
            }
            if (block.type === "tool_use") {
              const input = boundedInput(block.input ?? {});
              const batchId = `${runId}:turn:${turn}`;
              calls.set(block.id, { id: block.id, name: block.name, input, batchId });
              await appendEvent(sessionId, "tool_call_ready", { tool: block.name, toolCallId: block.id, input, turn, batchId, runId, source: "claude_agent_sdk" });
              await appendEvent(sessionId, "tool_requested", {
                tool: block.name, toolCallId: block.id, input, turn, batchId, runId,
                activity: resolveActivityTaxonomy(block.name),
                presentation: sdkToolPresentation(block.name, input)
              });
              await transition("executing_tools", `Claude 正在执行 ${block.name}`);
            }
          }
          continue;
        }
        if (message.type === "user") {
          const content = Array.isArray(message.message?.content) ? message.message.content : [];
          const completedMutationToolCallIds = [];
          for (const block of content) {
            if (block.type !== "tool_result") continue;
            const call = calls.get(block.tool_use_id) ?? { id: block.tool_use_id, name: "Tool", input: {} };
            const failed = block.is_error === true;
            if (!failed && mutationTools.has(call.name)) completedMutationToolCallIds.push(block.tool_use_id);
            const resultContent = bounded(block.content);
            const projected = JSON.stringify({ ok: !failed, content: resultContent, metadata: { source: "claude_agent_sdk" } });
            await appendEvent(sessionId, "tool_result_recorded", { tool: call.name, toolCallId: block.tool_use_id, content: projected, batchId: call.batchId, runId, source: "claude_agent_sdk" });
            await appendEvent(sessionId, "tool_completed", {
              tool: call.name, toolCallId: block.tool_use_id, ok: !failed,
              summary: failed ? "执行失败" : "执行完成", batchId: call.batchId, runId,
              presentation: sdkToolPresentation(call.name, call.input, "completed")
            });
            completedCallIds.add(block.tool_use_id);
            if (!failed && isSdkTaskTool(call.name)) {
              const taskFact = normalizeSdkTaskResult({ call, resultContent, runId });
              if (taskFact) await appendEvent(sessionId, "task_progress_changed", taskFact);
            }
          }
          if (completedMutationToolCallIds.length) {
            await observeWorkspaceMutation({
              sourceToolCallIds: completedMutationToolCallIds,
              owner: "claude_agent_sdk_tool_result"
            });
          }
          continue;
        }
        if (message.type === "result") {
          lastResult = message;
          await appendEvent(sessionId, "claude_sdk_result", {
            subtype: message.subtype,
            terminalReason: message.terminal_reason,
            turns: message.num_turns,
            durationMs: message.duration_ms,
            costUsd: message.total_cost_usd,
            permissionDenials: message.permission_denials?.length ?? 0,
            sdkSessionId,
            runId
          });
        }
      }

      if (signal?.aborted || abortController.signal.aborted) {
        const info = cancellation(signal);
        await closePendingCalls({ cancelled: true, code: info.code, message: info.message });
        await transition("cancelled", info.message, "cancelled");
        await appendEvent(sessionId, "agent_cancelled", { ...info, terminalReason: "cancelled", runId });
        return { state: "cancelled", cancellation: info, terminalReason: "cancelled" };
      }
      if (!lastResult || lastResult.subtype !== "success" || lastResult.is_error) {
        const error = new Error(lastResult?.errors?.join("; ") || `Claude Agent SDK ended with ${lastResult?.subtype ?? "no result"}`);
        error.code = lastResult?.terminal_reason ?? lastResult?.subtype ?? "CLAUDE_AGENT_SDK_FAILED";
        throw error;
      }
      if ([...calls.keys()].some((toolCallId) => !completedCallIds.has(toolCallId))) {
        await closePendingCalls({
          code: "SDK_TOOL_RESULT_MISSING",
          message: "Claude Agent SDK ended before returning every requested tool result"
        });
        const error = new Error("Claude Agent SDK tool protocol ended with unresolved calls");
        error.code = "SDK_TOOL_RESULT_MISSING";
        throw error;
      }
      const completion = await refreshDeliveryEvidence();
      await appendEvent(sessionId, "completion_gate_evaluated", {
        accepted: completion.accepted,
        exhausted: completion.exhausted ?? false,
        reasons: completion.reasons,
        progress: completion.snapshot,
        owner: "claude_agent_sdk",
        successfulMutations,
        terminalReason: lastResult.terminal_reason ?? "completed",
        runId
      });
      if (!completion.accepted) throw new RunIncompleteError("Claude Agent SDK 缺少 DeliveryContract 要求的完成证据", {
        reasons: completion.reasons,
        progress: completion.snapshot
      });
      await beforeFinal?.();
      const summary = lastResult.result ?? "任务已完成。";
      await transition("completed", `Claude Agent SDK 在 ${lastResult.num_turns} 轮后完成`, lastResult.terminal_reason ?? "completed");
      await appendEvent(sessionId, "agent_final", { summary, terminalReason: lastResult.terminal_reason ?? "completed", sdkSessionId, runId });
      return { state: "completed", text: summary, terminalReason: lastResult.terminal_reason ?? "completed", sdkSessionId };
    } catch (error) {
      if (signal?.aborted || abortController.signal.aborted) {
        const info = cancellation(signal);
        await closePendingCalls({ cancelled: true, code: info.code, message: info.message });
        await transition("cancelled", info.message, "cancelled");
        await appendEvent(sessionId, "agent_cancelled", { ...info, terminalReason: "cancelled", runId });
        return { state: "cancelled", cancellation: info, terminalReason: "cancelled" };
      }
      await closePendingCalls({
        code: error?.code ?? "CLAUDE_AGENT_SDK_ERROR",
        message: error instanceof Error ? error.message : String(error)
      });
      await transition("failed", error instanceof Error ? error.message : String(error), error.code ?? "claude_agent_sdk_error");
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
}
