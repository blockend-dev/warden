// Per-visitor demo-session identity. Not a credential — it only ever points
// at an in-memory, throwaway principal/agent pair (see demo-session.ts).
// Without this, every visitor to a live deployment would share one global
// session and could see/mutate each other's mandates.

import { NextResponse } from "next/server";

const COOKIE_NAME = "warden-session";

export function readSessionId(request: Request): string | undefined {
  // Route Handlers get a plain Request — no pre-parsed cookie jar — so parse
  // the raw header directly rather than pulling in a cookie-parsing dependency.
  const raw = request.headers.get("cookie");
  if (!raw) return undefined;
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match?.[1];
}

export function newSessionId(): string {
  return crypto.randomUUID();
}

export function withSessionCookie(response: NextResponse, sessionId: string): NextResponse {
  response.cookies.set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 // 1 day — long enough for a demo session, not meant to persist
  });
  return response;
}
