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
| **Private** (never leaves the principal's/agent's machine as plaintext) | `Policy.maxAmount`/`.asset`/`.actionType`/`.destinationCategory`/`.actionCountLimit`/`.salt`, principal/agent secret keys, the specific amount/asset/type/destination of any individual requested action, the cumulative spend total in plaintext |
| **Public** (on-chain ledger state) | The mandate id (a commitment — see §3), `Policy.expiry` (see §5), membership in `registered`/`revoked`, an opaque, re-randomized spend commitment per mandate, an action counter per mandate |
| **Derived** (computed, not stored) | `mandateId`, `spendCommitment` — both pure functions of private inputs, exposed so the SDK can compute them client-side |

## 3. Commitment-gated authorization

Warden generalizes the pattern used by Midnight's own `example-bboard`
contract: instead of authorizing by
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
"loop over history" inside a circuit. To let the *public* ledger enforce a
cumulative cap across many independent
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

## 5b. Expiry: enforced against real time, not a claimed one

`authorize` originally took `currentTime` as a plain circuit argument and
asserted `currentTime <= expiry` — which an adversarial prover could satisfy
by simply not passing a real timestamp, since nothing tied the argument to
reality. This was found during a production audit; see
`docs/THREAT-MODEL.md`, "Block-time enforcement," for the full account. The
fix removes the argument entirely and uses the Compact standard library's
`blockTimeLte(x)`, which evaluates
against the ledger's own block time rather than a caller-supplied value:

```
assert(blockTimeLte(disclose(ctx.policy.expiry)), "mandate expired");
```

The one cost: `blockTimeLte`'s argument must be public (the compiler enforces
this — the check is resolved against real block time at inclusion, not
purely inside the proof), so `expiry` is disclosed on every `createMandate`
and `authorize` call. Every other policy field is unaffected. See
`docs/PRIVACY.md` for the full accounting.

## 5c. Why one contract

Warden's on-chain state — `registered`, `revoked`, `spentCommitment`,
`actionCount` — looks, at a glance, like four separable responsibilities
(a mandate registry, revocation state, spend-authorization state, and a
policy counter). It is deliberately one contract, for two independent
reasons, not convenience:

1. **They must be checked and mutated atomically.** `authorize` has to see
   a consistent snapshot of "is this registered, is it revoked, what's the
   current spend commitment, what's the current action count" and update the
   last two together, in one proof. Splitting these across contracts that
   advance independently opens exactly the kind of race the rest of this
   document works to close — e.g. a revocation landing in one contract while
   a spend-authorization proof built against the pre-revocation state is
   still in flight in another. Atomicity here is a security property, not an
   implementation convenience.
2. **It isn't cleanly achievable today regardless.** `authorize` and
   `createMandate` both call witnesses, and the Compact reference documents
   that a circuit which calls a witness cannot currently satisfy an external
   `contract` type — the mechanism a "spend-authorization contract" would
   need to be called, with its witness-dependent checks intact, from a
   separate "registry contract." A split attempted today would have to pass
   raw values across the contract boundary instead, which defeats the
   witness-privacy model this whole design rests on.

A future split would only be justified by a genuine independent-boundary
need — e.g. a Wave 2 auditor-disclosure contract that reads Warden's public
state without ever touching its witnesses. Nothing in Wave 1 has that need:
one mandate's registration, revocation, and spend state are one lifecycle,
not four protocols that happen to share a key.

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
  DEPLOYMENT.md          Live Preprod deployment evidence
  DEPLOY-RAILWAY.md       Deployment instructions
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
  nonce `createMandate`'s own `freshNonce` witness call drew) rather than a
  guessed or zero placeholder, or the agent's first `authorize` call fails
  with `StaleStateError`. See `packages/sdk/src/client.ts`,
  `MandateHandoff.spentNonce`.

## 8b. Known non-guarantees

Stated once, plainly, rather than left implied. Warden does **not** prove or
guarantee:

- That a real-world identity controls `principalPk`/`agentPk` — only that
  someone controls the secret bound to that commitment, whoever they are.
- That a requested action's off-chain effect actually happened — Warden
  authorizes; it does not execute or witness real-world effects (§7).
- That the principal and agent are distinct parties — nothing stops one
  entity from holding both secrets for one mandate, which is a legitimate
  self-authorization use case but forfeits the separation-of-duties property
  revocation is meant to provide against a *different* agent.
- That `requestedAmount` corresponds to a real value transfer of any kind —
  Warden is an authorization gate, not a payment rail (§7); a zero-amount
  action is valid and still consumes an action-count slot.
- Anything about actions taken before the mandate existed or after it was
  revoked/expired beyond "the circuit would not have produced a proof for
  them" — Warden cannot retroactively affect state a caller changed outside
  it.

See `docs/PRIVACY.md`, "What each circuit cryptographically proves," for the
precise positive claim each circuit makes.

## 8. Wave 2 / Wave 3 extension points

- **Wave 2:** nested mandates (`parentId`, sub-agent delegation within one
  contract), a read-only auditor-disclosure circuit, richer policy
  composition, encrypted principal→agent handoff.
- **Wave 3:** an open SDK/protocol other agent frameworks integrate against,
  cross-contract composition once the composability limitation above is
  resolved upstream, a privacy-preserving agent reputation/marketplace layer.
