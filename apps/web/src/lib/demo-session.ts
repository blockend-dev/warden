// Server-side demo session. Held in a globalThis singleton so it survives
// Next.js dev-server reloads; restarting the server resets the demo. One
// principal and one agent identity persist for the session's lifetime and
// can hold any number of real mandates concurrently — this is not a toy
// single-mandate flag, it's the same `WardenClient` a real integration uses.

import { createWarden, type MandateHandoff, type WardenClient } from "@warden/sdk";
import { toHex } from "@warden/shared";

export type DemoSession = {
  principal: WardenClient;
  agent: WardenClient;
  handoffs: Map<string, MandateHandoff>; // key: mandate id, hex — insertion order preserved
};

type Global = typeof globalThis & { __wardenDemoSession?: DemoSession };

function fresh(): DemoSession {
  return {
    principal: createWarden({ role: "principal" }),
    agent: createWarden({ role: "agent" }),
    handoffs: new Map()
  };
}

export function getDemoSession(): DemoSession {
  const g = globalThis as Global;
  if (!g.__wardenDemoSession) {
    g.__wardenDemoSession = fresh();
  }
  return g.__wardenDemoSession;
}

export function resetDemoSession(): DemoSession {
  const g = globalThis as Global;
  g.__wardenDemoSession = fresh();
  return g.__wardenDemoSession;
}

export function rememberMandate(session: DemoSession, handoff: MandateHandoff): void {
  session.handoffs.set(toHex(handoff.id), handoff);
}

export function findHandoff(session: DemoSession, idHex: string): MandateHandoff | undefined {
  return session.handoffs.get(idHex);
}
