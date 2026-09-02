# Warden — Architecture

## 1. The security model in one line

**PRIVATE MANDATE → LOCAL WITNESS → ZK CIRCUIT → PUBLIC COMPLIANCE PROOF → ON-CHAIN ACTION.**

A principal's mandate terms never leave their machine as plaintext. An agent
proves, in zero knowledge, that it holds the mandate and that a specific
requested action satisfies every one of its clauses. The chain learns that a
valid proof was produced against a known public commitment — nothing else.

## 2. What is private, what is public

See `docs/PRIVACY.md` for the exhaustive, per-field classification this
section summarizes.

| | |
|---|---|
| **Private** (never leaves the principal's/agent's machine as plaintext) | `Policy` (cap, asset, action type, destination category, expiry, action-count limit, salt), principal/agent secret keys, the specific amount/asset/type/destination of any individual requested action, the cumulative spend total in plaintext |
| **Public** (on-chain ledger state) | The mandate id (a commitment — see §3), membership in `registered`/`revoked`, an opaque, re-randomized spend commitment per mandate, an action counter per mandate |
| **Derived** (computed, not stored) | `mandateId`, `spendCommitment` — both pure functions of private inputs, exposed so the SDK can compute them client-side |

## 3. Commitment-gated authorization

Warden generalizes the pattern used by Midnight's own `example-bboard`
contract (see `docs/IMPLEMENTATION-NOTES.md`): instead of authorizing by
*identity* ("this address may act"), it authorizes by *proof of knowledge of
a secret behind a public commitment* ("whoever can reproduce this hash may
act"). A mandate's public id is:

```
mandateId = H("warden:mandate:" ‖ principalPk ‖ agentPk ‖ H(policy ‖ salt))
```

`createMandate`, `authorize`, and `revoke` each independently recompute this
hash from witness-supplied private data and assert it equals the public id
the caller is acting against. This is the entire access-control mechanism —
there is no separate role registry, no signature scheme, no admin key.

## 4. Why the principal and the agent are cryptographically distinct

`MandateContext` carries **two** key-commitments, `principalPk` and
`agentPk`, each `= H("warden:pk:" ‖ secret)` for a secret only that party
holds:

- `createMandate` and `revoke` both assert
  `pkOf(principalSecret(id)) == ctx.principalPk`.
- `authorize` asserts `pkOf(agentSecret(id)) == ctx.agentPk`.

An agent that knows the full policy (it has to, in order to prove compliance)
still cannot revoke its own mandate — it does not hold `principalSecret`.
Conversely, the principal cannot be impersonated as the agent. This is what
makes attack #7 in `docs/THREAT-MODEL.md` ("use another agent's/role's
authorization") fail by construction rather than by convention.

## 5. Enforcement without disclosure: the spend commitment

Compact circuits are bounded and stateless per call — there is no way to
"loop over history" inside a circuit (see `docs/IMPLEMENTATION-NOTES.md`).
To let the *public* ledger enforce a cumulative cap across many independent
calls without ever publishing the cap, or even the plaintext running total,
`authorize` uses a re-randomized commitment chain:

```
spentCommitment[id] = H("warden:spent:" ‖ total ‖ nonce)
```

On every `authorize` call: the circuit reads the witness-claimed
`(priorTotal, priorNonce)`, checks it reproduces the on-chain
`spentCommitment[id]` (so a lying witness is caught, not trusted — see
`docs/THREAT-MODEL.md`), computes `newTotal = priorTotal + requestedAmount`,
asserts `newTotal <= policy.maxAmount`, draws a **fresh** nonce, and writes
`H(newTotal ‖ freshNonce)` back. Consecutive on-chain values are therefore
unlinkable to each other and reveal nothing about the total or the cap — an
observer sees only that *some* update occurred. See `docs/PRIVACY.md` for the
one caveat this does **not** cover.

## 6. Repository layout

```
packages/
  contracts/            Compact contract + witnesses + simulator-based tests
    src/warden.compact
    src/witnesses.ts
    src/managed/warden/  (compiler output — generated, not hand-edited)
    src/test/
  sdk/                   TypeScript SDK — the only supported way to talk to Warden
  agent-adapter/         Minimal framework-agnostic "call through Warden" middleware
  shared/                Types/encoding helpers shared by sdk + agent-adapter + web
apps/
  web/                   Judge-facing demo UI (Next.js)
docs/
  ARCHITECTURE.md        (this file)
  THREAT-MODEL.md
  PRIVACY.md
  DEMO.md
  IMPLEMENTATION-NOTES.md  Toolchain grounding, written before any code
```

## 7. What Wave 1 deliberately does not include, and why

- **Multi-contract delegation.** The Compact reference documents that a
  circuit which calls a witness currently cannot satisfy an external
  `contract` type — so a clean "mandate contract" / "sub-mandate contract"
  split across two deployed contracts isn't available today. Hierarchical
  delegation (Wave 2) is designed to live inside **one** contract, addressed
  by a `parentId` field, instead.
- **Off-chain action verification.** Warden proves an agent was *authorized*
  to perform an on-chain-verifiable action. It cannot and does not claim to
  verify that an off-chain effect (an API call, a real-world purchase)
  actually happened — that is an oracle problem outside any ZK system's
  guarantees. See `docs/THREAT-MODEL.md`.
- **Secure automated key handoff.** The MVP colocates principal and agent
  secrets in one demo session's private state for simplicity. Real handoff of
  `agentSecret` + `MandateContext` from principal to agent needs an encrypted
  channel (conceptually similar to a Zswap output's optional ciphertext) —
  named explicitly as a Wave 2 hardening item, not silently assumed solved.
  The handoff also has to carry the mandate's real initial `spentNonce` (the
  nonce `createMandate`'s own `freshNonce` witness call happened to draw),
  not a guessed/zero placeholder — this was caught as a genuine, reproducible
  `StaleStateError` in `packages/sdk`'s own end-to-end test the first time
  the two-client flow was actually run, not something worked out on paper in
  advance. See `packages/sdk/src/client.ts`, `MandateHandoff.spentNonce`.

## 8. Wave 2 / Wave 3 extension points

- **Wave 2:** nested mandates (`parentId`, sub-agent delegation within one
  contract), a read-only auditor-disclosure circuit, richer policy
  composition, encrypted principal→agent handoff.
- **Wave 3:** an open SDK/protocol other agent frameworks integrate against,
  cross-contract composition once the composability limitation above is
  resolved upstream, a privacy-preserving agent reputation/marketplace layer.
