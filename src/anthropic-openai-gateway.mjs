import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

function textOf(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.filter((item) => item?.type === "text").map((item) => item.text ?? "").join("\n");
}

function openAiContentBlock(block) {
  if (block?.type === "text") return { type: "text", text: block.text ?? "" };
  if (block?.type === "image" && block.source?.type === "base64") {
    return { type: "image_url", image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } };
  }
  return null;
}

export function anthropicToOpenAi(body = {}, model) {
  const messages = [];
  const system = textOf(body.system);
  if (system) messages.push({ role: "system", content: system });

  for (const message of body.messages ?? []) {
    if (!Array.isArray(message.content)) {
      messages.push({ role: message.role, content: String(message.content ?? "") });
      continue;
    }
    if (message.role === "assistant") {
      const text = textOf(message.content);
      const reasoning = message.content.filter((item) => item?.type === "thinking").map((item) => item.thinking ?? "").join("\n");
      const toolCalls = message.content.filter((item) => item?.type === "tool_use").map((item) => ({
        id: item.id,
        type: "function",
        function: { name: item.name, arguments: JSON.stringify(item.input ?? {}) }
      }));
      messages.push({
        role: "assistant",
        content: text || null,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {})
      });
      continue;
    }

    const userBlocks = message.content.map(openAiContentBlock).filter(Boolean);
    if (userBlocks.length) {
      const onlyText = userBlocks.every((block) => block.type === "text");
      messages.push({ role: "user", content: onlyText ? userBlocks.map((block) => block.text).join("\n") : userBlocks });
    }
    for (const result of message.content.filter((item) => item?.type === "tool_result")) {
      messages.push({ role: "tool", tool_call_id: result.tool_use_id, content: textOf(result.content) || String(result.content ?? "") });
    }
  }

  const effort = body.output_config?.effort ?? body.effort;
  return {
    model: model || body.model,
    messages,
    max_tokens: body.max_tokens,
    stream: body.stream === true,
    tools: body.tools?.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.input_schema }
    })),
    tool_choice: body.tool_choice?.type === "any" ? "required"
      : body.tool_choice?.type === "tool" ? { type: "function", function: { name: body.tool_choice.name } }
        : body.tool_choice?.type === "none" ? "none" : "auto",
    ...(body.thinking?.type === "disabled" ? { thinking: { type: "disabled" } }
      : body.thinking ? { thinking: { type: "enabled" } } : {}),
    ...(effort ? { reasoning_effort: effort } : {})
  };
}

function anthropicUsage(usage = {}) {
  return {
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    cache_read_input_tokens: usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens ?? 0,
    cache_creation_input_tokens: 0
  };
}

function stopReason(reason) {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  return "end_turn";
}

export function openAiToAnthropic(payload = {}, model) {
  const choice = payload.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const content = [];
  if (message.reasoning_content) content.push({ type: "thinking", thinking: message.reasoning_content, signature: "moonshot-openai-adapter" });
  if (message.content) content.push({ type: "text", text: message.content });
  for (const call of message.tool_calls ?? []) {
    let input = {};
    try { input = JSON.parse(call.function?.arguments || "{}"); } catch { input = {}; }
    content.push({ type: "tool_use", id: call.id, name: call.function?.name, input });
  }
  return {
    id: payload.id ?? `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model: model || payload.model,
    content,
    stop_reason: stopReason(choice.finish_reason),
    stop_sequence: null,
    usage: anthropicUsage(payload.usage)
  };
}

function sse(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function streamAnthropic(upstream, response, model, notify = () => {}) {
  response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
  const messageId = `msg_${randomUUID()}`;
  sse(response, "message_start", { type: "message_start", message: { id: messageId, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });

  let buffer = "";
  let blockIndex = -1;
  let active = null;
  let activeToolIndex = null;
  let finish = "stop";
  let usage = {};
  let sawFirstChunk = false;

  const closeBlock = () => {
    if (!active) return;
    if (active === "thinking") sse(response, "content_block_delta", { type: "content_block_delta", index: blockIndex, delta: { type: "signature_delta", signature: "moonshot-openai-adapter" } });
    sse(response, "content_block_stop", { type: "content_block_stop", index: blockIndex });
    active = null;
    activeToolIndex = null;
  };
  const openBlock = (kind, tool) => {
    if (active === kind && (kind !== "tool" || activeToolIndex === tool.index)) return;
    closeBlock();
    blockIndex += 1;
    active = kind;
    if (kind === "thinking") sse(response, "content_block_start", { type: "content_block_start", index: blockIndex, content_block: { type: "thinking", thinking: "", signature: "" } });
    if (kind === "text") sse(response, "content_block_start", { type: "content_block_start", index: blockIndex, content_block: { type: "text", text: "" } });
    if (kind === "tool") {
      activeToolIndex = tool.index;
      sse(response, "content_block_start", { type: "content_block_start", index: blockIndex, content_block: { type: "tool_use", id: tool.id || `tool_${randomUUID()}`, name: tool.function?.name ?? "unknown", input: {} } });
    }
  };
  const consume = (payload) => {
    if (payload === "[DONE]") return;
    let chunk;
    try { chunk = JSON.parse(payload); } catch { return; }
    const choice = chunk.choices?.[0];
    if (chunk.usage) usage = chunk.usage;
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (delta.reasoning_content) {
      openBlock("thinking");
      sse(response, "content_block_delta", { type: "content_block_delta", index: blockIndex, delta: { type: "thinking_delta", thinking: delta.reasoning_content } });
    }
    if (delta.content) {
      openBlock("text");
      sse(response, "content_block_delta", { type: "content_block_delta", index: blockIndex, delta: { type: "text_delta", text: delta.content } });
    }
    for (const tool of delta.tool_calls ?? []) {
      openBlock("tool", tool);
      if (tool.function?.arguments) sse(response, "content_block_delta", { type: "content_block_delta", index: blockIndex, delta: { type: "input_json_delta", partial_json: tool.function.arguments } });
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  };

  for await (const chunk of upstream.body) {
    if (!sawFirstChunk) {
      sawFirstChunk = true;
      notify({ phase: "upstream_first_chunk", at: new Date().toISOString() });
    }
    buffer += Buffer.from(chunk).toString("utf8");
    let boundary;
    while ((boundary = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, boundary).trimEnd();
      buffer = buffer.slice(boundary + 1);
      if (line.startsWith("data:")) consume(line.slice(5).trim());
    }
  }
  closeBlock();
  sse(response, "message_delta", { type: "message_delta", delta: { stop_reason: stopReason(finish), stop_sequence: null }, usage: { output_tokens: usage.completion_tokens ?? 0 } });
  sse(response, "message_stop", { type: "message_stop" });
  response.end();
}

function errorPayload(status, payload) {
  return {
    type: "error",
    error: {
      type: status === 401 ? "authentication_error" : status === 429 ? "rate_limit_error" : status >= 500 ? "api_error" : "invalid_request_error",
      message: payload?.error?.message ?? `Upstream returned HTTP ${status}`
    }
  };
}

async function readJson(request, maxBytes = 4_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new RangeError("request is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export class AnthropicOpenAiGateway {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetchImpl = fetchImpl;
    this.routes = new Map();
    this.server = null;
    this.origin = null;
  }

  async start() {
    if (this.server) return this.origin;
    this.server = createServer((request, response) => this.handle(request, response));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server.address();
    this.origin = `http://127.0.0.1:${address.port}`;
    return this.origin;
  }

  register({ baseUrl, apiKey, model, onEvent }) {
    if (!this.server) throw new Error("gateway must be started before registering a route");
    const token = randomUUID();
    this.routes.set(token, { baseUrl: String(baseUrl).replace(/\/$/, ""), apiKey, model, onEvent });
    return {
      baseUrl: `${this.origin}/runs/${token}`,
      apiKey: token,
      release: () => this.routes.delete(token)
    };
  }

  async handle(request, response) {
    try {
      const url = new URL(request.url, this.origin);
      const match = url.pathname.match(/^\/runs\/([^/]+)\/v1\/messages$/);
      if (request.method !== "POST" || !match) {
        response.writeHead(404).end();
        return;
      }
      const route = this.routes.get(match[1]);
      if (!route || request.headers["x-api-key"] !== match[1]) {
        response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify(errorPayload(401, { error: { message: "Adapter route expired" } })));
        return;
      }
      const body = await readJson(request);
      const openAiBody = anthropicToOpenAi(body, route.model);
      const notify = (event) => {
        try { void Promise.resolve(route.onEvent?.(event)); } catch {}
      };
      notify({ phase: "request_received", at: new Date().toISOString(), messageCount: openAiBody.messages.length, toolCount: openAiBody.tools?.length ?? 0 });
      const upstream = await this.fetchImpl(`${route.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${route.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(openAiBody)
      });
      notify({ phase: "upstream_headers", at: new Date().toISOString(), status: upstream.status });
      if (!upstream.ok) {
        let payload = {};
        try { payload = await upstream.json(); } catch {}
        response.writeHead(upstream.status, { "content-type": "application/json" }).end(JSON.stringify(errorPayload(upstream.status, payload)));
        return;
      }
      if (openAiBody.stream) {
        await streamAnthropic(upstream, response, route.model, notify);
        notify({ phase: "response_completed", at: new Date().toISOString() });
        return;
      }
      const payload = await upstream.json();
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(openAiToAnthropic(payload, route.model)));
    } catch (error) {
      response.writeHead(error instanceof RangeError ? 413 : 500, { "content-type": "application/json" }).end(JSON.stringify(errorPayload(500, { error: { message: error.message } })));
    }
  }

  async close() {
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
    this.origin = null;
    this.routes.clear();
  }
}
