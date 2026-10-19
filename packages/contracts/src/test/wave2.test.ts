// Wave 2 coverage: nested delegation, pause/resume, spend attestation.
// Same method as warden.test.ts — real compiled circuits through the
// Compact-runtime simulator, no mocks. Every attack in
// docs/THREAT-MODEL.md §Wave 2 maps to a named case here.

import { describe, it, expect, beforeEach } from "vitest";
import { WardenSimulator } from "./warden-simulator.js";
import { buildDelegated, buildMandate, category, randomBytes32 } from "./fixtures.js";
import { pureCircuits } from "../managed/warden/contract/index.js";

const ASSET = "DEMO";
const ACTION = "payment";
const DEST = "vendor:approved";
const EPOCH = 1_700_000_000n;
const NOW = EPOCH;

const ROOT_POLICY = {
  maxAmount: 1000n,
  asset: ASSET,
  actionType: ACTION,
  destinationCategory: DEST,
  expiry: EPOCH + 3_600n,
  actionCountLimit: 10n
};

const act = (sim: WardenSimulator, id: Uint8Array, amount: bigint, at = NOW) =>
  sim.authorizeDelegated(id, amount, category(ASSET), category(ACTION), category(DEST), at);

async function rootWithSim() {
  const sim = await WardenSimulator.create();
  const root = buildMandate(1, 2, ROOT_POLICY);
  sim.seedMandate(root.id, root.record);
  await sim.createMandate(root.id, NOW);
  return { sim, root };
}

async function delegated(cap = 400n) {
  const { sim, root } = await rootWithSim();
  const child = buildDelegated(root, 3, { maxAmount: cap });
  sim.seedMandate(child.id, child.record);
  await sim.delegate(root.id, child.id, cap, NOW);
  return { sim, root, child };
}

describe("delegate", () => {
  it("registers the child, records its parent and debits the parent", async () => {
    const { sim, root } = await rootWithSim();
    const before = sim.getLedger().spentCommitment.lookup(root.id);
    const child = buildDelegated(root, 3, { maxAmount: 400n });
    sim.seedMandate(child.id, child.record);

    const ledger = await sim.delegate(root.id, child.id, 400n, NOW);

    expect(ledger.registered.member(child.id)).toBe(true);
    expect(Buffer.from(ledger.delegatedFrom.lookup(child.id))).toEqual(Buffer.from(root.id));
    expect(ledger.actionCount.lookup(child.id).read()).toBe(0n);
    expect(ledger.actionCount.lookup(root.id).read()).toBe(1n);
    expect(Buffer.from(ledger.spentCommitment.lookup(root.id))).not.toEqual(Buffer.from(before));
  });

  it("rejects a child cap larger than the parent's whole cap", async () => {
    const { sim, root } = await rootWithSim();
    const child = buildDelegated(root, 3, { maxAmount: 1001n });
    sim.seedMandate(child.id, child.record);
    await expect(sim.delegate(root.id, child.id, 1001n, NOW)).rejects.toThrow(/exceeds parent's remaining budget/);
  });

  it("blocks sibling double-allocation: two children cannot jointly exceed the parent cap", async () => {
    const { sim, root } = await rootWithSim();
    const a = buildDelegated(root, 3, { maxAmount: 600n });
    const b = buildDelegated(root, 4, { maxAmount: 600n });
    sim.seedMandate(a.id, a.record);
    sim.seedMandate(b.id, b.record);
    await sim.delegate(root.id, a.id, 600n, NOW);
    await expect(sim.delegate(root.id, b.id, 600n, NOW)).rejects.toThrow(/exceeds parent's remaining budget/);
  });

  it("allows siblings that exactly exhaust the parent cap", async () => {
    const { sim, root } = await rootWithSim();
    const a = buildDelegated(root, 3, { maxAmount: 600n });
    const b = buildDelegated(root, 4, { maxAmount: 400n });
    sim.seedMandate(a.id, a.record);
    sim.seedMandate(b.id, b.record);
    await sim.delegate(root.id, a.id, 600n, NOW);
    const ledger = await sim.delegate(root.id, b.id, 400n, NOW);
    expect(ledger.registered.member(b.id)).toBe(true);
    expect(ledger.actionCount.lookup(root.id).read()).toBe(2n);
  });

  it("shares one budget pool between direct spend and delegation", async () => {
    const { sim, root } = await rootWithSim();
    await sim.authorize(root.id, 700n, category(ASSET), category(ACTION), category(DEST), NOW);
    const tooBig = buildDelegated(root, 3, { maxAmount: 400n });
    sim.seedMandate(tooBig.id, tooBig.record);
    await expect(sim.delegate(root.id, tooBig.id, 400n, NOW)).rejects.toThrow(/exceeds parent's remaining budget/);
    const fits = buildDelegated(root, 4, { maxAmount: 300n });
    sim.seedMandate(fits.id, fits.record);
    const ledger = await sim.delegate(root.id, fits.id, 300n, NOW);
    expect(ledger.registered.member(fits.id)).toBe(true);
  });

  it("consumes one parent action slot per delegation", async () => {
    const sim = await WardenSimulator.create();
    const root = buildMandate(1, 2, { ...ROOT_POLICY, actionCountLimit: 1n });
    sim.seedMandate(root.id, root.record);
    await sim.createMandate(root.id, NOW);
    const a = buildDelegated(root, 3, { maxAmount: 100n });
    const b = buildDelegated(root, 4, { maxAmount: 100n });
    sim.seedMandate(a.id, a.record);
    sim.seedMandate(b.id, b.record);
    await sim.delegate(root.id, a.id, 100n, NOW);
    await expect(sim.delegate(root.id, b.id, 100n, NOW)).rejects.toThrow(/parent action count limit reached/);
  });

  it("rejects a child that outlives its parent", async () => {
    const { sim, root } = await rootWithSim();
    const child = buildDelegated(root, 3, { maxAmount: 100n, expiry: ROOT_POLICY.expiry + 1n });
    sim.seedMandate(child.id, child.record);
    await expect(sim.delegate(root.id, child.id, 100n, NOW)).rejects.toThrow(/child cannot outlive parent/);
  });

  it("allows a child that expires earlier than its parent", async () => {
    const { sim, root } = await rootWithSim();
    const child = buildDelegated(root, 3, { maxAmount: 100n, expiry: NOW + 60n });
    sim.seedMandate(child.id, child.record);
    const ledger = await sim.delegate(root.id, child.id, 100n, NOW);
    expect(ledger.registered.member(child.id)).toBe(true);
  });

  it("rejects a child whose expiry has already passed", async () => {
    const { sim, root } = await rootWithSim();
    const child = buildDelegated(root, 3, { maxAmount: 100n, expiry: NOW - 1n });
    sim.seedMandate(child.id, child.record);
    await expect(sim.delegate(root.id, child.id, 100n, NOW)).rejects.toThrow(/child expiry must be in the future/);
  });

  it.each([
    ["asset", { asset: "OTHER" }, /asset not inherited/],
    ["action type", { actionType: "swap" }, /action type not inherited/],
    ["destination", { destinationCategory: "vendor:unknown" }, /destination not inherited/]
  ])("rejects a child that widens the %s", async (_name, patch, message) => {
    const { sim, root } = await rootWithSim();
    const child = buildDelegated(root, 3, { maxAmount: 100n, ...patch });
    sim.seedMandate(child.id, child.record);
    await expect(sim.delegate(root.id, child.id, 100n, NOW)).rejects.toThrow(message);
  });

  it("rejects a zero action-count limit", async () => {
    const { sim, root } = await rootWithSim();
    const child = buildDelegated(root, 3, { maxAmount: 100n, actionCountLimit: 0n });
    sim.seedMandate(child.id, child.record);
    await expect(sim.delegate(root.id, child.id, 100n, NOW)).rejects.toThrow(/action count limit must be positive/);
  });

  it("rejects delegation from an unknown parent", async () => {
    const sim = await WardenSimulator.create();
    const root = buildMandate(1, 2, ROOT_POLICY);
    sim.seedMandate(root.id, root.record);
    const child = buildDelegated(root, 3, { maxAmount: 100n });
    sim.seedMandate(child.id, child.record);
    await expect(sim.delegate(root.id, child.id, 100n, NOW)).rejects.toThrow(/unknown parent mandate/);
  });

  it("rejects delegation from a revoked parent", async () => {
    const { sim, root } = await rootWithSim();
    await sim.revoke(root.id, NOW);
    const child = buildDelegated(root, 3, { maxAmount: 100n });
    sim.seedMandate(child.id, child.record);
    await expect(sim.delegate(root.id, child.id, 100n, NOW)).rejects.toThrow(/parent mandate revoked/);
  });

  it("rejects delegation from a paused parent", async () => {
    const { sim, root } = await rootWithSim();
    await sim.pause(root.id, NOW);
    const child = buildDelegated(root, 3, { maxAmount: 100n });
    sim.seedMandate(child.id, child.record);
    await expect(sim.delegate(root.id, child.id, 100n, NOW)).rejects.toThrow(/parent mandate paused/);
  });

  it("rejects delegation from an expired parent", async () => {
    const { sim, root } = await rootWithSim();
    const child = buildDelegated(root, 3, { maxAmount: 100n });
    sim.seedMandate(child.id, child.record);
    await expect(sim.delegate(root.id, child.id, 100n, ROOT_POLICY.expiry + 1n)).rejects.toThrow(/parent mandate expired/);
  });

  it("rejects a caller who is not the parent's agent", async () => {
    const { sim, root } = await rootWithSim();
    const child = buildDelegated(root, 3, { maxAmount: 100n });
    // The attacker knows the root context but holds a different agent secret.
    sim.seedMandate(root.id, { ...root.record, agentSecret: randomBytes32(99) });
    sim.seedMandate(child.id, child.record);
    await expect(sim.delegate(root.id, child.id, 100n, NOW)).rejects.toThrow(/caller is not the parent mandate's agent/);
  });

  it("rejects the principal trying to delegate on the agent's behalf", async () => {
    const { sim, root } = await rootWithSim();
    const child = buildDelegated(root, 3, { maxAmount: 100n });
    sim.seedMandate(root.id, { ...root.record, agentSecret: undefined });
    sim.seedMandate(child.id, child.record);
    await expect(sim.delegate(root.id, child.id, 100n, NOW)).rejects.toThrow(/agent secret/);
  });

  it("rejects a child context bound to a different parent", async () => {
    const { sim, root } = await rootWithSim();
    const other = buildMandate(5, 2, ROOT_POLICY);
    sim.seedMandate(other.id, other.record);
    await sim.createMandate(other.id, NOW);
    // Child claims `other` as parent, but the caller delegates from `root`.
    const child = buildDelegated(root, 3, { maxAmount: 100n }, { parentId: other.id });
    sim.seedMandate(child.id, child.record);
    await expect(sim.delegate(root.id, child.id, 100n, NOW)).rejects.toThrow(/bound to a different parent/);
  });

  it("rejects a forged child context that does not match its id", async () => {
    const { sim, root } = await rootWithSim();
    const child = buildDelegated(root, 3, { maxAmount: 100n });
    const forgedId = randomBytes32(77);
    sim.seedMandate(forgedId, child.record);
    await expect(sim.delegate(root.id, forgedId, 100n, NOW)).rejects.toThrow(/child context does not match its public id/);
  });

  it("rejects a caller who lacks the child's principal secret", async () => {
    const { sim, root } = await rootWithSim();
    const child = buildDelegated(root, 3, { maxAmount: 100n });
    sim.seedMandate(child.id, { ...child.record, principalSecret: randomBytes32(88) });
    await expect(sim.delegate(root.id, child.id, 100n, NOW)).rejects.toThrow(/does not hold the child's principal secret/);
  });

  it("rejects a delegator who is not the parent's agent (identity swap)", async () => {
    const { sim, root } = await rootWithSim();
    const thiefSecret = randomBytes32(66);
    const thiefPk = pureCircuits.pkOf(thiefSecret);
    const subSecret = randomBytes32(3);
    const policy = { ...root.context.policy, maxAmount: 100n, salt: randomBytes32() };
    const ctx = { parentId: root.id, principalPk: thiefPk, agentPk: pureCircuits.pkOf(subSecret), policy };
    const id = pureCircuits.delegatedMandateId(ctx);
    sim.seedMandate(id, {
      context: { principalPk: thiefPk, agentPk: ctx.agentPk, policy },
      parentId: root.id,
      principalSecret: thiefSecret,
      agentSecret: subSecret,
      spentTotal: 0n,
      spentNonce: new Uint8Array(32)
    });
    await expect(sim.delegate(root.id, id, 100n, NOW)).rejects.toThrow(/delegator must be the parent's agent/);
  });

  it("cannot register the same child twice", async () => {
    const { sim, root, child } = await delegated(100n);
    await expect(sim.delegate(root.id, child.id, 100n, NOW)).rejects.toThrow(/already exists/);
  });

  it("rejects a delegation built from a stale parent spend state", async () => {
    const { sim, root } = await rootWithSim();
    const first = buildDelegated(root, 3, { maxAmount: 100n });
    sim.seedMandate(first.id, first.record);
    const staleParent = sim.getPrivateState().mandates[Buffer.from(root.id).toString("hex")]!;
    await sim.delegate(root.id, first.id, 100n, NOW);

    const second = buildDelegated(root, 4, { maxAmount: 100n });
    sim.seedMandate(second.id, second.record);
    sim.seedMandate(root.id, staleParent); // replays the pre-delegation parent state
    await expect(sim.delegate(root.id, second.id, 100n, NOW)).rejects.toThrow(/stale or forged parent spend state/);
  });

  it("refuses a second hop: a delegated mandate cannot itself delegate", async () => {
    const { sim, child } = await delegated(400n);
    const grandchild = buildDelegated(
      { id: child.id, context: child.record.context, agentSecret: child.subAgentSecret } as never,
      9,
      { maxAmount: 10n }
    );
    sim.seedMandate(grandchild.id, grandchild.record);
    await expect(sim.delegate(child.id, grandchild.id, 10n, NOW)).rejects.toThrow(/delegation depth limit/);
  });
});

describe("authorizeDelegated", () => {
  it("lets the sub-agent act within its child policy", async () => {
    const { sim, child } = await delegated(400n);
    const ledger = await act(sim, child.id, 150n);
    expect(ledger.actionCount.lookup(child.id).read()).toBe(1n);
  });

  it("enforces the child's own cap, not the parent's", async () => {
    const { sim, child } = await delegated(400n);
    await act(sim, child.id, 300n);
    await expect(act(sim, child.id, 101n)).rejects.toThrow(/exceeds mandate cap/);
    await act(sim, child.id, 100n); // exactly exhausts the 400 cap
  });

  it("enforces the child's action-count limit", async () => {
    const { sim, child } = await delegated(400n);
    for (let i = 0; i < 3; i++) await act(sim, child.id, 1n);
    await expect(act(sim, child.id, 1n)).rejects.toThrow(/action count limit reached/);
  });

  it("rejects actions outside the inherited asset/type/destination", async () => {
    const { sim, child } = await delegated(400n);
    await expect(sim.authorizeDelegated(child.id, 1n, category("OTHER"), category(ACTION), category(DEST), NOW)).rejects.toThrow(
      /asset not permitted/
    );
    await expect(sim.authorizeDelegated(child.id, 1n, category(ASSET), category("swap"), category(DEST), NOW)).rejects.toThrow(
      /action type not permitted/
    );
    await expect(
      sim.authorizeDelegated(child.id, 1n, category(ASSET), category(ACTION), category("vendor:unknown"), NOW)
    ).rejects.toThrow(/destination not permitted/);
  });

  it("stops working once the child itself has expired", async () => {
    const { sim, root } = await rootWithSim();
    const child = buildDelegated(root, 3, { maxAmount: 100n, expiry: NOW + 60n });
    sim.seedMandate(child.id, child.record);
    await sim.delegate(root.id, child.id, 100n, NOW);
    await act(sim, child.id, 10n, NOW + 60n);
    await expect(act(sim, child.id, 10n, NOW + 61n)).rejects.toThrow(/mandate expired/);
  });

  it("is cut off the instant the PARENT is revoked, with its own flag untouched", async () => {
    const { sim, root, child } = await delegated(400n);
    await act(sim, child.id, 100n);
    const ledger = await sim.revoke(root.id, NOW);

    expect(ledger.revoked.member(child.id)).toBe(false); // the child was never touched…
    await expect(act(sim, child.id, 1n)).rejects.toThrow(/parent mandate revoked/); // …yet is dead
  });

  it("is suspended while the parent is paused and works again after resume", async () => {
    const { sim, root, child } = await delegated(400n);
    await sim.pause(root.id, NOW);
    await expect(act(sim, child.id, 1n)).rejects.toThrow(/parent mandate paused/);
    await sim.resume(root.id, NOW);
    const ledger = await act(sim, child.id, 1n);
    expect(ledger.actionCount.lookup(child.id).read()).toBe(1n);
  });

  it("is blocked by its own revocation but siblings are unaffected", async () => {
    const { sim, root, child } = await delegated(300n);
    const sibling = buildDelegated(root, 4, { maxAmount: 300n });
    sim.seedMandate(sibling.id, sibling.record);
    await sim.delegate(root.id, sibling.id, 300n, NOW);

    await sim.revokeDelegated(child.id, NOW);
    await expect(act(sim, child.id, 1n)).rejects.toThrow(/mandate revoked/);
    const ledger = await act(sim, sibling.id, 50n);
    expect(ledger.actionCount.lookup(sibling.id).read()).toBe(1n);
  });

  it("rejects an impostor who does not hold the sub-agent secret", async () => {
    const { sim, child } = await delegated(400n);
    sim.seedMandate(child.id, { ...child.record, agentSecret: randomBytes32(55) });
    await expect(act(sim, child.id, 1n)).rejects.toThrow(/not the authorized sub-agent/);
  });

  it("rejects the delegating agent acting as the sub-agent (roles are distinct)", async () => {
    const { sim, child } = await delegated(400n);
    sim.seedMandate(child.id, { ...child.record, agentSecret: child.record.principalSecret });
    await expect(act(sim, child.id, 1n)).rejects.toThrow(/not the authorized sub-agent/);
  });

  it("refuses a root mandate id", async () => {
    const { sim, root } = await rootWithSim();
    await expect(act(sim, root.id, 1n)).rejects.toThrow(/not a delegated mandate/);
  });

  it("refuses an unknown id", async () => {
    const sim = await WardenSimulator.create();
    await expect(act(sim, randomBytes32(1), 1n)).rejects.toThrow(/unknown mandate/);
  });

  it("refuses a delegated id on the Wave 1 authorize circuit (domain separation)", async () => {
    const { sim, child } = await delegated(400n);
    await expect(
      sim.authorize(child.id, 1n, category(ASSET), category(ACTION), category(DEST), NOW)
    ).rejects.toThrow(/does not match its public id/);
  });

  it("rejects a forged spend state (understated history)", async () => {
    const { sim, child } = await delegated(400n);
    await act(sim, child.id, 300n);
    const real = sim.getPrivateState().mandates[Buffer.from(child.id).toString("hex")]!;
    sim.seedMandate(child.id, { ...real, spentTotal: 0n });
    await expect(act(sim, child.id, 300n)).rejects.toThrow(/stale or forged spend state/);
  });

  it("keeps the child's spend commitment unlinkable across calls", async () => {
    const { sim, child } = await delegated(400n);
    const a = Buffer.from(sim.getLedger().spentCommitment.lookup(child.id)).toString("hex");
    await act(sim, child.id, 1n);
    const b = Buffer.from(sim.getLedger().spentCommitment.lookup(child.id)).toString("hex");
    await act(sim, child.id, 0n);
    const c = Buffer.from(sim.getLedger().spentCommitment.lookup(child.id)).toString("hex");
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("revokeDelegated", () => {
  it("lets the delegating agent revoke a child, permanently", async () => {
    const { sim, child } = await delegated(400n);
    const ledger = await sim.revokeDelegated(child.id, NOW);
    expect(ledger.revoked.member(child.id)).toBe(true);
    await expect(sim.revokeDelegated(child.id, NOW)).rejects.toThrow(/already revoked/);
  });

  it("does not revoke the parent", async () => {
    const { sim, root, child } = await delegated(400n);
    const ledger = await sim.revokeDelegated(child.id, NOW);
    expect(ledger.revoked.member(root.id)).toBe(false);
  });

  it("rejects the sub-agent trying to revoke its own mandate", async () => {
    const { sim, child } = await delegated(400n);
    sim.seedMandate(child.id, { ...child.record, principalSecret: undefined });
    await expect(sim.revokeDelegated(child.id, NOW)).rejects.toThrow(/principal secret/);
  });

  it("rejects a stranger", async () => {
    const { sim, child } = await delegated(400n);
    sim.seedMandate(child.id, { ...child.record, principalSecret: randomBytes32(44) });
    await expect(sim.revokeDelegated(child.id, NOW)).rejects.toThrow(/caller is not the principal/);
  });

  it("refuses root mandates", async () => {
    const { sim, root } = await rootWithSim();
    await expect(sim.revokeDelegated(root.id, NOW)).rejects.toThrow(/not a delegated mandate/);
  });
});

describe("pause / resume", () => {
  let sim: WardenSimulator;
  let id: Uint8Array;
  let root: ReturnType<typeof buildMandate>;

  beforeEach(async () => {
    ({ sim, root } = await rootWithSim());
    id = root.id;
  });

  it("blocks authorize while paused and restores it on resume", async () => {
    await sim.pause(id, NOW);
    await expect(sim.authorize(id, 1n, category(ASSET), category(ACTION), category(DEST), NOW)).rejects.toThrow(/mandate paused/);
    const ledger = await sim.resume(id, NOW);
    expect(ledger.paused.member(id)).toBe(false);
    await sim.authorize(id, 1n, category(ASSET), category(ACTION), category(DEST), NOW);
  });

  it("does not disturb the spend state", async () => {
    await sim.authorize(id, 100n, category(ASSET), category(ACTION), category(DEST), NOW);
    const before = Buffer.from(sim.getLedger().spentCommitment.lookup(id)).toString("hex");
    await sim.pause(id, NOW);
    await sim.resume(id, NOW);
    expect(Buffer.from(sim.getLedger().spentCommitment.lookup(id)).toString("hex")).toBe(before);
    await sim.authorize(id, 100n, category(ASSET), category(ACTION), category(DEST), NOW);
  });

  it("rejects a non-principal", async () => {
    sim.seedMandate(id, { ...root.record, principalSecret: undefined });
    await expect(sim.pause(id, NOW)).rejects.toThrow(/principal secret/);
    sim.seedMandate(id, { ...root.record, principalSecret: randomBytes32(33) });
    await expect(sim.pause(id, NOW)).rejects.toThrow(/caller is not the principal/);
  });

  it("cannot pause twice or resume when not paused", async () => {
    await expect(sim.resume(id, NOW)).rejects.toThrow(/not paused/);
    await sim.pause(id, NOW);
    await expect(sim.pause(id, NOW)).rejects.toThrow(/already paused/);
  });

  it("cannot pause an unknown or revoked mandate; revoke still works while paused", async () => {
    await expect(sim.pause(randomBytes32(1), NOW)).rejects.toThrow(/unknown mandate/);
    await sim.pause(id, NOW);
    const ledger = await sim.revoke(id, NOW);
    expect(ledger.revoked.member(id)).toBe(true);
    await expect(sim.resume(id, NOW)).rejects.toThrow(/mandate revoked/);
  });
});

describe("attestSpend (selective disclosure)", () => {
  let sim: WardenSimulator;
  let id: Uint8Array;
  let root: ReturnType<typeof buildMandate>;

  beforeEach(async () => {
    ({ sim, root } = await rootWithSim());
    id = root.id;
    await sim.authorize(id, 250n, category(ASSET), category(ACTION), category(DEST), NOW);
  });

  it("publishes the ceiling and the action count — never the spend", async () => {
    const ledger = await sim.attestSpend(id, 500n, NOW);
    expect(ledger.attestedCeiling.lookup(id)).toBe(500n);
    expect(ledger.attestedAtCount.lookup(id)).toBe(1n);
    expect(ledger.attestedCeiling.lookup(id)).not.toBe(250n);
  });

  it("accepts a tight ceiling exactly at the real spend", async () => {
    const ledger = await sim.attestSpend(id, 250n, NOW);
    expect(ledger.attestedCeiling.lookup(id)).toBe(250n);
  });

  it("refuses to attest a false ceiling", async () => {
    await expect(sim.attestSpend(id, 249n, NOW)).rejects.toThrow(/attestation false/);
  });

  it("is read-only: the spend commitment and counter do not move", async () => {
    const before = Buffer.from(sim.getLedger().spentCommitment.lookup(id)).toString("hex");
    await sim.attestSpend(id, 500n, NOW);
    expect(Buffer.from(sim.getLedger().spentCommitment.lookup(id)).toString("hex")).toBe(before);
    expect(sim.getLedger().actionCount.lookup(id).read()).toBe(1n);
  });

  it("pins freshness: a later action leaves the older attestation visibly stale", async () => {
    await sim.attestSpend(id, 300n, NOW);
    await sim.authorize(id, 100n, category(ASSET), category(ACTION), category(DEST), NOW);
    const ledger = sim.getLedger();
    expect(ledger.attestedAtCount.lookup(id)).toBe(1n);
    expect(ledger.actionCount.lookup(id).read()).toBe(2n);
  });

  it("can be re-issued with a new ceiling", async () => {
    await sim.attestSpend(id, 400n, NOW);
    const ledger = await sim.attestSpend(id, 260n, NOW);
    expect(ledger.attestedCeiling.lookup(id)).toBe(260n);
  });

  it("cannot be forged by understating spend history", async () => {
    const real = sim.getPrivateState().mandates[Buffer.from(id).toString("hex")]!;
    sim.seedMandate(id, { ...real, spentTotal: 0n });
    await expect(sim.attestSpend(id, 10n, NOW)).rejects.toThrow(/stale or forged spend state/);
  });

  it("requires the agent's secret", async () => {
    const real = sim.getPrivateState().mandates[Buffer.from(id).toString("hex")]!;
    sim.seedMandate(id, { ...real, agentSecret: undefined });
    await expect(sim.attestSpend(id, 500n, NOW)).rejects.toThrow(/agent secret/);
    sim.seedMandate(id, { ...real, agentSecret: randomBytes32(12) });
    await expect(sim.attestSpend(id, 500n, NOW)).rejects.toThrow(/not the authorized agent/);
  });

  it("rejects an unknown mandate", async () => {
    await expect(sim.attestSpend(randomBytes32(1), 1n, NOW)).rejects.toThrow(/unknown mandate/);
  });
});
