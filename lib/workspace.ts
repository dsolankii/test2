import { randomUUID } from "crypto";

export const WORKSPACE_COOKIE = "leadgrid_user_id";
export const WORKSPACE_HEADER = "x-leadgrid-user-id";

let currentWorkspaceId: string | null = null;

export function safeWorkspaceId(value: string | undefined | null) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);

  return cleaned;
}

export function createWorkspaceId() {
  return `u_${randomUUID().replace(/-/g, "")}`;
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

export function setWorkspaceIdForRequest(workspaceId: string) {
  const cleaned = safeWorkspaceId(workspaceId) || createWorkspaceId();

  currentWorkspaceId = cleaned;
  process.env.LEADGRID_USER_ID = cleaned;
  process.env.LEADGRID_WORKSPACE_ID = cleaned;

  return cleaned;
}

export function workspaceIdFromRequest(request: Request) {
  if (currentWorkspaceId) return currentWorkspaceId;

  const fromHeader = safeWorkspaceId(request.headers.get(WORKSPACE_HEADER));
  if (fromHeader) return fromHeader;

  const fromCookie = safeWorkspaceId(
    parseCookieValue(request.headers.get("cookie"), WORKSPACE_COOKIE)
  );
  if (fromCookie) return fromCookie;

  return createWorkspaceId();
}

export function applyWorkspaceToRequest(request: Request) {
  return setWorkspaceIdForRequest(workspaceIdFromRequest(request));
}
