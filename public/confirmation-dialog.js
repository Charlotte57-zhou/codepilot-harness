export function createConfirmationController({
  dialog,
  title,
  message,
  detail,
  detailMeta,
  confirmButton,
  cancelButton,
  closeButton,
  getActiveElement = () => document.activeElement,
  schedule = queueMicrotask
}) {
  let pending = null;

  function restoreFocus(element) {
    if (element?.isConnected !== false && typeof element?.focus === "function") {
      element.focus({ preventScroll: true });
    }
  }

  function settle(confirmed) {
    if (!pending) return;
    const current = pending;
    pending = null;
    if (dialog.open) dialog.close();
    restoreFocus(current.returnFocus);
    current.resolve(confirmed);
  }

  function confirm(options) {
    if (pending) settle(false);
    title.textContent = options.title;
    message.textContent = options.message;
    detail.textContent = options.detail ?? "";
    detail.hidden = !options.detail;
    if (detailMeta) {
      detailMeta.textContent = options.detailMeta ?? "";
      detailMeta.hidden = !options.detailMeta;
    }
    confirmButton.textContent = options.confirmLabel ?? "确认";
    dialog.dataset.tone = options.tone ?? "danger";
    const returnFocus = options.returnFocus ?? getActiveElement();

    return new Promise((resolve) => {
      pending = { resolve, returnFocus };
      dialog.showModal();
      schedule(() => cancelButton.focus({ preventScroll: true }));
    });
  }

  confirmButton.addEventListener("click", () => settle(true));
  cancelButton.addEventListener("click", () => settle(false));
  closeButton.addEventListener("click", () => settle(false));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    settle(false);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) settle(false);
  });

  return Object.freeze({
    confirm,
    isOpen: () => pending !== null
  });
}
