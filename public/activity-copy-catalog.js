export const ACTIVITY_COPY_CATALOG_VERSION = 1;

const entry = (running, completed, failed, cancelled, extra = {}) =>
  Object.freeze({ queued: running, waiting_permission: `等待批准：${running.replace(/^正在/, "")}`, running, completed, failed, cancelled, declined: "操作未获批准", not_run: "操作未执行", partially_failed: completed, ...extra });

const zhCN = {
  "command.run": entry("正在运行命令", "已运行命令", "命令运行失败", "已停止运行命令"),
  "exploration.read": entry("正在读取文件", "已读取文件", "读取文件失败", "已停止读取文件"),
  "exploration.list": entry("正在查看文件列表", "已查看文件列表", "查看文件列表失败", "已停止查看文件列表"),
  "exploration.search": entry("正在搜索代码", "已搜索代码", "搜索代码失败", "已停止搜索代码"),
  "file.create": entry("正在创建文件", "已创建文件", "创建文件失败", "已停止创建文件"),
  "file.edit": entry("正在编辑文件", "已编辑文件", "编辑文件失败", "已停止编辑文件"),
  "file.delete": entry("正在删除文件", "已删除文件", "删除文件失败", "已停止删除文件"),
  "file.create_directory": entry("正在创建目录", "已创建目录", "创建目录失败", "已停止创建目录"),
  "web.search": entry("正在搜索网页", "已搜索网页", "网页搜索失败", "已停止搜索网页"),
  "web.fetch": entry("正在读取网页", "已读取网页", "读取网页失败", "已停止读取网页"),
  "browser.preview": entry("正在准备预览", "已准备预览", "预览准备失败", "已停止准备预览"),
  "browser.start": entry("正在启动浏览器", "已启动浏览器", "浏览器启动失败", "已停止启动浏览器"),
  "browser.navigate": entry("正在打开页面", "已打开页面", "打开页面失败", "已停止打开页面"),
  "browser.inspect": entry("正在检查页面", "已检查页面", "页面检查失败", "已停止检查页面"),
  "browser.screenshot": entry("正在截取页面", "已截取页面", "页面截图失败", "已停止截取页面"),
  "browser.click": entry("正在操作页面", "已操作页面", "页面操作失败", "已停止操作页面"),
  "browser.type": entry("正在填写页面", "已填写页面", "填写页面失败", "已停止填写页面"),
  "browser.wait": entry("正在等待页面", "已等待页面", "等待页面失败", "已停止等待页面"),
  "browser.new_page": entry("正在新建页面", "已新建页面", "新建页面失败", "已停止新建页面"),
  "computer.list_windows": entry("正在查找窗口", "已查找窗口", "查找窗口失败", "已停止查找窗口"),
  "computer.start": entry("正在连接桌面", "已连接桌面", "连接桌面失败", "已停止连接桌面"),
  "computer.inspect": entry("正在检查桌面", "已检查桌面", "桌面检查失败", "已停止检查桌面"),
  "computer.screenshot": entry("正在截取桌面", "已截取桌面", "桌面截图失败", "已停止截取桌面"),
  "computer.click": entry("正在操作桌面", "已操作桌面", "桌面操作失败", "已停止操作桌面"),
  "computer.type": entry("正在输入桌面内容", "已输入桌面内容", "桌面输入失败", "已停止桌面输入"),
  "computer.keypress": entry("正在发送按键", "已发送按键", "发送按键失败", "已停止发送按键"),
  "computer.close": entry("正在关闭桌面交互", "已关闭桌面交互", "关闭桌面交互失败", "已停止关闭桌面交互"),
  "mcp.call": entry("正在调用 MCP 工具", "已调用 MCP 工具", "MCP 工具调用失败", "已停止调用 MCP 工具"),
  "subagent.spawn": entry("正在委派子任务", "已委派子任务", "子任务委派失败", "已停止委派子任务"),
  "task.update": entry("正在更新任务", "已更新任务", "更新任务失败", "已停止更新任务"),
  "task.list": entry("正在读取任务", "已读取任务", "读取任务失败", "已停止读取任务"),
  "image.view": entry("正在查看图片", "已查看图片", "查看图片失败", "已停止查看图片"),
  "image.generate": entry("正在生成图片", "已生成图片", "生成图片失败", "已停止生成图片"),
  "skill.load": entry("正在加载 Skill", "已加载 Skill", "Skill 加载失败", "已停止加载 Skill"),
  "hook.run": entry("正在运行 Hook", "已运行 Hook", "Hook 运行失败", "已停止运行 Hook"),
  "plan.update": entry("正在更新计划", "已更新计划", "更新计划失败", "已停止更新计划"),
  "generic.dynamic_tool": entry("正在执行工具", "已执行工具", "工具执行失败", "已停止执行工具")
};

const en = Object.fromEntries(Object.keys(zhCN).map((key) => [key, entry("Running tool", "Ran tool", "Tool failed", "Stopped tool")]));
Object.assign(en, {
  "command.run": entry("Running command", "Ran command", "Command failed", "Stopped command"),
  "exploration.read": entry("Reading file", "Read file", "File read failed", "Stopped reading file"),
  "exploration.list": entry("Listing files", "Listed files", "File listing failed", "Stopped listing files"),
  "exploration.search": entry("Searching code", "Searched code", "Code search failed", "Stopped searching code"),
  "file.create": entry("Creating file", "Created file", "File creation failed", "Stopped creating file"),
  "file.edit": entry("Editing file", "Edited file", "File edit failed", "Stopped editing file"),
  "file.delete": entry("Deleting file", "Deleted file", "File deletion failed", "Stopped deleting file")
});

export const ACTIVITY_COPY_CATALOGS = Object.freeze({
  "zh-CN": Object.freeze(zhCN),
  en: Object.freeze(en)
});

export function activityCopy(semanticKey, status, locale = "zh-CN") {
  const catalog = ACTIVITY_COPY_CATALOGS[locale] ?? ACTIVITY_COPY_CATALOGS["zh-CN"];
  const selected = catalog[semanticKey] ?? catalog["generic.dynamic_tool"];
  return selected[status] ?? selected.running;
}
