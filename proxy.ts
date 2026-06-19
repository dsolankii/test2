import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "leadgrid_user_id";
const HEADER_NAME = "x-leadgrid-user-id";

function newWorkspaceId() {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return `u_${uuid.replace(/-/g, "")}`;
}

function safeWorkspaceId(value: string | undefined | null) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);

  return cleaned || newWorkspaceId();
}

export function proxy(request: NextRequest) {
  const existing = request.cookies.get(COOKIE_NAME)?.value;
  const workspaceId = safeWorkspaceId(existing);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(HEADER_NAME, workspaceId);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (!existing || existing !== workspaceId) {
    response.cookies.set(COOKIE_NAME, workspaceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return response;
}

export const config = {
  matcher: ["/", "/console", "/leads", "/landing-page", "/api/:path*"],
};
