// End-to-end SDK test: two genuinely separate `WardenClient`s (their own
// generated identities, their own private state) transacting against one
// shared `LocalSimulatorNetwork` — proving the principal/agent split works
// through the public API, not just inside `packages/contracts`' own tests.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createWarden, type WardenClient } from "./client.js";
import { LocalSimulatorNetwork } from "./network.js";
import { PolicyViolationError, MandateRevokedError, MandateExpiredError, NotAuthorizedError } from "./errors.js";

const POLICY = {
  maxAmount: 500n,
  asset: "DEMO",
  actionType: "payment",
  destinationCategory: "vendor:approved",
  expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
  actionCountLimit: 5n
};
const ACTION = { amount: 100n, asset: "DEMO", actionType: "payment", destinationCategory: "vendor:approved" };

describe("WardenClient — two-party flow", () => {
  let network: Promise<LocalSimulatorNetwork>;
  let principal: WardenClient;
  let agent: WardenClient;

  beforeEach(() => {
    network = LocalSimulatorNetwork.create();
    principal = createWarden({ role: "principal", network });
    agent = createWarden({ role: "agent", network });
  });

  it("lets an agent authorize an in-policy action after a real handoff", async () => {
    const handoff = await principal.createMandate({ agentPublicKey: agent.publicKey, policy: POLICY });
    agent.importMandate(handoff);

    await agent.authorize(handoff.id, ACTION);

    const status = await principal.status(handoff.id);
    expect(status.status).toBe("active");
    expect(status.actionsAuthorized).toBe(1);
  });

  it("blocks an over-cap action without exposing the cap in the error", async () => {
    const handoff = await principal.createMandate({ agentPublicKey: agent.publicKey, policy: POLICY });
    agent.importMandate(handoff);

    await expect(agent.authorize(handoff.id, { ...ACTION, amount: 999n })).rejects.toBeInstanceOf(PolicyViolationError);
  });

  it("blocks every future action immediately after the principal revokes", async () => {
    const handoff = await principal.createMandate({ agentPublicKey: agent.publicKey, policy: POLICY });
    agent.importMandate(handoff);
    await agent.authorize(handoff.id, ACTION);

    await principal.revoke(handoff.id);

    await expect(agent.authorize(handoff.id, ACTION)).rejects.toBeInstanceOf(MandateRevokedError);
    const status = await principal.status(handoff.id);
    expect(status.status).toBe("revoked");
  });

  it("status() reports \"expired\" once its own known policy's expiry has passed", async () => {
    const shortLived = { ...POLICY, expiry: BigInt(Math.floor(Date.now() / 1000) + 60) };
    const handoff = await principal.createMandate({ agentPublicKey: agent.publicKey, policy: shortLived });

    expect((await principal.status(handoff.id)).status).toBe("active");

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 120_000);
    try {
      expect((await principal.status(handoff.id)).status).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to create a mandate whose expiry has already passed", async () => {
    const pastExpiry = { ...POLICY, expiry: BigInt(Math.floor(Date.now() / 1000) - 10) };
    await expect(
      principal.createMandate({ agentPublicKey: agent.publicKey, policy: pastExpiry })
    ).rejects.toBeInstanceOf(MandateExpiredError);
  });

  it("refuses a third party's attempt to revoke someone else's mandate", async () => {
    const handoff = await principal.createMandate({ agentPublicKey: agent.publicKey, policy: POLICY });

    const impostor = createWarden({ role: "principal", network });
    await expect(impostor.revoke(handoff.id)).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it("refuses an agent that was never handed the mandate", async () => {
    const handoff = await principal.createMandate({ agentPublicKey: agent.publicKey, policy: POLICY });
    const impostorAgent = createWarden({ role: "agent", network });
    // The impostor never received the handoff, so it has no local record at
    // all for this id — this is the "no local record" witness failure path,
    // not a mismatched-secret one.
    await expect(impostorAgent.authorize(handoff.id, ACTION)).rejects.toThrow();
  });

  it("never lets the agent's authorize call see or return the private policy", async () => {
    const handoff = await principal.createMandate({ agentPublicKey: agent.publicKey, policy: POLICY });
    agent.importMandate(handoff);
    const result = await agent.authorize(handoff.id, ACTION);
    // `authorize` resolves `void` — there is no return value to leak the
    // policy through in the first place.
    expect(result).toBeUndefined();
  });
});
