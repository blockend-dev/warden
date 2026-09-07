// Server-side demo session. Held in a globalThis singleton so it survives
// Next.js dev-server reloads; restarting the server resets the demo.

import { createWarden, type MandateHandoff, type WardenClient } from "@warden/sdk";

export type DemoSession = {
  principal: WardenClient;
  agent: WardenClient;
  handoff?: MandateHandoff;
};

type Global = typeof globalThis & { __wardenDemoSession?: DemoSession };

function fresh(): DemoSession {
  const principal = createWarden({ role: "principal" });
  const agent = createWarden({ role: "agent" });
  return { principal, agent };
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
