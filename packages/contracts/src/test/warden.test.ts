// Runs the compiled contract via WardenSimulator; see docs/THREAT-MODEL.md
// for the attack list these cases map to.

import { describe, it, expect, beforeEach } from "vitest";
import { WardenSimulator } from "./warden-simulator.js";
import { buildMandate, category, randomBytes32 } from "./fixtures.js";

const ASSET = "DEMO";
const ACTION = "payment";
const DEST = "vendor:approved";

// Fixed reference instant so expiry boundaries are deterministic.
const EPOCH = 1_700_000_000n;
const NOW = EPOCH;

const BASE_POLICY = {
  maxAmount: 500n,
  asset: ASSET,
  actionType: ACTION,
  destinationCategory: DEST,
  expiry: EPOCH + 3_600n,
  actionCountLimit: 5n
};

describe("createMandate", () => {
  it("registers a mandate whose context hashes to the claimed id", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);

    const ledger = await sim.createMandate(id, NOW);

    expect(ledger.registered.member(id)).toBe(true);
    expect(ledger.revoked.member(id)).toBe(false);
    expect(ledger.actionCount.lookup(id).read()).toBe(0n);
  });

  it("rejects a context that does not hash to the claimed id (forged mandate)", async () => {
    const sim = await WardenSimulator.create();
    const { record } = buildMandate(1, 2, BASE_POLICY);
    const wrongId = randomBytes32(9);
    sim.seedMandate(wrongId, record);

    await expect(sim.createMandate(wrongId, NOW)).rejects.toThrow(/does not match its public id/);
  });

  it("cannot be registered twice", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id, NOW);

    await expect(sim.createMandate(id, NOW)).rejects.toThrow(/already exists/);
  });

  it("cannot be created by someone who holds only the agent secret", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, { ...record, principalSecret: undefined });

    await expect(sim.createMandate(id, NOW)).rejects.toThrow(/principal secret/);
  });

  it("rejects a zero action-count limit", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, { ...BASE_POLICY, actionCountLimit: 0n });
    sim.seedMandate(id, record);

    await expect(sim.createMandate(id, NOW)).rejects.toThrow(/action count limit must be positive/);
  });

  it("rejects an expiry that has already passed", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, { ...BASE_POLICY, expiry: EPOCH - 1n });
    sim.seedMandate(id, record);

    await expect(sim.createMandate(id, NOW)).rejects.toThrow(/expiry must be in the future/);
  });

  it("accepts an expiry exactly at the current block time", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, { ...BASE_POLICY, expiry: EPOCH });
    sim.seedMandate(id, record);

    const ledger = await sim.createMandate(id, EPOCH);
    expect(ledger.registered.member(id)).toBe(true);
  });
});

describe("authorize — block-time expiry enforcement", () => {
  // Regression coverage: currentTime was previously caller-supplied and
  // unenforceable. See docs/THREAT-MODEL.md, "Block-time enforcement".
  let sim: WardenSimulator;
  let id: Uint8Array;

  beforeEach(async () => {
    sim = await WardenSimulator.create();
    const built = buildMandate(1, 2, BASE_POLICY);
    id = built.id;
    sim.seedMandate(id, built.record);
    await sim.createMandate(id, NOW);
  });

  it("authorizes before expiry", async () => {
    const ledger = await sim.authorize(id, 100n, category(ASSET), category(ACTION), category(DEST), BASE_POLICY.expiry - 1n);
    expect(ledger.actionCount.lookup(id).read()).toBe(1n);
  });

  it("authorizes exactly at the expiry instant", async () => {
    const ledger = await sim.authorize(id, 100n, category(ASSET), category(ACTION), category(DEST), BASE_POLICY.expiry);
    expect(ledger.actionCount.lookup(id).read()).toBe(1n);
  });

  it("rejects one instant past expiry", async () => {
    await expect(
      sim.authorize(id, 100n, category(ASSET), category(ACTION), category(DEST), BASE_POLICY.expiry + 1n)
    ).rejects.toThrow(/mandate expired/);
  });

  it("rejects well past expiry", async () => {
    await expect(
      sim.authorize(id, 100n, category(ASSET), category(ACTION), category(DEST), BASE_POLICY.expiry + 1_000_000n)
    ).rejects.toThrow(/mandate expired/);
  });
});

describe("authorize — policy boundaries", () => {
  let sim: WardenSimulator;
  let id: Uint8Array;

  beforeEach(async () => {
    sim = await WardenSimulator.create();
    const built = buildMandate(1, 2, BASE_POLICY);
    id = built.id;
    sim.seedMandate(id, built.record);
    await sim.createMandate(id, NOW);
  });

  it("authorizes an amount within cap", async () => {
    const ledger = await sim.authorize(id, 300n, category(ASSET), category(ACTION), category(DEST), NOW);
    expect(ledger.actionCount.lookup(id).read()).toBe(1n);
  });

  it("authorizes a zero-amount action and still consumes an action-count slot", async () => {
    const ledger = await sim.authorize(id, 0n, category(ASSET), category(ACTION), category(DEST), NOW);
    expect(ledger.actionCount.lookup(id).read()).toBe(1n);
  });

  it("authorizes an amount landing exactly on the cap, then rejects the next unit", async () => {
    await sim.authorize(id, 500n, category(ASSET), category(ACTION), category(DEST), NOW);
    await expect(
      sim.authorize(id, 1n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/exceeds mandate cap/);
  });

  it("allows a zero-amount action even once the cap is fully spent", async () => {
    await sim.authorize(id, 500n, category(ASSET), category(ACTION), category(DEST), NOW);
    const ledger = await sim.authorize(id, 0n, category(ASSET), category(ACTION), category(DEST), NOW);
    expect(ledger.actionCount.lookup(id).read()).toBe(2n);
  });

  it("rejects a cumulative amount that would exceed the cap", async () => {
    await sim.authorize(id, 300n, category(ASSET), category(ACTION), category(DEST), NOW);
    await expect(
      sim.authorize(id, 300n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/exceeds mandate cap/);
  });

  it("rejects a disallowed asset", async () => {
    await expect(
      sim.authorize(id, 10n, category("OTHER"), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/asset not permitted/);
  });

  it("rejects a disallowed action type", async () => {
    await expect(
      sim.authorize(id, 10n, category(ASSET), category("refund"), category(DEST), NOW)
    ).rejects.toThrow(/action type not permitted/);
  });

  it("rejects a disallowed destination category", async () => {
    await expect(
      sim.authorize(id, 10n, category(ASSET), category(ACTION), category("vendor:unapproved"), NOW)
    ).rejects.toThrow(/destination not permitted/);
  });

  it("enforces the action-count limit", async () => {
    for (let i = 0; i < 5; i++) {
      await sim.authorize(id, 1n, category(ASSET), category(ACTION), category(DEST), NOW);
    }
    await expect(
      sim.authorize(id, 1n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/action count limit reached/);
  });

  it("two back-to-back valid calls consume the cap independently, not idempotently", async () => {
    await sim.authorize(id, 200n, category(ASSET), category(ACTION), category(DEST), NOW);
    const ledger = await sim.authorize(id, 200n, category(ASSET), category(ACTION), category(DEST), NOW);
    expect(ledger.actionCount.lookup(id).read()).toBe(2n);
    await expect(
      sim.authorize(id, 200n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/exceeds mandate cap/);
  });
});

describe("authorize — authorization and impersonation", () => {
  it("fails against an unregistered mandate id", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record); // seeded locally, but createMandate was never called
    await expect(
      sim.authorize(id, 1n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/unknown mandate/);
  });

  it("fails when the caller only holds the principal's secret, not the agent's", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id, NOW);

    sim.seedMandate(id, { ...record, agentSecret: undefined });
    await expect(
      sim.authorize(id, 1n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/agent secret/);
  });

  it("fails when called with an unrelated agent's secret", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id, NOW);

    const unrelated = buildMandate(7, 8, BASE_POLICY);
    sim.seedMandate(id, { ...record, agentSecret: unrelated.agentSecret });

    await expect(
      sim.authorize(id, 1n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/authorized agent/);
  });

  it("fails once the policy is altered locally after registration", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id, NOW);

    const tampered = {
      ...record,
      context: { ...record.context, policy: { ...record.context.policy, maxAmount: 999_999n } }
    };
    sim.seedMandate(id, tampered);

    await expect(
      sim.authorize(id, 1n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/does not match its public id/);
  });

  it("fails when a witness understates prior spend to free up headroom", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id, NOW);
    await sim.authorize(id, 400n, category(ASSET), category(ACTION), category(DEST), NOW);

    const currentRecord = sim.getPrivateState().mandates[Buffer.from(id).toString("hex")];
    sim.seedMandate(id, { ...currentRecord, spentTotal: 100n });

    await expect(
      sim.authorize(id, 400n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/stale or forged spend state/);
  });

  it("fails when mandate B's authorize is attempted with mandate A's real spend state", async () => {
    const sim = await WardenSimulator.create();
    const a = buildMandate(1, 2, BASE_POLICY);
    const b = buildMandate(3, 4, BASE_POLICY);
    sim.seedMandate(a.id, a.record);
    sim.seedMandate(b.id, b.record);
    await sim.createMandate(a.id, NOW);
    await sim.createMandate(b.id, NOW);
    await sim.authorize(a.id, 200n, category(ASSET), category(ACTION), category(DEST), NOW);

    const aRecord = sim.getPrivateState().mandates[Buffer.from(a.id).toString("hex")];
    sim.seedMandate(b.id, { ...b.record, spentTotal: aRecord.spentTotal, spentNonce: aRecord.spentNonce });

    await expect(
      sim.authorize(b.id, 1n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/stale or forged spend state/);
  });

  it("a second authorize built from the same pre-state as an already-landed one fails, rather than double-spending", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, { ...BASE_POLICY, maxAmount: 300n });
    sim.seedMandate(id, record);
    await sim.createMandate(id, NOW);

    const preRaceState = sim.getPrivateState().mandates[Buffer.from(id).toString("hex")];
    await sim.authorize(id, 300n, category(ASSET), category(ACTION), category(DEST), NOW);

    // Simulates a second proof built concurrently from the same pre-state.
    sim.seedMandate(id, preRaceState);
    await expect(
      sim.authorize(id, 300n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/stale or forged spend state/);
  });
});

describe("revoke", () => {
  it("blocks every future authorize call immediately and permanently", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id, NOW);
    await sim.authorize(id, 100n, category(ASSET), category(ACTION), category(DEST), NOW);

    const ledger = await sim.revoke(id, NOW);
    expect(ledger.revoked.member(id)).toBe(true);

    await expect(
      sim.authorize(id, 1n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/mandate revoked/);
  });

  it("cannot be called twice", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id, NOW);
    await sim.revoke(id, NOW);

    await expect(sim.revoke(id, NOW)).rejects.toThrow(/already revoked/);
  });

  it("cannot be called against an unregistered mandate", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);

    await expect(sim.revoke(id, NOW)).rejects.toThrow(/unknown mandate/);
  });

  it("cannot be called by a non-principal (agent-only) caller", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id, NOW);

    sim.seedMandate(id, { ...record, principalSecret: undefined });
    await expect(sim.revoke(id, NOW)).rejects.toThrow(/principal secret/);
  });

  it("a revoked mandate cannot be authorized even before its expiry", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id, NOW);
    await sim.revoke(id, NOW);

    await expect(
      sim.authorize(id, 1n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/mandate revoked/);
  });
});

describe("privacy — no leakage of private policy through observable state", () => {
  it("rejection messages never contain the mandate's private cap value", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, { ...BASE_POLICY, maxAmount: 424_242n });
    sim.seedMandate(id, record);
    await sim.createMandate(id, NOW);

    try {
      await sim.authorize(id, 500_000n, category(ASSET), category(ACTION), category(DEST), NOW);
      throw new Error("expected authorize to reject");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toMatch(/exceeds mandate cap/);
      expect(message).not.toContain("424242");
      expect(message).not.toContain("500000");
    }
  });

  it("the public ledger never stores a plaintext policy field", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, { ...BASE_POLICY, maxAmount: 123_456n });
    sim.seedMandate(id, record);
    await sim.createMandate(id, NOW);
    const ledger = await sim.authorize(id, 100n, category(ASSET), category(ACTION), category(DEST), NOW);

    const commitment = ledger.spentCommitment.lookup(id);
    expect(commitment.length).toBe(32);
    const asHex = Buffer.from(commitment).toString("hex");
    expect(asHex).not.toContain("1e240"); // 123456 in hex, defensively checked as a substring
  });

  it("consecutive spend commitments for the same mandate are unlinkable byte strings", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id, NOW);

    const afterFirst = await sim.authorize(id, 50n, category(ASSET), category(ACTION), category(DEST), NOW);
    const c1 = Buffer.from(afterFirst.spentCommitment.lookup(id)).toString("hex");
    const afterSecond = await sim.authorize(id, 50n, category(ASSET), category(ACTION), category(DEST), NOW);
    const c2 = Buffer.from(afterSecond.spentCommitment.lookup(id)).toString("hex");

    expect(c1).not.toBe(c2);
    expect(c1.slice(0, 8)).not.toBe(c2.slice(0, 8));
  });
});
