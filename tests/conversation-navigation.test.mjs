import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildConversationTurns,
  compactTurnPreview,
  persistConversationViewports,
  restoreConversationViewports,
  updateConversationViewport
} from "../public/conversation-navigation.js";

test("conversation turns pair each user message with its terminal model reply", () => {
  const turns = buildConversationTurns([
    { id: "u1", type: "user_message", data: { content: "第一问" } },
    { id: "trace", type: "agent_reasoning", data: { summary: "过程" } },
    { id: "a1", type: "agent_final", data: { summary: "第一答" } },
    { id: "u2", type: "user_message", data: { displayContent: "第二问" } },
    { id: "a2", type: "agent_error", data: { detail: "第二轮失败" } },
    { id: "u3", type: "user_message", data: { content: "第三问" } }
  ]);

  assert.deepEqual(turns, [
    { id: "u1", index: 0, user: "第一问", assistant: "第一答" },
    { id: "u2", index: 1, user: "第二问", assistant: "第二轮失败" },
    { id: "u3", index: 2, user: "第三问", assistant: "正在等待模型回复" }
  ]);
});

test("turn preview is whitespace-normalized and bounded", () => {
  assert.equal(compactTurnPreview("  一行\n\n 二行  "), "一行 二行");
  assert.equal(compactTurnPreview("123456", 5), "1234…");
});

test("conversation viewport receipts are validated, persisted and bounded by recency", () => {
  let receipts = {};
  receipts = updateConversationViewport(receipts, "old", { anchorId: "u1", anchorOffset: 42, scrollTop: 120, updatedAt: 1 }, { maxReceipts: 2 });
  receipts = updateConversationViewport(receipts, "new", { anchorId: "u2", anchorOffset: 8, scrollTop: 320, updatedAt: 3 }, { maxReceipts: 2 });
  receipts = updateConversationViewport(receipts, "middle", { anchorId: "u3", anchorOffset: 9, scrollTop: 220, updatedAt: 2 }, { maxReceipts: 2 });

  assert.deepEqual(Object.keys(receipts), ["new", "middle"]);
  assert.deepEqual(restoreConversationViewports(persistConversationViewports(receipts)), receipts);
  assert.deepEqual(restoreConversationViewports("not-json"), {});
});

test("desktop transcript wires four-turn navigation to durable user anchors and viewport receipts", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="turn-navigation"[^>]*aria-label="对话轮次导航"[^>]*hidden/);
  assert.match(app, /if \(turns\.length < 4\)/);
  assert.match(app, /data-turn-id=/);
  assert.match(app, /captureConversationViewport\(\);[\s\S]*const loadEpoch = \+\+sessionLoadEpoch/);
  assert.match(app, /render\(\{ scrollToLatest: false \}\);[\s\S]*restoreConversationViewport\(session\.id\)/);
  assert.match(css, /--timeline-inline-start:[^;]+/);
  assert.match(css, /\.turn-navigation\s*\{[^}]*left:\s*max\(8px, calc\(var\(--timeline-inline-start\) - 50px\)\)/);
  assert.match(css, /\.turn-nav-item\s*\{[^}]*width:\s*24px;[^}]*height:\s*9px/);
  assert.match(css, /\.turn-nav-line\s*\{[^}]*width:\s*10px;[^}]*height:\s*1px/);
  assert.match(css, /\.turn-nav-item\.is-latest\s*\{[^}]*color:\s*var\(--ink\)/);
  assert.match(css, /\.turn-nav-item:hover \.turn-nav-preview/);
});
