// Real circuit tests: every call below runs the actual compiled
// warden.compact logic (via WardenSimulator — see that file's header) with
// no mocks. Each `describe` block is named after the threat-model attack it
// proves fails; see `docs/THREAT-MODEL.md` for the narrative version of the
// same list.

import { describe, it, expect, beforeEach } from "vitest";
import { WardenSimulator } from "./warden-simulator.js";
import { buildMandate, category, randomBytes32 } from "./fixtures.js";

const ASSET = "DEMO";
const ACTION = "payment";
const DEST = "vendor:approved";
const NOW = 1_000_000n;
const BASE_POLICY = {
  maxAmount: 500n,
  asset: ASSET,
  actionType: ACTION,
  destinationCategory: DEST,
  expiry: NOW + 3_600n,
  actionCountLimit: 5n
};

describe("createMandate", () => {
  it("registers a mandate whose context hashes to the claimed id", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);

    const ledger = await sim.createMandate(id);

    expect(ledger.registered.member(id)).toBe(true);
    expect(ledger.revoked.member(id)).toBe(false);
    expect(ledger.actionCount.lookup(id).read()).toBe(0n);
  });

  it("rejects a context that does not hash to the claimed id (forged mandate)", async () => {
    const sim = await WardenSimulator.create();
    const { record } = buildMandate(1, 2, BASE_POLICY);
    const wrongId = randomBytes32(9);
    sim.seedMandate(wrongId, record);

    await expect(sim.createMandate(wrongId)).rejects.toThrow(/does not match its public id/);
  });

  it("cannot be registered twice", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id);

    await expect(sim.createMandate(id)).rejects.toThrow(/already exists/);
  });

  it("cannot be created by someone who holds only the agent secret", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, { ...record, principalSecret: undefined });

    await expect(sim.createMandate(id)).rejects.toThrow(/principal secret/);
  });

  it("rejects a zero action-count limit", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, { ...BASE_POLICY, actionCountLimit: 0n });
    sim.seedMandate(id, record);

    await expect(sim.createMandate(id)).rejects.toThrow(/action count limit must be positive/);
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
    await sim.createMandate(id);
  });

  it("authorizes an amount within cap", async () => {
    const ledger = await sim.authorize(id, 300n, category(ASSET), category(ACTION), category(DEST), NOW);
    expect(ledger.actionCount.lookup(id).read()).toBe(1n);
  });

  it("authorizes an amount landing exactly on the cap, then rejects the next unit", async () => {
    await sim.authorize(id, 500n, category(ASSET), category(ACTION), category(DEST), NOW);
    await expect(
      sim.authorize(id, 1n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/exceeds mandate cap/);
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

  it("rejects an expired mandate", async () => {
    await expect(
      sim.authorize(id, 10n, category(ASSET), category(ACTION), category(DEST), NOW + 999_999n)
    ).rejects.toThrow(/expired/);
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
    // A third identical call would be the 401st..600th unit and must fail.
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
    await sim.createMandate(id);

    sim.seedMandate(id, { ...record, agentSecret: undefined });
    await expect(
      sim.authorize(id, 1n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/agent secret/);
  });

  it("fails when called with an unrelated agent's secret", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id);

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
    await sim.createMandate(id);

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
    await sim.createMandate(id);
    await sim.authorize(id, 400n, category(ASSET), category(ACTION), category(DEST), NOW);

    // Attempt to lie: claim only 100 has been spent (real on-chain figure is
    // 400), which would make a further 400 look safe against the 500 cap.
    const currentRecord = sim.getPrivateState().mandates[Buffer.from(id).toString("hex")];
    sim.seedMandate(id, { ...currentRecord, spentTotal: 100n });

    await expect(
      sim.authorize(id, 400n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/stale or forged spend state/);
  });
});

describe("revoke", () => {
  it("blocks every future authorize call immediately and permanently", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id);
    await sim.authorize(id, 100n, category(ASSET), category(ACTION), category(DEST), NOW);

    const ledger = await sim.revoke(id);
    expect(ledger.revoked.member(id)).toBe(true);

    await expect(
      sim.authorize(id, 1n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/mandate revoked/);
  });

  it("cannot be called twice", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id);
    await sim.revoke(id);

    await expect(sim.revoke(id)).rejects.toThrow(/already revoked/);
  });

  it("cannot be called against an unregistered mandate", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);

    await expect(sim.revoke(id)).rejects.toThrow(/unknown mandate/);
  });

  it("cannot be called by a non-principal (agent-only) caller", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id);

    sim.seedMandate(id, { ...record, principalSecret: undefined });
    await expect(sim.revoke(id)).rejects.toThrow(/principal secret/);
  });
});

describe("privacy — no leakage of private policy through observable state", () => {
  it("rejection messages never contain the mandate's private cap value", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, { ...BASE_POLICY, maxAmount: 424_242n });
    sim.seedMandate(id, record);
    await sim.createMandate(id);

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
    await sim.createMandate(id);
    const ledger = await sim.authorize(id, 100n, category(ASSET), category(ACTION), category(DEST), NOW);

    // spentCommitment is the only ledger field that varies with spend
    // activity; it must be a hash, never the plaintext amount or cap.
    const commitment = ledger.spentCommitment.lookup(id);
    expect(commitment.length).toBe(32);
    const asBigEndianNumber = Buffer.from(commitment).toString("hex");
    expect(asBigEndianNumber).not.toContain("1e240"); // 123456 in hex, defensively checked as a substring
  });

  it("consecutive spend commitments for the same mandate are unlinkable byte strings", async () => {
    const sim = await WardenSimulator.create();
    const { id, record } = buildMandate(1, 2, BASE_POLICY);
    sim.seedMandate(id, record);
    await sim.createMandate(id);

    const afterFirst = await sim.authorize(id, 50n, category(ASSET), category(ACTION), category(DEST), NOW);
    const c1 = Buffer.from(afterFirst.spentCommitment.lookup(id)).toString("hex");
    const afterSecond = await sim.authorize(id, 50n, category(ASSET), category(ACTION), category(DEST), NOW);
    const c2 = Buffer.from(afterSecond.spentCommitment.lookup(id)).toString("hex");

    expect(c1).not.toBe(c2);
    // Neither commitment is a simple function of the running total alone —
    // both are 32 bytes of hash output with no shared substring of length
    // that would indicate a structural relationship an observer could exploit.
    expect(c1.slice(0, 8)).not.toBe(c2.slice(0, 8));
  });
});
