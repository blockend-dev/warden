# Warden — Threat Model

Format per attack: **expected result → actual result → test**. Every test
named below is real, passes today, and runs against the actual compiled
`warden.compact` circuits — via `packages/contracts/src/test/warden.test.ts`
(circuit-level) or `packages/sdk/src/client.test.ts` (two-party, SDK-level).
This file is not a description of theoretical security; where something is
*not* yet tested, it says so rather than implying otherwise (see #11).

## Standing assumptions

- **Witness output is untrusted.** Every value returned by a witness
  function (`principalSecret`, `agentSecret`, `mandateContextOf`,
  `spentSoFar`, `spentNonce`, `freshNonce`) is treated by every circuit as a
  claim, not a fact — each is independently re-verified against public
  commitments before it is relied on. Stated explicitly in Midnight's own
  docs, not an inference Warden makes, and confirmed against the real
  compiler.
- **Frontend and SDK state are never authoritative.** The UI's "AUTHORIZED /
  BLOCKED / REVOKED" labels reflect whether a circuit call actually
  succeeded or threw — they do not gate anything themselves. There is no
  server; there is nothing to trust *besides* the circuit.
- **Compact circuits are bounded.** No recursion, no unbounded loops, every
  type fixed-size at compile time. This shapes several of the entries below
  (e.g. why the action-count limit is a fixed `Uint<16>`, why cumulative
  spend uses a re-committed running total rather than a history scan).

## Block-time enforcement: why expiry uses ledger time, not caller input

`authorize` does not take a `currentTime` argument from the caller. An
earlier version did, asserting `currentTime <= ctx.policy.expiry` — nothing
tied that argument to reality, so an agent could pass any value it liked and
expiry was unenforceable by construction; the check only ever validated a
relationship between two values the same party controlled. The current
implementation uses the Compact standard library's `blockTimeLte`, which is
evaluated against the ledger's own block time instead. Cost:
`blockTimeLte`'s argument must be public, so `Policy.expiry` is disclosed
(see `docs/PRIVACY.md`); every other field is unaffected. Tests:
`authorize — block-time expiry enforcement` (four tests, including exact
boundary in both directions) and `createMandate > rejects an expiry that has
already passed` / `> accepts an expiry exactly at the current block time`.

## Attacks

1. **Forge a mandate (claim an id without knowing its policy).**
   Expected: rejected. Actual: `createMandate` recomputes
   `mandateId(mandateContextOf(id))` from witness data and asserts it equals
   the public `id` — a preimage the attacker doesn't have cannot be produced.
   Test: `createMandate > rejects a context that does not hash to the
   claimed id (forged mandate)`.

2. **Alter a mandate's policy after its commitment is public.**
   Expected: rejected. Actual: any changed field changes `policyHash` and
   therefore `mandateId`; the altered context no longer matches the
   already-registered `id`. Test: `authorize — authorization and
   impersonation > fails once the policy is altered locally after
   registration`.

3. **Reuse authorization material across mandates.**
   Expected: rejected. Actual: every witness call and every ledger op is
   keyed by `id`; a secret/context valid for one mandate hashes to a
   different `id` than another mandate and simply will not match it. Test:
   `authorize — authorization and impersonation > fails when called with an
   unrelated agent's secret`.

4. **Bypass revocation.**
   Expected: rejected, permanently. Actual: `authorize` asserts
   `!revoked.member(pid)` before anything else; there is no circuit that
   removes an entry from `revoked` once inserted. Test: `revoke > blocks
   every future authorize call immediately and permanently`.

5. **Exceed the spending limit.**
   Expected: rejected. Actual: `assert(newTotal <= ctx.policy.maxAmount, ...)`
   in `authorize`. Tests: `authorize — policy boundaries > rejects a
   cumulative amount that would exceed the cap` and, for the exact boundary,
   `> authorizes an amount landing exactly on the cap, then rejects the next
   unit`.

6. **Replay an authorization (resubmit the same call twice).**
   Expected: the second call sees updated state and is evaluated against it,
   not silently re-accepted. Actual: `spentCommitment`/`actionCount` advance
   on every successful call, so a second identical call is checked against
   the *new* totals, not the old ones — it either legitimately succeeds
   again (if still within cap/limit) or fails, but never double-counts as
   if it were the first call. Test: `authorize — policy boundaries > two
   back-to-back valid calls consume the cap independently, not
   idempotently`.

7. **Use another agent's (or the principal's) authorization.**
   Expected: rejected. Actual: `authorize` asserts
   `pkOf(agentSecret(id)) == ctx.agentPk` — an attacker without the real
   agent's secret cannot produce a matching commitment; the principal's
   secret does not satisfy this check either (see `docs/ARCHITECTURE.md` §4).
   Tests: `authorize — authorization and impersonation > fails when the
   caller only holds the principal's secret, not the agent's` and `> fails
   when called with an unrelated agent's secret`.

8. **Exploit witness dishonesty (lie about prior spend).**
   Expected: rejected. Actual: `assert(spentCommitment.lookup(pid) ==
   spendCommitment(priorSpent, priorNonce), ...)` — a witness that returns
   any `(total, nonce)` pair other than the one actually behind the current
   on-chain commitment fails this check immediately. Test: `authorize —
   authorization and impersonation > fails when a witness understates prior
   spend to free up headroom`.

9. **Exploit stale state (act against an old, superseded commitment).**
   Expected: rejected. Actual: the same mechanism and the same test as #8 —
   "stale local state" and "a witness lying about prior spend" are the same
   failure mode from the circuit's point of view: whatever a witness claims
   as `(priorSpent, priorNonce)`, it must reproduce the *current* on-chain
   `spentCommitment` or the call fails. There is no separate code path for
   "stale" versus "dishonest" to test independently.

10. **Leak private policy through errors.**
    Expected: assertion failure messages name *which policy clause* failed
    but never the private values on either side of the comparison. Actual:
    every `assert` in `warden.compact` uses a fixed string literal (e.g.
    `"policy violation: amount exceeds mandate cap"`), never string
    interpolation of a witness-derived value. Test: `privacy — no leakage of
    private policy through observable state > rejection messages never
    contain the mandate's private cap value`.

11. **Leak private policy through the frontend/SDK/API surface.**
    Expected: no code path serializes a `Policy` or a secret to anything
    that leaves the local process (network request, localStorage under a
    guessable key, URL, log line). What is actually tested today: the
    "privacy" section of `packages/contracts/src/test/warden.test.ts`
    (rejection messages, ledger contents, commitment unlinkability) and
    `packages/sdk/src/client.test.ts`'s `never lets the agent's authorize
    call see or return the private policy` (asserts `authorize()` resolves
    `void` — there is no return value for a policy to leak through). A
    stronger, exhaustive sweep — serializing every public-facing SDK/API
    return value and asserting no tracked secret byte sequence appears in
    it — is a named Wave 2 QA item, not yet implemented; stated here rather
    than left implied.

12. **Reuse cryptographic randomness (nonce reuse).**
    Expected: never — this is a design invariant, not something the circuit
    can catch (the circuit only sees hash outputs, not whether the preimage
    nonce was reused elsewhere). Actual mitigation: `freshNonce` is sourced
    from `globalThis.crypto.getRandomValues`, drawn fresh on every
    `authorize`/`createMandate` call, and the witness never returns a
    previously-issued nonce (see `packages/contracts/src/witnesses.ts`).
    Documented as a hard requirement rather than silently assumed: reusing a
    nonce across two commitments would let an observer link them, exactly
    the failure mode named in Midnight's own Compact security guidance.

13. **Exploit missing domain separation.**
    Expected: hash outputs for structurally different purposes (a
    key-commitment vs. a policy hash vs. a mandate id vs. a spend
    commitment) never collide even given adversarially chosen inputs.
    Actual: every `persistentHash` call in `warden.compact` is prefixed with
    a distinct literal (`"warden:pk:"`, `"warden:policy:"`,
    `"warden:mandate:"`, `"warden:spent:"`) via `pad(32, ...)`, mirroring the
    exact idiom used in Midnight's own `example-bboard` contract.

14. **Create/revoke a mandate for the wrong principal.**
    Expected: rejected. Actual: `createMandate` and `revoke` both assert
    `pkOf(principalSecret(id)) == ctx.principalPk`; an attacker who knows
    only the public `id` (not the private context and secret) cannot pass
    this. Tests: `createMandate > cannot be created by someone who holds
    only the agent secret`, `revoke > cannot be called by a non-principal
    (agent-only) caller`, and, at the SDK level with a genuinely separate
    third-party identity rather than just a missing key,
    `WardenClient — two-party flow > refuses a third party's attempt to
    revoke someone else's mandate`.

15. **Bypass policy by changing action parameters after proof generation.**
    Expected: structurally impossible, not merely rejected. Actual: the
    requested action's parameters are circuit *inputs* — they are bound into
    the proof itself. There is no "proof, then parameters" two-step to tamper
    between; a proof is a proof of the specific `(id, amount, asset,
    actionType, destinationCategory)` tuple it was generated for (plus the
    ledger's own block time at verification — not a caller-supplied value,
    see above), and changing any of them invalidates the proof rather than
    the action.

16. **Forge or lie about the current time.** See "Block-time enforcement"
    above — this was a real, exploitable gap, not merely tested for.

17. **Concurrent/double execution: two proofs built from the same starting
    state.** Expected: only the one that lands first succeeds; the second is
    evaluated against the now-advanced on-chain state and fails, rather than
    both silently applying or the second double-spending. Actual: identical
    mechanism to #8/#9 — the second proof's witness-claimed `(priorSpent,
    priorNonce)` no longer reproduces the current `spentCommitment`. Test:
    `authorize — authorization and impersonation > a second authorize built
    from the same pre-state as an already-landed one fails, rather than
    double-spending`.

18. **Substitute one mandate's spend state for another's.** Expected:
    rejected — a mandate's spend commitment is meaningless outside its own
    `id`. Actual: `authorize` for mandate B checks B's witness-claimed
    `(priorSpent, priorNonce)` against B's own on-chain `spentCommitment`;
    supplying mandate A's real values fails the same way a fabricated one
    would. Test: `authorize — authorization and impersonation > fails when
    mandate B's authorize is attempted with mandate A's real spend state`.

## Explicitly out of scope (see `docs/ARCHITECTURE.md` §7)

- Verifying that an authorized action's real-world or off-chain effect
  actually occurred (oracle problem).
- Securing the principal→agent handoff of `MandateContext` in transit
  (Wave 1 colocates both roles' secrets in one demo session; real
  cross-process handoff is a named Wave 2 item, not solved here).
- Multi-contract composition for delegation (current Compact composability
  limitation, not a Warden design gap — see `docs/ARCHITECTURE.md` §5c).
