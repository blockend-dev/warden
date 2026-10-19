// Wave 2 end-to-end through the SDK: three separate WardenClients
// (principal -> agent -> sub-agent) over one shared LocalSimulatorNetwork.

import { describe, it, expect, beforeEach } from "vitest";
import { createWarden, type MandateHandoff, type WardenClient } from "./client.js";
import { LocalSimulatorNetwork } from "./network.js";
import { toHex } from "@warden/shared";
import {
  AttestationError,
  DelegationError,
  MandatePausedError,
  MandateRevokedError,
  NotAuthorizedError,
  PolicyViolationError
} from "./errors.js";

const POLICY = {
  maxAmount: 1000n,
  asset: "DEMO",
  actionType: "payment",
  destinationCategory: "vendor:approved",
  expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
  actionCountLimit: 10n
};
const ACTION = { amount: 100n, asset: "DEMO", actionType: "payment", destinationCategory: "vendor:approved" };

describe("Wave 2 — Principal -> Agent -> Sub-agent", () => {
  let network: Promise<LocalSimulatorNetwork>;
  let principal: WardenClient;
  let agent: WardenClient;
  let sub: WardenClient;
  let root: MandateHandoff;

  beforeEach(async () => {
    network = LocalSimulatorNetwork.create();
    principal = createWarden({ role: "principal", network });
    agent = createWarden({ role: "agent", network });
    sub = createWarden({ role: "agent", network });
    root = await principal.createMandate({ agentPublicKey: agent.publicKey, policy: POLICY });
    agent.importMandate(root);
  });

  const carve = async (maxAmount = 400n, actionCountLimit = 3n) => {
    const child = await agent.delegate({ parentId: root.id, subAgentPublicKey: sub.publicKey, maxAmount, actionCountLimit });
    sub.importMandate(child);
    return child;
  };

  it("delegates, and the sub-agent acts under its own bounded mandate", async () => {
    const child = await carve();
    await sub.authorize(child.id, ACTION);

    const s = await principal.status(child.id);
    expect(s.kind).toBe("delegated");
    expect(s.parentId).toBe(toHex(root.id));
    expect(s.status).toBe("active");
    expect(s.actionsAuthorized).toBe(1);
    expect(await principal.children(root.id)).toEqual([toHex(child.id)]);
  });

  it("charges the carve-out against the parent's own budget", async () => {
    await carve(800n);
    await expect(agent.authorize(root.id, { ...ACTION, amount: 201n })).rejects.toBeInstanceOf(PolicyViolationError);
    await agent.authorize(root.id, { ...ACTION, amount: 200n });
  });

  it("rejects a carve-out bigger than the parent's remaining budget", async () => {
    await carve(800n);
    await expect(
      agent.delegate({ parentId: root.id, subAgentPublicKey: sub.publicKey, maxAmount: 300n, actionCountLimit: 1n })
    ).rejects.toBeInstanceOf(DelegationError);
  });

  it("refuses a child that outlives its parent", async () => {
    await expect(
      agent.delegate({
        parentId: root.id,
        subAgentPublicKey: sub.publicKey,
        maxAmount: 10n,
        actionCountLimit: 1n,
        expiry: POLICY.expiry + 10n
      })
    ).rejects.toBeInstanceOf(DelegationError);
  });

  it("only the parent's agent can delegate", async () => {
    await expect(
      sub.delegate({ parentId: root.id, subAgentPublicKey: sub.publicKey, maxAmount: 1n, actionCountLimit: 1n })
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it("revoking the ROOT kills the sub-agent without touching the child's own flag", async () => {
    const child = await carve();
    await sub.authorize(child.id, ACTION);

    await principal.revoke(root.id);

    await expect(sub.authorize(child.id, ACTION)).rejects.toBeInstanceOf(MandateRevokedError);
    const s = await principal.status(child.id);
    expect(s.status).toBe("revoked");
    expect(s.blockedByParent).toBe("revoked");
  });

  it("pause is reversible and propagates to children", async () => {
    const child = await carve();
    await principal.pause(root.id);

    await expect(sub.authorize(child.id, ACTION)).rejects.toBeInstanceOf(MandatePausedError);
    await expect(agent.authorize(root.id, ACTION)).rejects.toBeInstanceOf(MandatePausedError);
    expect((await principal.status(child.id)).status).toBe("paused");
    expect((await principal.status(child.id)).blockedByParent).toBe("paused");

    await principal.resume(root.id);
    await sub.authorize(child.id, ACTION);
    expect((await principal.status(child.id)).status).toBe("active");
  });

  it("the delegating agent can revoke its child alone", async () => {
    const child = await carve();
    await agent.revoke(child.id);
    await expect(sub.authorize(child.id, ACTION)).rejects.toBeInstanceOf(MandateRevokedError);
    expect((await principal.status(root.id)).status).toBe("active");
  });

  it("the sub-agent cannot revoke its own mandate", async () => {
    const child = await carve();
    await expect(sub.revoke(child.id)).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it("attestSpend discloses a ceiling and nothing more, and goes stale on new activity", async () => {
    await agent.authorize(root.id, { ...ACTION, amount: 250n });
    await agent.attestSpend(root.id, 300n);

    const fresh = (await principal.status(root.id)).attestation!;
    expect(fresh).toEqual({ ceiling: "300", atCount: 1, stale: false });

    await agent.authorize(root.id, ACTION);
    expect((await principal.status(root.id)).attestation!.stale).toBe(true);
    // The real running total stays private to the agent.
    expect(agent.privateSpend(root.id)).toBe(350n);
    expect(principal.privateSpend(root.id)).toBe(0n);
  });

  it("attestSpend refuses a false ceiling", async () => {
    await agent.authorize(root.id, { ...ACTION, amount: 250n });
    await expect(agent.attestSpend(root.id, 249n)).rejects.toBeInstanceOf(AttestationError);
  });

  it("a failed delegate leaves the agent's private state intact", async () => {
    await expect(
      agent.delegate({ parentId: root.id, subAgentPublicKey: sub.publicKey, maxAmount: 5000n, actionCountLimit: 1n })
    ).rejects.toBeInstanceOf(DelegationError);
    // The failed attempt must not have desynchronised the parent's spend nonce.
    await agent.authorize(root.id, ACTION);
    const child = await carve(100n);
    await sub.authorize(child.id, { ...ACTION, amount: 100n });
  });
});
