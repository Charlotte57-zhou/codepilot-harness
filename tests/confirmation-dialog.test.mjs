import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createConfirmationController } from "../public/confirmation-dialog.js";

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.textContent = "";
    this.hidden = false;
    this.dataset = {};
    this.isConnected = true;
    this.focused = false;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener({ target: this, preventDefault() {}, ...event });
  }

  focus() {
    this.focused = true;
  }
}

function createHarness() {
  const dialog = new FakeTarget();
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  const returnFocus = new FakeTarget();
  const controls = {
    dialog,
    title: new FakeTarget(),
    message: new FakeTarget(),
    detail: new FakeTarget(),
    detailMeta: new FakeTarget(),
    confirmButton: new FakeTarget(),
    cancelButton: new FakeTarget(),
    closeButton: new FakeTarget()
  };
  const controller = createConfirmationController({
    ...controls,
    getActiveElement: () => returnFocus,
    schedule: (callback) => callback()
  });
  return { controller, controls, returnFocus };
}

test("confirmation controller owns one modal request and resolves destructive confirmation", async () => {
  const { controller, controls, returnFocus } = createHarness();
  const result = controller.confirm({
    title: "删除“会话”？",
    message: "移除本地记录。",
    detail: "删除后不可撤销。",
    detailMeta: "本地会话记录",
    confirmLabel: "删除对话"
  });

  assert.equal(controller.isOpen(), true);
  assert.equal(controls.dialog.open, true);
  assert.equal(controls.title.textContent, "删除“会话”？");
  assert.equal(controls.detailMeta.textContent, "本地会话记录");
  assert.equal(controls.confirmButton.textContent, "删除对话");
  assert.equal(controls.cancelButton.focused, true);
  controls.confirmButton.emit("click");

  assert.equal(await result, true);
  assert.equal(controller.isOpen(), false);
  assert.equal(controls.dialog.open, false);
  assert.equal(returnFocus.focused, true);
});

test("escape and backdrop dismiss without confirming", async () => {
  for (const dismiss of ["cancel", "backdrop"]) {
    const { controller, controls } = createHarness();
    const result = controller.confirm({ title: "确认", message: "说明" });
    if (dismiss === "cancel") controls.dialog.emit("cancel");
    else controls.dialog.emit("click", { target: controls.dialog });
    assert.equal(await result, false);
  }
});

test("callers can restore focus to the visible menu trigger instead of a hidden menu action", async () => {
  const { controller, controls, returnFocus } = createHarness();
  const menuTrigger = new FakeTarget();
  const result = controller.confirm({ title: "确认", message: "说明", returnFocus: menuTrigger });
  controls.cancelButton.emit("click");
  assert.equal(await result, false);
  assert.equal(menuTrigger.focused, true);
  assert.equal(returnFocus.focused, false);
});

test("session deletion no longer delegates destructive state to a browser-native confirm", async () => {
  const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const indexHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /window\.confirm/);
  assert.match(appSource, /confirmLabel:\s*"删除会话"/);
  assert.match(indexHtml, /<dialog id="confirmation-dialog"/);
  assert.match(indexHtml, /id="confirmation-confirm"/);
  assert.match(indexHtml, /id="confirmation-detail-meta"/);
});
