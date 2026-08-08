export function runtimeProcessExited(processHandle) {
  return processHandle?.exitCode !== undefined && processHandle.exitCode !== null;
}

export function publicRuntimeStartupDetail(error) {
  const code = typeof error?.code === "string" ? error.code : "START_FAILED";
  const message = String(error?.message ?? error ?? "Runtime startup failed");
  if (/[A-Za-z]:[\\/]|Users[\\/]|AppData[\\/]|Temp[\\/]/i.test(message)) {
    return `The packaged Runtime process did not start (${code}).`;
  }
  return message.slice(0, 500);
}
