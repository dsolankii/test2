import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const COOKIE_NAME = "leadgrid_user_id";
const HEADER_NAME = "x-leadgrid-user-id";

function safeWorkspaceId(value?: string | null) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);

  return cleaned || "";
}

function createWorkspaceId() {
  return `u_${crypto.randomUUID().replace(/-/g, "")}`;
}

function getWorkspaceId(request: NextRequest) {
  const existing = safeWorkspaceId(request.cookies.get(COOKIE_NAME)?.value);
  if (existing) return existing;

  return createWorkspaceId();
}

function shouldRedirectToCanonical(request: NextRequest) {
  const canonical = process.env.NEXT_PUBLIC_APP_URL;
  if (!canonical) return null;

  let canonicalUrl: URL;

  try {
    canonicalUrl = new URL(canonical);
  } catch {
    return null;
  }

  const requestUrl = request.nextUrl.clone();

  if (
    requestUrl.hostname !== canonicalUrl.hostname &&
    requestUrl.hostname.endsWith(".vercel.app")
  ) {
    requestUrl.protocol = canonicalUrl.protocol;
    requestUrl.hostname = canonicalUrl.hostname;
    requestUrl.port = canonicalUrl.port;
    return requestUrl;
  }

  return null;
}

export function proxy(request: NextRequest) {
  const canonicalRedirect = shouldRedirectToCanonical(request);
  if (canonicalRedirect) {
    return NextResponse.redirect(canonicalRedirect);
  }

  const workspaceId = getWorkspaceId(request);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(HEADER_NAME, workspaceId);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.cookies.set(COOKIE_NAME, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}

export const config = {
  matcher: ["/", "/console", "/leads", "/lead", "/landing-page", "/api/:path*"],
};
