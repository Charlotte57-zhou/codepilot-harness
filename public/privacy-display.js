const windowsHome = /[A-Za-z]:[\\/]Users[\\/][^\\/\s"'<>]+/gi;
const posixHome = /\/(?:Users|home)\/[^/\s"'<>]+/g;

export function redactLocalPaths(value) {
  return String(value ?? "")
    .replace(windowsHome, "~")
    .replace(posixHome, "~");
}
