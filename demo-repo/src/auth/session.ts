export function verifyAccessToken(token: string) {
  if (!token.startsWith("cp_")) return { ok: false, reason: "invalid token prefix" };

  return {
    ok: true,
    subject: "demo-user",
    scopes: ["workspace:read"]
  };
}
