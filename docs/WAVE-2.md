# Warden — Wave 2

What changed since Wave 1, why, and how to check it. Wave 1
(`docs/WAVE-1-SPEC.md`) is unchanged and its invariants all still hold; Wave 2 is
additive.

## Summary

| | Wave 1 | Wave 2 |
|---|---|---|
| Circuits | `createMandate`, `authorize`, `revoke` | + `delegate`, `authorizeDelegated`, `revokeDelegated`, `pause`, `resume`, `attestSpend` (**9**) |
| Authority model | Principal → Agent | Principal → Agent → **Sub-agent** |
| Ledger fields | 4 | + `paused`, `delegatedFrom`, `attestedCeiling`, `attestedAtCount` (**8**) |
| Contract tests | 36 | **96** (+60, every attack named) |
| SDK tests | 9 | 24 (delegation flow + Attack Lab) |
| Browser e2e | – | **13** (Playwright, real UI → real circuits) |
| Frontend | dark, 3-D graph | white glassmorphism, anime.js, delegation graph, Attack Lab, public verifier, in-app deck |

## 1. Nested delegation

`Principal ─createMandate→ root ─delegate→ child ─authorizeDelegated→ action`

The root mandate's **agent** carves a child out of its own authority and hands it to a
**sub-agent**. A delegated mandate is a Wave 1 mandate plus one binding: its `parentId`.

### Invariants (all enforced in-circuit, in `delegate`)

1. **Only the parent's agent can delegate** — `pkOf(agentSecret(parent)) == parent.agentPk`,
   and the child's principal key must equal that same agent key.
2. **A child can never hold more than its parent has left.** `delegate` is an
   `authorize`-shaped call *on the parent*: it reads the parent's spend commitment,
   adds `child.maxAmount`, asserts the result is `<= parent.maxAmount`, and advances the
   parent's commitment. Delegation therefore **consumes parent budget immediately**, so
   siblings cannot each be checked against the parent's original cap and jointly exceed it
   (the classic double-allocation bug). Direct spend and delegation share one pool.
3. `child.expiry <= parent.expiry` — a child cannot outlive its parent.
4. `asset`, `actionType`, `destinationCategory` are inherited exactly (Policy fields are
   single values, so "narrower" degenerates to "equal" — a known limitation, see §6).
5. One hop only: `delegate` refuses a parent that is itself delegated
   (`delegatedFrom.member(parent)`), because Compact has no recursion and chain depth must
   be fixed at compile time.
6. The child context is bound to *this* parent (`childCtx.parentId == parentId`).
7. **Domain separation.** `delegatedMandateId` hashes under `warden:delegated:` while root
   ids use `warden:mandate:`, so a delegated id can never validate as a root id (and vice
   versa). Covered by the "type confusion" test and Lab scenario.

### Revocation semantics

*Expiry propagates for free* (baked into the child's committed policy at delegation).
*Revocation does not* — it is an event, not a creation-time value. So `authorizeDelegated`
**live-checks `revoked` and `paused` on the parent on every call.** Revoking the root kills
every sub-agent **without touching their own ledger flags**; the SDK's `status()` is
ancestor-aware and reports `blockedByParent` so no UI can wrongly show a dead child as live.

`revokeDelegated` is callable only by the child's principal (the delegating agent). The root
principal's power is over the root; the sub-agent cannot revoke itself.

### Privacy cost, stated plainly

`parentId` is public (the compiler requires the key of a ledger `member` check to be
disclosed). An observer can therefore reconstruct the delegation tree's **shape** — fan-out
and depth — but no policy, amount or identity. The alternative (keeping `parentId` private
and making cascade revocation an off-chain duty) downgrades a cryptographic guarantee to an
operational one without hiding the child's own revoked flag, so it was rejected.

A positive property: `delegate` and `authorize` write the parent's `spentCommitment` and
`actionCount` in the identical format, so an observer cannot tell whether a parent update was
direct spend or a delegation.

## 2. Pause / resume

`pause` / `resume` (principal-only) add a reversible kill-switch via the `paused` set.
`authorize` and `authorizeDelegated` refuse while paused, and `authorizeDelegated` also
refuses while the **parent** is paused — one flip freezes the whole subtree. Spend state is
untouched, so `resume` restores exactly what was there. `revoke` still works while paused
and is permanent; `resume` on a revoked mandate is refused.

## 3. Selective disclosure — `attestSpend`

The agent proves, against the on-chain spend commitment, that **cumulative spend ≤ ceiling**,
and publishes only the ceiling plus the action number it was true at
(`attestedCeiling`, `attestedAtCount`). The real total never leaves the prover. It is
read-only (the commitment is not advanced), a false ceiling has no valid proof, and the
attestation is pinned to the action count so a stale one is visibly stale. The committed
total includes budget reserved for sub-agents. This is the "read-only auditor disclosure"
promised in the Wave 1 roadmap. (Root mandates only in Wave 2.)

## 4. Attack Lab (`packages/sdk/src/lab.ts`, `/lab`)

19 scenarios — control cases and attacks — plus a seeded autonomous-agent swarm, all run
against the real compiled circuits on a private simulator. `npm run test --workspace
packages/sdk` asserts every scenario behaves exactly as the protocol promises and that each
refusal carries the circuit's own assert text.

## 5. Public verifier (`/verify`, `GET /api/verify/:id`)

Reads *only* public ledger state through an anonymous observer client — no session, no
secrets — and shows what a third party can and cannot learn, including the delegation tree.

## 6. Honest limits

- Delegation depth is **1**; grandchildren need a parallel struct/circuit family per level.
- Categorical fields are inherited exactly; allow-lists would change `policyHash`.
- Revoking a child **does not refund** its unused reservation to the parent (reclaim needs the
  child's private spend total — a Wave 3 item).
- `attestSpend` covers root mandates only.
- The principal → agent handoff is still not an encrypted channel.
- **The Wave 1 Preprod contract (`a61fb34…`) has only three circuits.** Wave 2's circuits
  are proven by the simulator suites (96 contract tests, 24 SDK tests, 13 browser tests) and
  compile with both Compact 0.34.0 and 0.31.1 (full proving-key generation for all nine
  circuits is part of the build), but a new Preprod deployment was **not** performed in this
  Wave. `apps/web`'s Preprod backend is updated to the generic `call` interface and the new
  witnesses; deploying the nine-circuit contract is the first Wave 3 task.
- The hosted demo runs on the simulator (badge: `DEMO · SIMULATOR`), never claiming otherwise.

## 7. Reproduce it

```bash
npm install --legacy-peer-deps
npm run compact:fast --workspace packages/contracts      # or `npm run compact` for full proving keys
npm test                                                  # 96 + 24 + 3 tests
npm run build --workspace packages/contracts && npm run build --workspace packages/shared \
  && npm run build --workspace packages/sdk
npm run build --workspace apps/web && PORT=3100 npm run start --workspace apps/web
BASE_URL=http://localhost:3100 npm run test:e2e --workspace apps/web   # 13 browser tests
```
