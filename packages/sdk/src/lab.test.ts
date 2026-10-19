import { describe, it, expect } from "vitest";
import { runAttackSuite, runSwarm, SCENARIO_COUNT } from "./lab.js";

describe("Attack Lab", () => {
  it("every scenario behaves exactly as the protocol promises", async () => {
    const results = await runAttackSuite();
    expect(results).toHaveLength(SCENARIO_COUNT);
    const wrong = results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.outcome} (${r.message})`);
    expect(wrong).toEqual([]);
  }, 120_000);

  it("refusals carry the circuit's own assert text", async () => {
    const results = await runAttackSuite(["over-cap", "cascade-revoke", "false-attestation", "type-confusion"]);
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(byId["over-cap"].message).toMatch(/exceeds mandate cap/);
    expect(byId["cascade-revoke"].message).toMatch(/parent mandate revoked/);
    expect(byId["false-attestation"].message).toMatch(/attestation false/);
    expect(byId["type-confusion"].message).toMatch(/does not match its public id/);
  }, 60_000);

  it("swarm: rogue steps are blocked, nothing past the revoke succeeds, and the seed is reproducible", async () => {
    const run = await runSwarm(7, 24);
    expect(run.events).toHaveLength(24);
    expect(run.summary.rogueAttempts).toBeGreaterThan(0);
    expect(run.summary.rogueBlocked).toBe(run.summary.rogueAttempts);

    const revokeIdx = run.events.findIndex((e) => e.action === "revoke");
    expect(revokeIdx).toBeGreaterThan(0);
    for (const e of run.events.slice(revokeIdx + 1)) expect(e.outcome).toBe("refused");

    const again = await runSwarm(7, 24);
    expect(again.events.map((e) => [e.actor, e.amount, e.outcome])).toEqual(run.events.map((e) => [e.actor, e.amount, e.outcome]));
  }, 120_000);
});
