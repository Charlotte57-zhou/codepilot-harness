import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicOpenAiGateway, anthropicToOpenAi, openAiToAnthropic } from "../src/anthropic-openai-gateway.mjs";

test("Anthropic messages and tool protocol map to OpenAI chat completions", () => {
  const request = anthropicToOpenAi({
    system: [{ type: "text", text: "You are a coding agent." }],
    max_tokens: 1024,
    stream: true,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    tools: [{ name: "Write", description: "write", input_schema: { type: "object" } }],
    messages: [
      { role: "user", content: [{ type: "text", text: "create a file" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "plan" }, { type: "tool_use", id: "t1", name: "Write", input: { path: "a.txt" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "created" }] }
    ]
  }, "kimi-k3");
  assert.equal(request.model, "kimi-k3");
  assert.equal(request.messages[0].role, "system");
  assert.equal(request.messages[2].reasoning_content, "plan");
  assert.equal(request.messages[2].tool_calls[0].function.name, "Write");
  assert.deepEqual(request.messages[3], { role: "tool", tool_call_id: "t1", content: "created" });
  assert.equal(request.reasoning_effort, "high");
  assert.deepEqual(request.thinking, { type: "enabled" });
});

test("OpenAI completion maps back to Anthropic content blocks and usage", () => {
  const result = openAiToAnthropic({
    id: "chat-1",
    model: "kimi-k3",
    choices: [{ finish_reason: "tool_calls", message: { reasoning_content: "plan", content: null, tool_calls: [{ id: "t1", function: { name: "Write", arguments: "{\"path\":\"a.txt\"}" } }] } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } }
  });
  assert.equal(result.stop_reason, "tool_use");
  assert.equal(result.content[0].type, "thinking");
  assert.deepEqual(result.content[1].input, { path: "a.txt" });
  assert.equal(result.usage.cache_read_input_tokens, 4);
});

test("gateway keeps the Moonshot key server-side and translates streaming tool deltas", async (t) => {
  let captured;
  const upstreamSse = [
    'data: {"id":"chat-1","choices":[{"delta":{"reasoning_content":"plan"},"finish_reason":null}]}',
    'data: {"id":"chat-1","choices":[{"delta":{"tool_calls":[{"index":0,"id":"t1","function":{"name":"Write","arguments":"{\\"path\\":"}}]},"finish_reason":null}]}',
    'data: {"id":"chat-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
    'data: [DONE]',
    ''
  ].join("\n");
  const gateway = new AnthropicOpenAiGateway({ fetchImpl: async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return new Response(upstreamSse, { status: 200, headers: { "content-type": "text/event-stream" } });
  } });
  await gateway.start();
  t.after(() => gateway.close());
  const route = gateway.register({ baseUrl: "https://api.moonshot.cn/v1", apiKey: "remote-secret", model: "kimi-k3" });
  const response = await fetch(`${route.baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": route.apiKey },
    body: JSON.stringify({ model: "kimi-k3", max_tokens: 100, stream: true, messages: [{ role: "user", content: "write" }] })
  });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(captured.url, "https://api.moonshot.cn/v1/chat/completions");
  assert.equal(captured.init.headers.authorization, "Bearer remote-secret");
  assert.doesNotMatch(text, /remote-secret/);
  assert.match(text, /thinking_delta/);
  assert.match(text, /input_json_delta/);
  assert.match(text, /"stop_reason":"tool_use"/);
  assert.match(text, /message_stop/);
});
