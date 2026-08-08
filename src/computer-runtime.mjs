import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

function computerError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function encodedCommand(script) {
  const prologue = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);";
  return Buffer.from(`${prologue}${script}`, "utf16le").toString("base64");
}

function runPowerShell(script, input = {}, { signal, timeoutMs = 15_000 } = {}) {
  if (process.platform !== "win32") return Promise.reject(computerError("COMPUTER_PLATFORM_UNSUPPORTED", "Computer runtime requires Windows"));
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand(script)
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => {
      child.kill();
      finish(reject, computerError("AUTOMATION_CANCELLED", "Computer operation was cancelled"));
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(reject, computerError("COMPUTER_TIMEOUT", "Computer operation timed out"));
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 2_000_000) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 20_000) stderr += chunk;
    });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) return finish(reject, computerError("COMPUTER_BRIDGE_FAILED", "Windows automation bridge failed", {
        message: stderr.trim().slice(0, 2_000)
      }));
      try {
        finish(resolve, stdout.trim() ? JSON.parse(stdout.trim()) : {});
      } catch {
        finish(reject, computerError("COMPUTER_BRIDGE_PROTOCOL", "Windows automation bridge returned invalid JSON"));
      }
    });
    child.stdin.end(JSON.stringify(input), "utf8");
  });
}

const nativeWindowTypes = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class CodePilotWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr extraData);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, string lParam);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
try { [void][CodePilotWin32]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) } catch {}
`;

const readInput = `$inputData = ([Console]::In.ReadToEnd() | ConvertFrom-Json);`;

const listWindowsScript = `
${nativeWindowTypes}
$items = [Collections.Generic.List[object]]::new()
[CodePilotWin32]::EnumWindows({
  param($h,$l)
  if (-not [CodePilotWin32]::IsWindowVisible($h)) { return $true }
  $length = [CodePilotWin32]::GetWindowTextLength($h)
  if ($length -le 0) { return $true }
  $text = [Text.StringBuilder]::new($length + 1)
  [void][CodePilotWin32]::GetWindowText($h,$text,$text.Capacity)
  $processIdValue = [uint32]0
  [void][CodePilotWin32]::GetWindowThreadProcessId($h,[ref]$processIdValue)
  $rect = [CodePilotWin32+RECT]::new()
  [void][CodePilotWin32]::GetWindowRect($h,[ref]$rect)
  $items.Add([pscustomobject]@{
    hwnd=$h.ToInt64().ToString(); title=$text.ToString(); processId=[int]$processIdValue;
    bounds=[pscustomobject]@{x=$rect.Left;y=$rect.Top;width=$rect.Right-$rect.Left;height=$rect.Bottom-$rect.Top}
  })
  return $true
},[IntPtr]::Zero) | Out-Null
$items | ConvertTo-Json -Compress -Depth 5
`;

const uiaHelpers = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
function Get-ControlTypeName($element) {
  try { return $element.Current.ControlType.ProgrammaticName.Replace('ControlType.','') } catch { return '' }
}
function Find-Element($root,$locator) {
  $queue = [Collections.Generic.Queue[object]]::new()
  $queue.Enqueue($root)
  $seen = 0
  while ($queue.Count -gt 0 -and $seen -lt 2000) {
    $element = $queue.Dequeue(); $seen++
    try {
      $name = $element.Current.Name
      $automationId = $element.Current.AutomationId
      $controlType = Get-ControlTypeName $element
      $match = $true
      if ($locator.automationId -and $automationId -ne [string]$locator.automationId) { $match = $false }
      if ($locator.name -and $name -ne [string]$locator.name) { $match = $false }
      if ($locator.nameContains -and $name -notlike ('*' + [string]$locator.nameContains + '*')) { $match = $false }
      if ($locator.controlType -and $controlType -ne [string]$locator.controlType) { $match = $false }
      if ($match -and ($locator.automationId -or $locator.name -or $locator.nameContains -or $locator.controlType)) { return $element }
      $walker = [Windows.Automation.TreeWalker]::ControlViewWalker
      $child = $walker.GetFirstChild($element)
      while ($null -ne $child) { $queue.Enqueue($child); $child = $walker.GetNextSibling($child) }
    } catch {}
  }
  return $null
}
`;

const inspectScript = `
${readInput}
${uiaHelpers}
$hwnd = [IntPtr]::new([int64]$inputData.hwnd)
$root = [Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($null -eq $root) { throw 'Window automation element was not found' }
$maxNodes = [Math]::Min([Math]::Max([int]$inputData.maxNodes,1),500)
$maxDepth = [Math]::Min([Math]::Max([int]$inputData.maxDepth,0),16)
$result = [Collections.Generic.List[object]]::new()
$queue = [Collections.Generic.Queue[object]]::new()
$queue.Enqueue([pscustomobject]@{element=$root;depth=0})
while ($queue.Count -gt 0 -and $result.Count -lt $maxNodes) {
  $entry=$queue.Dequeue(); $element=$entry.element
  try {
    $rect=$element.Current.BoundingRectangle
    $result.Add([pscustomobject]@{
      depth=$entry.depth; name=$element.Current.Name; automationId=$element.Current.AutomationId;
      controlType=(Get-ControlTypeName $element); className=$element.Current.ClassName;
      enabled=$element.Current.IsEnabled; offscreen=$element.Current.IsOffscreen;
      bounds=[pscustomobject]@{x=[int]$rect.X;y=[int]$rect.Y;width=[int]$rect.Width;height=[int]$rect.Height}
    })
    if ($entry.depth -lt $maxDepth) {
      $walker=[Windows.Automation.TreeWalker]::ControlViewWalker
      $child=$walker.GetFirstChild($element)
      while ($null -ne $child) { $queue.Enqueue([pscustomobject]@{element=$child;depth=$entry.depth+1}); $child=$walker.GetNextSibling($child) }
    }
  } catch {}
}
[pscustomobject]@{nodes=$result;truncated=($queue.Count -gt 0);count=$result.Count} | ConvertTo-Json -Compress -Depth 7
`;

const screenshotScript = `
${readInput}
${nativeWindowTypes}
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
if ($inputData.hwnd) {
  $rect=[CodePilotWin32+RECT]::new()
  if (-not [CodePilotWin32]::GetWindowRect([IntPtr]::new([int64]$inputData.hwnd),[ref]$rect)) { throw 'Window bounds unavailable' }
  $x=$rect.Left; $y=$rect.Top; $width=$rect.Right-$rect.Left; $height=$rect.Bottom-$rect.Top
} else {
  $bounds=[Windows.Forms.SystemInformation]::VirtualScreen
  $x=$bounds.X; $y=$bounds.Y; $width=$bounds.Width; $height=$bounds.Height
}
if ($width -lt 1 -or $height -lt 1) { throw 'Screenshot bounds are empty' }
$bitmap=[Drawing.Bitmap]::new($width,$height,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics=[Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($x,$y,0,0,[Drawing.Size]::new($width,$height),[Drawing.CopyPixelOperation]::SourceCopy)
  $bitmap.Save([string]$inputData.path,[Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose() }
[pscustomobject]@{width=$width;height=$height;x=$x;y=$y} | ConvertTo-Json -Compress
`;

const clickScript = `
${readInput}
${nativeWindowTypes}
${uiaHelpers}
$hwnd=[IntPtr]::new([int64]$inputData.hwnd)
if (-not [CodePilotWin32]::IsWindow($hwnd)) { throw 'Window handle is stale' }
[void][CodePilotWin32]::SetForegroundWindow($hwnd)
$method='coordinate'
if ($inputData.locator) {
  $root=[Windows.Automation.AutomationElement]::FromHandle($hwnd)
  $element=Find-Element $root $inputData.locator
  if ($null -eq $element) { throw 'UI Automation element was not found' }
  $pattern=$null
  if ($element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) {
    ([Windows.Automation.InvokePattern]$pattern).Invoke(); $method='uia-invoke'
  } elseif ($element.Current.NativeWindowHandle -ne 0 -and $element.Current.ClassName -like '*BUTTON*') {
    [void][CodePilotWin32]::SendMessage([IntPtr]::new([int64]$element.Current.NativeWindowHandle),0x00F5,[IntPtr]::Zero,$null)
    $method='win32-button'
  } else {
    $rect=$element.Current.BoundingRectangle
    $inputData | Add-Member -NotePropertyName x -NotePropertyValue ([int]($rect.X+$rect.Width/2)) -Force
    $inputData | Add-Member -NotePropertyName y -NotePropertyValue ([int]($rect.Y+$rect.Height/2)) -Force
  }
}
if ($method -eq 'coordinate') {
  [void][CodePilotWin32]::SetCursorPos([int]$inputData.x,[int]$inputData.y)
  [CodePilotWin32]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)
  [CodePilotWin32]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
}
[pscustomobject]@{method=$method;x=$inputData.x;y=$inputData.y} | ConvertTo-Json -Compress
`;

const setValueScript = `
${readInput}
${nativeWindowTypes}
${uiaHelpers}
$hwnd=[IntPtr]::new([int64]$inputData.hwnd)
if (-not [CodePilotWin32]::IsWindow($hwnd)) { throw 'Window handle is stale' }
[void][CodePilotWin32]::SetForegroundWindow($hwnd)
$root=[Windows.Automation.AutomationElement]::FromHandle($hwnd)
$element=Find-Element $root $inputData.locator
if ($null -eq $element) { throw 'UI Automation element was not found' }
$pattern=$null
$method='uia-value'
if ($element.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) {
  ([Windows.Automation.ValuePattern]$pattern).SetValue([string]$inputData.value)
} elseif ($element.Current.NativeWindowHandle -ne 0) {
  [void][CodePilotWin32]::SendMessage([IntPtr]::new([int64]$element.Current.NativeWindowHandle),0x000C,[IntPtr]::Zero,[string]$inputData.value)
  $method='win32-settext'
} else {
  throw 'Element does not support a structured value operation'
}
[pscustomobject]@{charsEntered=([string]$inputData.value).Length;controlType=(Get-ControlTypeName $element);method=$method} | ConvertTo-Json -Compress
`;

const keypressScript = `
${readInput}
${nativeWindowTypes}
Add-Type -AssemblyName System.Windows.Forms
$hwnd=[IntPtr]::new([int64]$inputData.hwnd)
if (-not [CodePilotWin32]::IsWindow($hwnd)) { throw 'Window handle is stale' }
[void][CodePilotWin32]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 80
[Windows.Forms.SendKeys]::SendWait([string]$inputData.keys)
[pscustomobject]@{keys=[string]$inputData.keys} | ConvertTo-Json -Compress
`;

export class ComputerRuntime {
  constructor({ artifactStore, createId = randomUUID, bridge = runPowerShell, onEvent } = {}) {
    if (!artifactStore) throw new TypeError("ComputerRuntime requires artifactStore");
    this.artifactStore = artifactStore;
    this.createId = createId;
    this.bridge = bridge;
    this.onEvent = onEvent;
    this.sessions = new Map();
  }

  async listWindows(options = {}) {
    const result = await this.bridge(listWindowsScript, {}, options);
    return Array.isArray(result) ? result : result ? [result] : [];
  }

  async start({ hwnd } = {}, options = {}) {
    const windows = await this.listWindows(options);
    const window = windows.find((candidate) => candidate.hwnd === String(hwnd));
    if (!window) throw computerError("COMPUTER_WINDOW_NOT_FOUND", "Window was not found or is no longer visible");
    const session = {
      id: this.createId(),
      hwnd: window.hwnd,
      title: window.title,
      processId: window.processId,
      createdAt: new Date().toISOString(),
      queue: Promise.resolve()
    };
    this.sessions.set(session.id, session);
    const result = this.publicSession(session.id);
    await this.#emit("automation_computer_started", result);
    return result;
  }

  publicSession(sessionId) {
    const session = this.#requireSession(sessionId);
    return {
      sessionId: session.id,
      hwnd: session.hwnd,
      title: session.title,
      processId: session.processId,
      createdAt: session.createdAt
    };
  }

  listSessions() {
    return [...this.sessions.keys()].map((id) => this.publicSession(id));
  }

  inspect({ sessionId, maxNodes = 160, maxDepth = 12 } = {}, options = {}) {
    return this.#serialized(sessionId, async (session) => {
      const result = await this.bridge(inspectScript, { hwnd: session.hwnd, maxNodes, maxDepth }, options);
      return { sessionId, title: session.title, ...result, externalContent: true };
    });
  }

  screenshot({ sessionId } = {}, options = {}) {
    return this.#serialized(sessionId, async (session) => {
      const reservation = await this.artifactStore.reserveImagePath();
      const dimensions = await this.bridge(screenshotScript, {
        hwnd: session.hwnd,
        path: reservation.absolutePath
      }, options);
      const artifact = await this.artifactStore.commitReserved(reservation.artifactId, {
        kind: "computer_screenshot",
        sessionId,
        width: dimensions.width,
        height: dimensions.height
      });
      await this.#emit("automation_artifact_created", artifact);
      return { sessionId, title: session.title, artifact, bounds: dimensions };
    });
  }

  click({ sessionId, locator, x, y } = {}, options = {}) {
    return this.#serialized(sessionId, async (session) => {
      if (!locator && (!Number.isFinite(x) || !Number.isFinite(y))) {
        throw computerError("COMPUTER_TARGET_REQUIRED", "Computer click requires a UIA locator or screen coordinates");
      }
      const result = await this.bridge(clickScript, { hwnd: session.hwnd, locator, x, y }, options);
      const publicResult = { sessionId, title: session.title, method: result.method, target: locator ? { ...locator } : { x, y } };
      await this.#emit("automation_computer_clicked", publicResult);
      return publicResult;
    });
  }

  setValue({ sessionId, locator, value } = {}, options = {}) {
    return this.#serialized(sessionId, async (session) => {
      const result = await this.bridge(setValueScript, { hwnd: session.hwnd, locator, value }, options);
      const publicResult = { sessionId, title: session.title, locator: { ...locator }, charsEntered: result.charsEntered, method: result.method };
      await this.#emit("automation_computer_typed", publicResult);
      return publicResult;
    });
  }

  keypress({ sessionId, keys } = {}, options = {}) {
    return this.#serialized(sessionId, async (session) => {
      const result = await this.bridge(keypressScript, { hwnd: session.hwnd, keys }, options);
      await this.#emit("automation_computer_keypress", { sessionId, title: session.title, keys: result.keys });
      return { sessionId, title: session.title, keys: result.keys };
    });
  }

  async closeSession(sessionId) {
    const session = this.#requireSession(sessionId);
    this.sessions.delete(sessionId);
    await this.#emit("automation_computer_closed", { sessionId, title: session.title });
  }

  async close() {
    await Promise.all([...this.sessions.keys()].map((id) => this.closeSession(id).catch(() => {})));
  }

  #requireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw computerError("COMPUTER_SESSION_NOT_FOUND", "Computer session was not found");
    return session;
  }

  #serialized(sessionId, operation) {
    const session = this.#requireSession(sessionId);
    const run = session.queue.catch(() => {}).then(() => operation(session));
    session.queue = run.catch(() => {});
    return run;
  }

  async #emit(type, data) {
    await this.onEvent?.(type, structuredClone(data));
  }
}

export { runPowerShell };
