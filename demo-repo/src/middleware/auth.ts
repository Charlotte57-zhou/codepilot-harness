import { verifyAccessToken } from "../auth/session";

export function requireAuthentication(authorization?: string) {
  const token = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const verification = verifyAccessToken(token);

  if (!verification.ok) {
    return { status: 401, body: { error: "unauthorized", reason: verification.reason } };
  }

  return { status: 200, body: { subject: verification.subject, scopes: verification.scopes } };
}
