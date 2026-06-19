import { randomUUID } from "crypto";

export const WORKSPACE_COOKIE = "leadgrid_user_id";
export const WORKSPACE_HEADER = "x-leadgrid-user-id";

export function safeWorkspaceId(value: string | undefined | null) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);

  return cleaned || `u_${randomUUID().replace(/-/g, "")}`;
}

export function parseCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;

  const parts = cookieHeader.split(";");

  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return null;
}

export function workspaceIdFromRequest(request: Request) {
  return safeWorkspaceId(
    request.headers.get(WORKSPACE_HEADER) ||
      parseCookieValue(request.headers.get("cookie"), WORKSPACE_COOKIE)
  );
}

export function applyWorkspaceToRequest(request: Request) {
  const workspaceId = workspaceIdFromRequest(request);
  process.env.LEADGRID_USER_ID = workspaceId;
  return workspaceId;
}
