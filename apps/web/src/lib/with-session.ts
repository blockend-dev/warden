// Wraps a Route Handler so it always runs against the *caller's own* demo
// session — reading the session cookie if present, minting one if not, and
// stamping the response with it either way.

import { NextResponse } from "next/server";
import { getDemoSession, type DemoSession } from "./demo-session";
import { newSessionId, readSessionId, withSessionCookie } from "./session-cookie";

export async function withSession(
  request: Request,
  handler: (session: DemoSession, sessionId: string) => Promise<NextResponse>
): Promise<NextResponse> {
  const sessionId = readSessionId(request) ?? newSessionId();
  const session = getDemoSession(sessionId);
  const response = await handler(session, sessionId);
  return withSessionCookie(response, sessionId);
}
