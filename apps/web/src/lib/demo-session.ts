// Server-side demo session state. Runs inside the Next.js server process (a
// Route Handler, not a browser bundle) specifically so it can use
// `@warden/sdk`'s `LocalSimulatorNetwork` — real compiled-circuit execution
// via `@midnight-ntwrk/compact-runtime` — without needing that runtime to be
// browser-bundled. See `docs/IMPLEMENTATION-NOTES.md` and the note in
// `README.md` about this environment having no Docker/proof-server for a
// live network. State is process-memory only (a `globalThis` singleton, the
// standard way to survive Next.js dev-server module reloads) — restarting
// the server resets the demo, which is the correct behavior for a judge
// re-running the script from a clean state.

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
