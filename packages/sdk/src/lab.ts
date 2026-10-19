// The Attack Lab: adversarial scenarios and an autonomous-agent swarm, all run
// against the real compiled circuits on a private LocalSimulatorNetwork. Every
// "REFUSED" below is a circuit `assert` failing — there is no application-layer
// check standing in for it. Backs the web app's /lab page, `npm run lab`, and
// the SDK's own tests.

import { toHex } from "@warden/shared";
import { createWarden, type MandateHandoff, type WardenClient } from "./client.js";
import { LocalSimulatorNetwork } from "./network.js";
import { WardenError } from "./errors.js";

export type ScenarioExpectation = "allow" | "refuse";

export type ScenarioResult = {
  id: string;
  group: "Wave 1" | "Delegation" | "Pause & audit";
  title: string;
  story: string;
  expect: ScenarioExpectation;
  outcome: "allowed" | "refused";
  /** The SDK's typed error name for a refusal. */
  errorKind?: string;
  /** The circuit's own assert message for a refusal. */
  message?: string;
  /** True when the outcome matches what the protocol promises. */
  passed: boolean;
  ms: number;
};

type Actors = {
  principal: WardenClient;
  agent: WardenClient;
  sub: WardenClient;
  stranger: WardenClient;
  root: MandateHandoff;
  /** Carves a fresh child out of root and hands it to `sub`. */
  carve: (maxAmount?: bigint, actionCountLimit?: bigint, expiry?: bigint) => Promise<MandateHandoff>;
};

const ACTION = { amount: 100n, asset: "DEMO", actionType: "payment", destinationCategory: "vendor:approved" };

async function setup(): Promise<Actors> {
  const network = LocalSimulatorNetwork.create();
  const principal = createWarden({ role: "principal", network });
  const agent = createWarden({ role: "agent", network });
  const sub = createWarden({ role: "agent", network });
  const stranger = createWarden({ role: "agent", network });
  const root = await principal.createMandate({
    agentPublicKey: agent.publicKey,
    policy: {
      maxAmount: 1000n,
      asset: "DEMO",
      actionType: "payment",
      destinationCategory: "vendor:approved",
      expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
      actionCountLimit: 10n
    }
  });
  agent.importMandate(root);
  const carve = async (maxAmount = 400n, actionCountLimit = 4n, expiry?: bigint) => {
    const child = await agent.delegate({ parentId: root.id, subAgentPublicKey: sub.publicKey, maxAmount, actionCountLimit, expiry });
    sub.importMandate(child);
    return child;
  };
  return { principal, agent, sub, stranger, root, carve };
}

type Scenario = {
  id: string;
  group: ScenarioResult["group"];
  title: string;
  story: string;
  expect: ScenarioExpectation;
  run: (a: Actors) => Promise<void>;
};

const SCENARIOS: Scenario[] = [
  {
    id: "honest-spend",
    group: "Wave 1",
    title: "Honest agent spends inside its mandate",
    story: "The control case: an in-policy payment of 100 against a private 1,000 cap.",
    expect: "allow",
    run: async ({ agent, root }) => void (await agent.authorize(root.id, ACTION))
  },
  {
    id: "over-cap",
    group: "Wave 1",
    title: "Agent overspends its private cap",
    story: "A prompt-injected agent tries to move 5,000 against a 1,000 mandate. The cap is never revealed to it as a number to game — the proof just cannot be built.",
    expect: "refuse",
    run: async ({ agent, root }) => void (await agent.authorize(root.id, { ...ACTION, amount: 5000n }))
  },
  {
    id: "wrong-destination",
    group: "Wave 1",
    title: "Agent pays an unapproved destination",
    story: "Same amount, same asset — but the destination category is not the one the principal approved.",
    expect: "refuse",
    run: async ({ agent, root }) => void (await agent.authorize(root.id, { ...ACTION, destinationCategory: "vendor:unknown" }))
  },
  {
    id: "forged-history",
    group: "Wave 1",
    title: "Agent hides its spending history",
    story: "After spending 600, a dishonest agent rewrites its local ledger to claim it spent 0, hoping to spend another 600.",
    expect: "refuse",
    run: async ({ agent, root }) => {
      await agent.authorize(root.id, { ...ACTION, amount: 600n });
      agent.tamperPrivateSpend(root.id, 0n);
      await agent.authorize(root.id, { ...ACTION, amount: 600n });
    }
  },
  {
    id: "impostor-agent",
    group: "Wave 1",
    title: "Stranger replays a leaked mandate context",
    story: "Someone obtains the full private mandate bundle but not the agent's secret key, and tries to act as the agent.",
    expect: "refuse",
    run: async ({ stranger, root }) => {
      stranger.importMandate(root); // has the context, wrong secret
      await stranger.authorize(root.id, ACTION);
    }
  },
  {
    id: "agent-revokes",
    group: "Wave 1",
    title: "Agent tries to revoke or pause its own mandate",
    story: "Control belongs to the principal. The agent holds the mandate but not the principal secret.",
    expect: "refuse",
    run: async ({ agent, root }) => void (await agent.pause(root.id))
  },
  {
    id: "use-after-revoke",
    group: "Wave 1",
    title: "Agent acts after the principal revokes",
    story: "Revocation is permanent and public. No later action can succeed, by construction.",
    expect: "refuse",
    run: async ({ principal, agent, root }) => {
      await principal.revoke(root.id);
      await agent.authorize(root.id, ACTION);
    }
  },
  {
    id: "expired",
    group: "Wave 1",
    title: "Mandate created already expired",
    story: "Expiry is checked against the ledger's own block time, not a value the caller supplies.",
    expect: "refuse",
    run: async ({ principal, agent }) => {
      await principal.createMandate({
        agentPublicKey: agent.publicKey,
        policy: {
          maxAmount: 10n,
          asset: "DEMO",
          actionType: "payment",
          destinationCategory: "vendor:approved",
          expiry: BigInt(Math.floor(Date.now() / 1000) - 60),
          actionCountLimit: 1n
        }
      });
    }
  },
  {
    id: "delegate-ok",
    group: "Delegation",
    title: "Agent delegates a bounded slice to a sub-agent",
    story: "Principal → Agent → Sub-agent. The agent reserves 400 of its 1,000 and the sub-agent spends 100 of it.",
    expect: "allow",
    run: async ({ sub, carve }) => {
      const child = await carve(400n);
      await sub.authorize(child.id, ACTION);
    }
  },
  {
    id: "delegate-over-budget",
    group: "Delegation",
    title: "Agent delegates more than it has",
    story: "The agent tries to carve out 2,000 from a 1,000 mandate — authority cannot be created from nothing.",
    expect: "refuse",
    run: async ({ carve }) => void (await carve(2000n))
  },
  {
    id: "sibling-double-allocation",
    group: "Delegation",
    title: "Two siblings jointly exceed the parent's cap",
    story: "600 + 600 against a 1,000 parent. Delegation spends the parent's budget immediately, so the second carve-out has nothing to draw on.",
    expect: "refuse",
    run: async ({ carve }) => {
      await carve(600n);
      await carve(600n);
    }
  },
  {
    id: "outlive-parent",
    group: "Delegation",
    title: "Child tries to outlive its parent",
    story: "A child mandate expiring after the parent would keep authority alive past the principal's deadline.",
    expect: "refuse",
    run: async ({ root, carve }) => void (await carve(100n, 2n, root.context.policy.expiry + 3600n))
  },
  {
    id: "subagent-self-revoke",
    group: "Delegation",
    title: "Sub-agent revokes its own mandate",
    story: "Only the delegating agent controls its child. The sub-agent can act — and cannot rewrite its own limits.",
    expect: "refuse",
    run: async ({ sub, carve }) => {
      const child = await carve(100n);
      await sub.revoke(child.id);
    }
  },
  {
    id: "cascade-revoke",
    group: "Delegation",
    title: "Root revoked → sub-agent dies instantly",
    story: "The principal revokes the ROOT. The child's own flag is untouched — yet its next action fails, because the circuit checks the parent live.",
    expect: "refuse",
    run: async ({ principal, sub, root, carve }) => {
      const child = await carve(400n);
      await sub.authorize(child.id, ACTION);
      await principal.revoke(root.id);
      await sub.authorize(child.id, ACTION);
    }
  },
  {
    id: "type-confusion",
    group: "Delegation",
    title: "Delegated id fed to the Wave 1 authorize circuit",
    story: "Domain-separated hashing means a delegated id can never validate as a root id — no circuit can be tricked into treating one as the other.",
    expect: "refuse",
    run: async ({ sub, carve }) => {
      const child = await carve(400n);
      await sub.unsafeInvoke("authorize", [child.id, 1n, new Uint8Array(32), new Uint8Array(32), new Uint8Array(32)]);
    }
  },
  {
    id: "pause-resume",
    group: "Pause & audit",
    title: "Pause freezes the whole subtree — and resume restores it",
    story: "A reversible kill-switch. While the root is paused the sub-agent is blocked; after resume it works again, with its spend state intact.",
    expect: "allow",
    run: async ({ principal, sub, root, carve }) => {
      const child = await carve(400n);
      await principal.pause(root.id);
      let blocked = false;
      try {
        await sub.authorize(child.id, ACTION);
      } catch {
        blocked = true;
      }
      if (!blocked) throw new Error("Lab invariant broken: sub-agent acted while the root was paused.");
      await principal.resume(root.id);
      await sub.authorize(child.id, ACTION);
    }
  },
  {
    id: "paused-spend",
    group: "Pause & audit",
    title: "Agent acts while paused",
    story: "The principal flips the kill-switch. The very next action is refused without revoking anything.",
    expect: "refuse",
    run: async ({ principal, agent, root }) => {
      await principal.pause(root.id);
      await agent.authorize(root.id, ACTION);
    }
  },
  {
    id: "honest-attestation",
    group: "Pause & audit",
    title: "Agent proves 'I spent at most 500' to an auditor",
    story: "After spending 250, the agent proves a ceiling of 500 against the on-chain commitment. The ledger learns the ceiling — never the 250.",
    expect: "allow",
    run: async ({ agent, root }) => {
      await agent.authorize(root.id, { ...ACTION, amount: 250n });
      await agent.attestSpend(root.id, 500n);
    }
  },
  {
    id: "false-attestation",
    group: "Pause & audit",
    title: "Agent attests a ceiling lower than its real spend",
    story: "After spending 250, the agent tries to publish 'spent at most 100'. A false statement has no valid proof.",
    expect: "refuse",
    run: async ({ agent, root }) => {
      await agent.authorize(root.id, { ...ACTION, amount: 250n });
      await agent.attestSpend(root.id, 100n);
    }
  }
];

export const SCENARIO_COUNT = SCENARIOS.length;

export async function runAttackSuite(only?: string[]): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const s of SCENARIOS) {
    if (only && !only.includes(s.id)) continue;
    const started = Date.now();
    let outcome: ScenarioResult["outcome"] = "allowed";
    let errorKind: string | undefined;
    let message: string | undefined;
    try {
      await s.run(await setup());
    } catch (cause) {
      outcome = "refused";
      if (cause instanceof WardenError) {
        errorKind = cause.name;
        message = cause.message;
      } else {
        errorKind = "UnknownError";
        message = cause instanceof Error ? cause.message : String(cause);
      }
    }
    results.push({
      id: s.id,
      group: s.group,
      title: s.title,
      story: s.story,
      expect: s.expect,
      outcome,
      errorKind,
      message: message ? cleanAssert(message) : undefined,
      passed: (s.expect === "allow") === (outcome === "allowed"),
      ms: Date.now() - started
    });
  }
  return results;
}

/** Strips the runtime's "failed assert: " prefix for display. */
function cleanAssert(message: string): string {
  return message.replace(/^.*failed assert:\s*/i, "").trim();
}

// ---------------------------------------------------------------------------
// Swarm
// ---------------------------------------------------------------------------

export type SwarmEvent = {
  step: number;
  actor: string; // "agent-1" | "agent-2" | "agent-3" | "principal" | "root-agent"
  action: "spend" | "pause" | "resume" | "revoke" | "attest";
  amount?: number;
  /** Which kind of misbehaviour this step simulates, if any. */
  rogue?: "overspend" | "wrong-destination" | "none";
  outcome: "allowed" | "refused";
  errorKind?: string;
  message?: string;
  /** Public ledger snapshot after the step. */
  actionsAuthorized: number;
  commitment: string;
  status: string;
};

export type SwarmResult = {
  seed: number;
  agents: Array<{ name: string; id: string; cap: number }>;
  rootId: string;
  events: SwarmEvent[];
  summary: { allowed: number; refused: number; rogueAttempts: number; rogueBlocked: number };
};

/** Deterministic PRNG so a seed reproduces a swarm run exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Runs one root mandate, three delegated sub-agents and ~24 autonomous steps
 * with a rogue bias, a pause/resume window and a mid-run root revocation. */
export async function runSwarm(seed = 7, steps = 24): Promise<SwarmResult> {
  const rand = mulberry32(seed);
  const network = LocalSimulatorNetwork.create();
  const principal = createWarden({ role: "principal", network });
  const delegator = createWarden({ role: "agent", network });
  const subs = [0, 1, 2].map(() => createWarden({ role: "agent", network }));
  const root = await principal.createMandate({
    agentPublicKey: delegator.publicKey,
    policy: {
      maxAmount: 1000n,
      asset: "DEMO",
      actionType: "payment",
      destinationCategory: "vendor:approved",
      expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
      actionCountLimit: 30n
    }
  });
  delegator.importMandate(root);

  const caps = [350n, 300n, 250n];
  const children: MandateHandoff[] = [];
  for (let i = 0; i < subs.length; i++) {
    const child = await delegator.delegate({
      parentId: root.id,
      subAgentPublicKey: subs[i].publicKey,
      maxAmount: caps[i],
      actionCountLimit: 8n
    });
    subs[i].importMandate(child);
    children.push(child);
  }

  const events: SwarmEvent[] = [];
  const pauseAt = Math.floor(steps * 0.45);
  const resumeAt = pauseAt + 2;
  const revokeAt = Math.floor(steps * 0.78);
  const attestAt = Math.floor(steps * 0.3);

  const snapshot = async (id: Uint8Array) => {
    const s = await principal.status(id);
    return { actionsAuthorized: s.actionsAuthorized, commitment: s.spentCommitment ?? "", status: s.status };
  };

  const record = async (
    step: number,
    actor: string,
    action: SwarmEvent["action"],
    watch: Uint8Array,
    fn: () => Promise<unknown>,
    extra: Partial<SwarmEvent> = {}
  ) => {
    let outcome: SwarmEvent["outcome"] = "allowed";
    let errorKind: string | undefined;
    let message: string | undefined;
    try {
      await fn();
    } catch (cause) {
      outcome = "refused";
      errorKind = cause instanceof WardenError ? cause.name : "UnknownError";
      message = cleanAssert(cause instanceof Error ? cause.message : String(cause));
    }
    events.push({ step, actor, action, outcome, errorKind, message, ...(await snapshot(watch)), ...extra });
  };

  for (let step = 1; step <= steps; step++) {
    if (step === attestAt) {
      await record(step, "root-agent", "attest", root.id, () => delegator.attestSpend(root.id, 900n));
      continue;
    }
    if (step === pauseAt) {
      await record(step, "principal", "pause", root.id, () => principal.pause(root.id));
      continue;
    }
    if (step === resumeAt) {
      await record(step, "principal", "resume", root.id, () => principal.resume(root.id));
      continue;
    }
    if (step === revokeAt) {
      await record(step, "principal", "revoke", root.id, () => principal.revoke(root.id));
      continue;
    }

    const i = Math.floor(rand() * subs.length);
    const roll = rand();
    const rogue: SwarmEvent["rogue"] = roll < 0.16 ? "overspend" : roll < 0.28 ? "wrong-destination" : "none";
    const amount = rogue === "overspend" ? 400 + Math.floor(rand() * 600) : 20 + Math.floor(rand() * 90);
    const destination = rogue === "wrong-destination" ? "vendor:unknown" : "vendor:approved";
    await record(
      step,
      `agent-${i + 1}`,
      "spend",
      children[i].id,
      () => subs[i].authorize(children[i].id, { amount: BigInt(amount), asset: "DEMO", actionType: "payment", destinationCategory: destination }),
      { amount, rogue }
    );
  }

  const spends = events.filter((e) => e.action === "spend");
  const rogueSteps = spends.filter((e) => e.rogue && e.rogue !== "none");
  return {
    seed,
    rootId: toHex(root.id),
    agents: children.map((c, i) => ({ name: `agent-${i + 1}`, id: toHex(c.id), cap: Number(caps[i]) })),
    events,
    summary: {
      allowed: events.filter((e) => e.outcome === "allowed").length,
      refused: events.filter((e) => e.outcome === "refused").length,
      rogueAttempts: rogueSteps.length,
      rogueBlocked: rogueSteps.filter((e) => e.outcome === "refused").length
    }
  };
}
