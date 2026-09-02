# Warden — Threat Model

Format per attack: **expected result → actual result → test**. "Actual
result" is filled in as `packages/contracts/src/test/warden.test.ts` is run
against the real compiled circuits — this file is not a description of
theoretical security, it names the exact test that proves each line.

## Standing assumptions

- **Witness output is untrusted.** Every value returned by a witness
  function (`principalSecret`, `agentSecret`, `mandateContextOf`,
  `spentSoFar`, `spentNonce`, `freshNonce`) is treated by every circuit as a
  claim, not a fact — each is independently re-verified against public
  commitments before it is relied on. Confirmed against the real compiler:
  `docs/IMPLEMENTATION-NOTES.md`.
- **Frontend and SDK state are never authoritative.** The UI's "AUTHORIZED /
  BLOCKED / REVOKED" labels reflect whether a circuit call actually
  succeeded or threw — they do not gate anything themselves. There is no
  server; there is nothing to trust *besides* the circuit.
- **Compact circuits are bounded.** No recursion, no unbounded loops, every
  type fixed-size at compile time. This shapes several of the entries below
  (e.g. why the action-count limit is a fixed `Uint<16>`, why cumulative
  spend uses a re-committed running total rather than a history scan).

## Attacks

1. **Forge a mandate (claim an id without knowing its policy).**
   Expected: rejected. Actual: `createMandate` recomputes
   `mandateId(mandateContextOf(id))` from witness data and asserts it equals
   the public `id` — a preimage the attacker doesn't have cannot be produced.
   Test: `createMandate rejects a context that does not hash to the claimed id`.

2. **Alter a mandate's policy after its commitment is public.**
   Expected: rejected. Actual: any changed field changes `policyHash` and
   therefore `mandateId`; the altered context no longer matches the
   already-registered `id`. Test: `authorize rejects a policy altered after
   registration`.

3. **Reuse authorization material across mandates.**
   Expected: rejected. Actual: every witness call and every ledger op is
   keyed by `id`; a secret/context valid for one mandate hashes to a
   different `id` than another mandate and simply will not match it. Test:
   `authorize with mandate A's secret against mandate B's id fails`.

4. **Bypass revocation.**
   Expected: rejected, permanently. Actual: `authorize` asserts
   `!revoked.member(pid)` before anything else; there is no circuit that
   removes an entry from `revoked` once inserted. Test: `authorize after
   revoke always fails, including on the very next call`.

5. **Exceed the spending limit.**
   Expected: rejected. Actual: `assert(newTotal <= ctx.policy.maxAmount, ...)`
   in `authorize`. Test: `authorize rejects amount that would exceed cap`,
   plus the exact-boundary case, `authorize accepts amount that lands
   exactly on cap, rejects the next unit`.

6. **Replay an authorization (resubmit the same call twice).**
   Expected: the second call sees updated state and is evaluated against it,
   not silently re-accepted. Actual: `spentCommitment`/`actionCount` advance
   on every successful call, so a second identical call is checked against
   the *new* totals, not the old ones — it either legitimately succeeds
   again (if still within cap/limit) or fails, but never double-counts as
   if it were the first call. Test: `two identical authorize calls consume
   the cap independently, not idempotently`.

7. **Use another agent's (or the principal's) authorization.**
   Expected: rejected. Actual: `authorize` asserts
   `pkOf(agentSecret(id)) == ctx.agentPk` — an attacker without the real
   agent's secret cannot produce a matching commitment; the principal's
   secret does not satisfy this check either (see `docs/ARCHITECTURE.md` §4).
   Test: `authorize called with the principal's secret instead of the
   agent's fails`, `authorize called with an unrelated agent's secret fails`.

8. **Exploit witness dishonesty (lie about prior spend).**
   Expected: rejected. Actual: `assert(spentCommitment.lookup(pid) ==
   spendCommitment(priorSpent, priorNonce), ...)` — a witness that returns
   any `(total, nonce)` pair other than the one actually behind the current
   on-chain commitment fails this check immediately. Test: `authorize
   rejects a witness that understates prior spend to free up headroom`.

9. **Exploit stale state (act against an old, superseded commitment).**
   Expected: rejected. Actual: same check as #8 — the on-chain
   `spentCommitment` is always the source of truth the witness claim is
   checked against, so acting on stale local state simply fails the
   equality assertion rather than silently succeeding against outdated
   totals. Test: `authorize using a stale local spend record after a
   concurrent successful authorize fails`.

10. **Leak private policy through errors.**
    Expected: assertion failure messages name *which policy clause* failed
    but never the private values on either side of the comparison. Actual:
    every `assert` in `warden.compact` uses a fixed string literal (e.g.
    `"policy violation: amount exceeds mandate cap"`), never string
    interpolation of a witness-derived value. Test:
    `rejection messages never contain the private policy's raw values`.

11. **Leak private policy through the frontend/SDK/API surface.**
    Expected: no code path serializes a `Policy` or a secret to anything
    that leaves the local process (network request, localStorage under a
    guessable key, URL, log line). Test suite: the "Privacy" section of
    `docs/../packages/contracts/src/test/warden.test.ts` plus an SDK-level
    test asserting `JSON.stringify` of every public-facing SDK return value
    never contains a tracked secret/policy byte sequence.

12. **Reuse cryptographic randomness (nonce reuse).**
    Expected: never — this is a design invariant, not something the circuit
    can catch (the circuit only sees hash outputs, not whether the preimage
    nonce was reused elsewhere). Actual mitigation: `freshNonce` is sourced
    from `globalThis.crypto.getRandomValues`, drawn fresh on every
    `authorize`/`createMandate` call, and the witness never returns a
    previously-issued nonce (see `packages/contracts/src/witnesses.ts`).
    Documented as a hard requirement rather than silently assumed: reusing a
    nonce across two commitments would let an observer link them, exactly
    the failure mode named in Midnight's own Compact security guidance
    (`docs/IMPLEMENTATION-NOTES.md`).

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
    this. Test: `revoke by a non-principal caller fails`,
    `createMandate cannot be front-run by a non-principal who observes the id`.

15. **Bypass policy by changing action parameters after proof generation.**
    Expected: structurally impossible, not merely rejected. Actual: the
    requested action's parameters are circuit *inputs* — they are bound into
    the proof itself. There is no "proof, then parameters" two-step to tamper
    between; a proof is a proof of the specific `(id, amount, asset,
    actionType, destinationCategory, currentTime)` tuple it was generated
    for, and changing any of them invalidates the proof rather than the
    action.

## Explicitly out of scope (see `docs/ARCHITECTURE.md` §7)

- Verifying that an authorized action's real-world or off-chain effect
  actually occurred (oracle problem).
- Securing the principal→agent handoff of `MandateContext` in transit
  (Wave 1 colocates both roles' secrets in one demo session; real
  cross-process handoff is a named Wave 2 item, not solved here).
- Multi-contract composition for delegation (current Compact composability
  limitation — see `docs/IMPLEMENTATION-NOTES.md`, item 2).
