# Warden — Wave 1 Protocol Specification

Authoritative baseline of what Wave 1 implements. Wave 2 work must extend this
without breaking any invariant stated here. Where this document and any other
doc disagree, the Compact source (`packages/contracts/src/warden.compact`) is
the ground truth — this spec was derived from it, not the reverse.

## 1. Protocol purpose

Warden lets a principal grant an agent a mandate — a policy limiting what
on-chain actions the agent may authorize (asset, action type, destination
category, cumulative spend, action count, expiry). The agent proves, in zero
knowledge, that a requested action satisfies the mandate, without revealing
the mandate's terms. The principal can revoke the mandate at any time;
revocation is enforced by the circuit itself, not by application discretion.

Warden authorizes on-chain-verifiable actions. It does not execute them, and
it does not attest to any off-chain or real-world effect.

## 2. Protocol architecture

```
Compact contract (warden.compact)
  ledger:   registered, revoked, spentCommitment, actionCount
  circuits: createMandate, authorize, revoke
        ↑ witnesses (untrusted TS callbacks)      ↑ ledger reads/writes
  packages/contracts/src/witnesses.ts  ← private state (MandateContext, secrets, spend history)
        ↑
  packages/sdk (WardenClient)  — mandate lifecycle, error classification, identity
        ↑
  packages/agent-adapter (guard, createWardenTool) — framework-agnostic wrapper
        ↑
  apps/web (API routes + frontend) — application layer, consumes the SDK
```

One contract, three circuits, four ledger fields. `registered`, `revoked`,
`spentCommitment`, and `actionCount` are four projections of a single
mandate's lifecycle, not independent entities: `authorize` must read and
mutate all four against one consistent snapshot in one proof. Splitting them
into separate contracts would require an atomic check-then-act across a
contract boundary that Compact's current composability model does not
provide (see §11), reintroducing exactly the race Wave 1 closes — e.g. a
`revoke` landing between a would-be second contract's "not revoked" read and
its own state write. One contract is the correct atomic boundary for Wave 1
and is not expected to change in Wave 2 without a specific, justified reason.

## 3. Cryptographic model

All hashing uses `persistentHash` with a literal domain-separation prefix
(`pad(32, "warden:<domain>:")`), so no two commitment types can collide.

| Primitive | Definition | Invariant it provides |
|---|---|---|
| `pkOf(secret)` | `hash("warden:pk:", secret)` | Public key commitment to a secret; a circuit checking `pkOf(x) == pk` proves knowledge of `x` without revealing it. |
| `policyHash(policy)` | `hash("warden:policy:", maxAmount, asset, actionType, destinationCategory, expiry, actionCountLimit, salt)` | Binds every policy field into one value; not exported (only `mandateId`, which uses it, needs to be). |
| `mandateId(ctx)` | `hash("warden:mandate:", principalPk, agentPk, policyHash(policy))` | The mandate's public address. Binds principal, agent, and the full policy together — changing any one field changes the id, so a stale or substituted `MandateContext` can never re-validate against an existing id. |
| `spendCommitment(total, nonce)` | `hash("warden:spent:", total, nonce)` | Opaque commitment to a running spend total. Hiding: the on-chain value reveals nothing about `total`. Binding: advancing it requires knowing the exact `(total, nonce)` pair behind the current on-chain hash — a witness cannot understate prior spend without producing a hash preimage. |

**Mandate context binding.** Every circuit re-derives `mandateId(ctx)` from
the witness-supplied `MandateContext` and asserts it equals the public `id`
argument before trusting anything else in `ctx`. This is the only mechanism
connecting private state to a specific public ledger entry, and it runs in
all three circuits.

**Principal authorization.** `createMandate` and `revoke` both assert
`pkOf(principalSecret(id)) == ctx.principalPk`. Only whoever holds the
secret behind the mandate's committed `principalPk` can create or revoke it.

**Agent authorization.** `authorize` asserts
`pkOf(agentSecret(id)) == ctx.agentPk`. Only whoever holds the secret behind
the mandate's committed `agentPk` can authorize an action under it.

**Nonce progression.** `spentSoFar`/`spentNonce` witnesses reconstruct the
caller's belief about the current committed state; `spentCommitment.lookup(id)
== spendCommitment(priorSpent, priorNonce)` verifies that belief against the
actual on-chain value before any new total is computed. `freshNonce` samples
a new random nonce for the *next* commitment, so consecutive on-chain values
are unlinkable to an observer without the nonce.

## 4. Authorization invariants

Every condition below is a circuit-level `assert` in `authorize`. All must
hold or no valid proof can be constructed — this list is the regression
checklist; `packages/contracts/src/test/warden.test.ts` exercises each one.

1. `registered.member(id)` — the mandate exists.
2. `!revoked.member(id)` — the mandate is not revoked.
3. `mandateId(ctx) == id` — the supplied context matches the public commitment.
4. `pkOf(agentSecret(id)) == ctx.agentPk` — the caller is the mandate's agent.
5. `blockTimeLte(ctx.policy.expiry)` — the mandate is not expired (real ledger time, see §6).
6. `requestedAsset == ctx.policy.asset`
7. `requestedActionType == ctx.policy.actionType`
8. `requestedDestinationCategory == ctx.policy.destinationCategory`
9. `actionCount[id] < ctx.policy.actionCountLimit` — action-count headroom remains.
10. `spentCommitment[id] == spendCommitment(spentSoFar, spentNonce)` — the caller's claimed prior spend state matches the committed one.
11. `spentSoFar + requestedAmount <= ctx.policy.maxAmount` — cumulative spend stays within the private cap.
12. On success: `spentCommitment[id]` is replaced with a new commitment over the advanced total and a fresh nonce, and `actionCount[id]` increments by 1 — both in the same state transition as the checks above.

`createMandate` additionally requires `!registered.member(id)`,
`ctx.policy.actionCountLimit > 0`, and `blockTimeLte(ctx.policy.expiry)` at
creation time (a mandate cannot be created already expired).

## 5. Revocation

- Only the principal can revoke: `revoke` asserts
  `pkOf(principalSecret(id)) == ctx.principalPk`, the same proof-of-secret
  mechanism used at creation. The agent's secret does not satisfy this check.
- Revocation is permanent by construction: there is no circuit that removes
  an entry from `revoked`, so once inserted it cannot be undone within this
  protocol version.
- Interaction with authorization: `authorize`'s `!revoked.member(id)` check
  runs before any policy or spend-state logic, so a revoked mandate is
  rejected unconditionally regardless of whether the requested action would
  otherwise have satisfied the policy.
- `revoke` also asserts `!revoked.member(id)` itself — revoking an
  already-revoked mandate fails rather than silently no-opping.

## 6. Expiry

Expiry is enforced with `blockTimeLte(disclose(ctx.policy.expiry))`, a
Compact standard-library primitive that compares the ledger's own real block
time against a **disclosed** value. `blockTimeLte` requires its argument to
be public — this is a compiler-enforced disclosure requirement, not a design
choice — so **`expiry` is the one `Policy` field that is public**, in both
`createMandate` and `authorize`. It is not, and cannot currently be made,
fully private while using this primitive. Every other `Policy` field stays
private for the mandate's entire lifetime.

## 7. Privacy model

| Category | Fields | Notes |
|---|---|---|
| **Private** | `maxAmount`, `asset`, `actionType`, `destinationCategory`, `actionCountLimit`, `salt`, `principalSecret`, `agentSecret`, `spentTotal`, spend nonces | Never written to the ledger. |
| **Public** | `expiry`, `registered`/`revoked` set membership, `actionCount` (the exact integer), `spentCommitment` (an opaque hash) | Directly readable by any observer. |
| **Derived** | `mandateId` (computed off-chain from private inputs, submitted as a public argument, re-verified in-circuit against a private re-derivation), `spendCommitment` values (computed from witness inputs, explicitly `disclose()`d before being written) | |
| **Inferable** | Authorization *cadence* | `actionCount` and `spentCommitment` both change on every successful `authorize`. An observer learns exactly when and how often a mandate is used, even though amount, asset, action type, and destination stay hidden. This is inherent to any on-chain commitment accumulator, not a defect in this implementation — no code path in Warden reveals more than timing and count. |

## 8. Guarantees

Warden's circuits prove:

- The caller holds a secret whose `pkOf` matches the committed
  `principalPk` (for `createMandate`/`revoke`) or `agentPk` (for
  `authorize`) of a specific, unmodifiable `MandateContext`.
- That context's full policy — asset, action type, destination category,
  spend cap, action-count limit, expiry — was fixed at mandate creation and
  cannot be altered afterward without changing `mandateId` (and therefore
  no longer matching the registered id).
- A requested action's asset, action type, and destination category exactly
  match the mandate's policy.
- Cumulative spend under the mandate never exceeds its private cap, and the
  action count never exceeds its private limit.
- The mandate has not been revoked and has not passed its (public) expiry,
  both checked against real ledger state, not caller-supplied input.
- A revoked mandate can never again authorize anything.

## 9. Non-guarantees

Warden's circuits do **not** prove:

- That a real-world identity controls `principalPk` or `agentPk` — only
  that someone controls the secret behind that commitment.
- That the principal and agent are distinct parties — one entity can hold
  both secrets for a mandate; nothing in the protocol prevents this, and
  doing so forfeits the separation-of-duties property revocation is meant
  to provide against a different agent.
- That a requested action's off-chain or real-world effect actually
  occurred — Warden authorizes; it does not execute or witness anything
  outside the ledger.
- That `requestedAmount` corresponds to a real transfer of value of any
  kind — Warden is an authorization gate, not a payment rail. A zero-amount
  action is valid and still consumes an action-count slot.
- Anything about actions taken before a mandate existed or after it was
  revoked/expired, beyond "the circuit would not have produced a proof for
  them."

## 10. Application boundary

`apps/web`'s API routes and frontend are a demonstration and consumption
layer, not a security boundary:

- Every accept/reject outcome traced from frontend → API → SDK resolves to
  a real `WardenClient` call into the compiled circuits above. There is no
  code path where an authorization or revocation decision is made in the
  API layer or the browser without a corresponding circuit-level check.
- UI states such as a disabled button, and API-layer checks such as "is
  there a local mandate record," are fail-fast conveniences only. Bypassing
  either (e.g. calling an API route directly) still routes into a real
  `authorize`/`revoke` call that the circuit itself accepts or rejects.
- Client-side storage (`localStorage`) holds only what the browser already
  typed in as principal, and a local activity log — never anything an
  authorization decision depends on.

## 11. Deployment status

- The real Compact compiler (0.34.0) compiles `warden.compact` to real
  circuits; all tests run those compiled circuits through the official
  TypeScript simulator pattern (`@midnight-ntwrk/compact-runtime`), with no
  proof server or network involved.
- A local devnet (node + indexer + proof server) exists under
  `infra/devnet/` and has been brought up and verified healthy
  independently, but the web application's `WardenBackend` is currently
  wired only to `LocalSimulatorNetwork` — not to that devnet or to any live
  network. No part of this codebase submits a transaction to Preview,
  Preprod, or mainnet.
- Live network deployment is blocked by a documented package/compiler
  version-compatibility issue between the current Midnight SDK packages and
  the installed toolchain (`docs/IMPLEMENTATION-NOTES.md`), not by anything
  in Warden's own contract or application code.

## 12. Wave 1 validation baseline

Confirmed against the current repository at the time this document was
written:

- `packages/contracts` tests: **36/36 passing**.
- `packages/sdk` tests: **9/9 passing**.
- `packages/agent-adapter` tests: **3/3 passing**.
- `apps/web` typecheck (`tsc --noEmit`): **clean**.
- `apps/web` production build (`next build`): **clean**, 7 routes.

Any Wave 2 change that regresses these numbers, or removes an invariant
listed in §4–§6, is a regression against this baseline.

## 13. Wave 1 scope boundary

Explicitly out of scope for Wave 1, and not implemented anywhere in this
repository:

- Nested delegation (principal → agent → sub-agent mandates).
- Selective auditor disclosure.
- Policy composition beyond the fixed field set in `Policy`.
- A real network-backed `WardenBackend` (devnet/testnet/mainnet).
- Cross-process principal→agent handoff of `MandateContext` in transit
  (Wave 1 colocates both roles' secrets in one demo session).
- Multi-contract composition for delegation.

None of the above should be added to `warden.compact`, the SDK, or the
application layer under the "Wave 1" label. They are Wave 2 candidates.
