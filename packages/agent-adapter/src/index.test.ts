import { describe, it, expect, vi } from "vitest";
import { createWarden, LocalSimulatorNetwork, PolicyViolationError } from "@warden/sdk";
import { guard, createWardenTool } from "./index.js";

const POLICY = {
  maxAmount: 500n,
  asset: "DEMO",
  actionType: "payment",
  destinationCategory: "vendor:approved",
  expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
  actionCountLimit: 5n
};
const ACTION = { amount: 100n, asset: "DEMO", actionType: "payment", destinationCategory: "vendor:approved" };

describe("guard", () => {
  it("only calls the wrapped effect once Warden authorizes the action", async () => {
    const network = LocalSimulatorNetwork.create();
    const principal = createWarden({ role: "principal", network });
    const agent = createWarden({ role: "agent", network });
    const handoff = await principal.createMandate({ agentPublicKey: agent.publicKey, policy: POLICY });
    agent.importMandate(handoff);

    const effect = vi.fn(async (action) => `paid ${action.amount}`);
    const guardedPay = guard(agent, handoff.id, effect);

    const result = await guardedPay(ACTION);

    expect(result).toBe("paid 100");
    expect(effect).toHaveBeenCalledOnce();
  });

  it("never calls the wrapped effect when the action violates the mandate", async () => {
    const network = LocalSimulatorNetwork.create();
    const principal = createWarden({ role: "principal", network });
    const agent = createWarden({ role: "agent", network });
    const handoff = await principal.createMandate({ agentPublicKey: agent.publicKey, policy: POLICY });
    agent.importMandate(handoff);

    const effect = vi.fn(async () => "should never run");
    const guardedPay = guard(agent, handoff.id, effect);

    await expect(guardedPay({ ...ACTION, amount: 9_999n })).rejects.toBeInstanceOf(PolicyViolationError);
    expect(effect).not.toHaveBeenCalled();
  });
});

describe("createWardenTool", () => {
  it("produces a named tool whose run() is authorization-gated", async () => {
    const network = LocalSimulatorNetwork.create();
    const principal = createWarden({ role: "principal", network });
    const agent = createWarden({ role: "agent", network });
    const handoff = await principal.createMandate({ agentPublicKey: agent.publicKey, policy: POLICY });
    agent.importMandate(handoff);

    const tool = createWardenTool({
      name: "send-payment",
      description: "Sends a payment on the principal's behalf, within its mandate.",
      warden: agent,
      mandateId: handoff.id,
      effect: async (action) => `sent ${action.amount}`
    });

    expect(tool.name).toBe("send-payment");
    await expect(tool.run(ACTION)).resolves.toBe("sent 100");
  });
});
