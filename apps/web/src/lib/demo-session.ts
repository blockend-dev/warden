// Server-side demo sessions, one per visitor (see session-cookie.ts /
// with-session.ts for how a visitor is identified). Held in a globalThis map
// so they survive Next.js dev-server module reloads; a server restart or
// redeploy resets every session. Each session's own principal and agent
// identity persist for its lifetime and can hold any number of real
// mandates concurrently — this is not a toy single-mandate flag, it's the
// same `WardenClient` a real integration uses.
//
// Deliberately still in-memory, not a database: correct for a single
// long-lived Node process (the deployment target documented in
// docs/IMPLEMENTATION-NOTES.md), not for a serverless/multi-instance host
// where separate requests may land on separate processes.

import { createWarden, type MandateHandoff, type WardenClient } from "@warden/sdk";
import { toHex } from "@warden/shared";

export type DemoSession = {
  principal: WardenClient;
  agent: WardenClient;
  handoffs: Map<string, MandateHandoff>; // key: mandate id, hex — insertion order preserved
};

// Demo-scale safeguard so a long-lived, publicly-reachable instance can't
// accumulate unbounded sessions from abandoned visits — evicts the oldest
// once full, never a size judges would plausibly hit during a demo.
const MAX_SESSIONS = 500;

type Global = typeof globalThis & { __wardenSessions?: Map<string, DemoSession> };

function store(): Map<string, DemoSession> {
  const g = globalThis as Global;
  if (!g.__wardenSessions) {
    g.__wardenSessions = new Map();
  }
  return g.__wardenSessions;
}

function fresh(): DemoSession {
  return {
    principal: createWarden({ role: "principal" }),
    agent: createWarden({ role: "agent" }),
    handoffs: new Map()
  };
}

export function getDemoSession(sessionId: string): DemoSession {
  const sessions = store();
  let session = sessions.get(sessionId);
  if (!session) {
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest !== undefined) sessions.delete(oldest);
    }
    session = fresh();
    sessions.set(sessionId, session);
  }
  return session;
}

export function resetDemoSession(sessionId: string): DemoSession {
  const session = fresh();
  store().set(sessionId, session);
  return session;
}

export function rememberMandate(session: DemoSession, handoff: MandateHandoff): void {
  session.handoffs.set(toHex(handoff.id), handoff);
}

export function findHandoff(session: DemoSession, idHex: string): MandateHandoff | undefined {
  return session.handoffs.get(idHex);
}
