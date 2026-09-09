# Warden — Wave 2 Design: Nested Delegation

Design only. Nothing in this document is implemented. `warden.compact`, the
SDK, the frontend, and the test suite are unmodified — this is a proposal to
be reviewed before any of them change. All circuit sketches below are
illustrative pseudocode, not verified against the Compact compiler.

Builds on `docs/WAVE-1-SPEC.md`, treated as immutable. Every Wave 1 invariant
in that document must still hold after this design is implemented.

## 1. Problem

Wave 1 supports exactly one hop: Principal → Agent. The agent cannot grant
any part of its authority to another agent without handing over its own
secret (which would give the sub-agent the *entire* mandate, not a bounded
slice of it). Wave 2 needs Principal → Agent → Sub-agent, where the
sub-agent's authority is cryptographically bounded by what the agent itself
was granted — never more, and provably so, not by convention.

## 2. Delegation model

A **delegated mandate** is structurally the same thing as a Wave 1 mandate —
a policy commitment gating an `authorize`-shaped circuit — plus one new,
load-bearing fact: a binding to the specific parent mandate whose authority
it was carved out of. The delegating agent becomes the child's *principal*;
the sub-agent becomes the child's *agent*. This means Wave 1's structures
(`Policy`, its hashing, its witness pattern) are reused almost entirely
unchanged; delegation adds one new struct, one new id-hash, and three new
circuits alongside — not instead of — the Wave 1 three.

Scope of this design: **exactly one delegation hop** (root mandate → one
level of delegated mandates). Grandchildren are explicitly not built here —
see §11.

## 3. Core invariants

> A child mandate can never grant authority greater than the authority
> available to its parent mandate at the moment of delegation, and once a
> parent becomes unusable, every mandate delegated from it becomes unusable
> too.

Concretely, checked once, atomically, inside a single new `delegate` circuit
at child-creation time:

- `child.asset == parent.asset`, `child.actionType == parent.actionType`,
  `child.destinationCategory == parent.destinationCategory`. Wave 1's
  `Policy` fields are single values, not sets, so "narrowing" a categorical
  field degenerates to exact inheritance — a real, current limitation, not
  glossed over (see §11).
- `child.expiry <= parent.expiry` — the child cannot outlive the parent.
- `child.maxAmount <= parent's remaining (unreserved) budget` — see below.
- `child.actionCountLimit > 0`, checked the same as Wave 1; not bounded
  against the parent's own limit (a parent's action budget and a child's
  action budget are independent counters — see §4).

**Delegation itself consumes parent authority (critical question 6 —
answered yes).** Without this, sibling children could each be checked
against the parent's *original* cap independently and jointly exceed it
(Child A gets 800, Child B gets 800, parent's real cap was 1000 — the
classic double-allocation bug). `delegate` is modeled as an
`authorize`-shaped call *on the parent*: it reads the parent's current
`spentCommitment` exactly as Wave 1's `authorize` does, computes
`parentSpent + child.maxAmount`, asserts it's `<= parent.maxAmount`, and
advances the parent's commitment — reserving that budget immediately,
whether or not the child ever uses it. A parent's own direct `authorize`
calls and every delegation it grants share **one** spend-commitment pool per
mandate, so the two cannot be double-counted against each other. Same
mechanism, reused, not reinvented: this is Wave 1 invariant §4.10–§4.11
applied to "the action being authorized is granting a child a budget" rather
than "spending on an external effect."

This directly answers critical question 5 (how a child is prevented from
exceeding the parent's spend cap, action count, expiry, asset, action type,
destination category): every one of those is either an equality check
against the parent's committed policy, an inequality bound against it, or a
budget reservation against the parent's own accumulator — all inside one
circuit, one proof, checked against the parent's *live* on-chain state.

## 4. State model

**No change to Wave 1's ledger fields.** `registered`, `revoked`,
`spentCommitment`, `actionCount` are all generic `Bytes<32>`-keyed maps
already, with no assumption about what kind of mandate an id belongs to. A
delegated mandate is registered into the *same* `registered` set, gets its
*own* independent `spentCommitment` and `actionCount` entries, keyed by its
own id — exactly like a Wave 1 mandate. This is the answer to critical
question 9 ("what new state is required"): **one new struct, no new ledger
field.**

```
struct DelegatedMandateContext {
  parentId: Bytes<32>;   // NEW — the specific parent this mandate was carved from
  principalPk: Bytes<32>; // the delegating agent's own pk
  agentPk: Bytes<32>;     // the sub-agent's pk
  policy: Policy;         // unchanged Wave 1 struct, reused as-is
}
```

`Policy`, `policyHash`, `pkOf` are reused unmodified. A new domain-separated
hash is required so root and delegated mandates can never be confused for
one another:

```
delegatedMandateId(ctx) = hash("warden:delegated-mandate:", ctx.parentId, ctx.principalPk, ctx.agentPk, policyHash(ctx.policy))
```

The distinct prefix (`warden:delegated-mandate:` vs. Wave 1's
`warden:mandate:`) means a delegated context can never hash to a value that
also validates as a root `mandateId`, and vice versa — domain separation,
not a runtime type tag, is what prevents type confusion (critical question
10, "parent/child identity collisions" — see §9).

Wave 1's witnesses (`principalSecret`, `agentSecret`, `spentSoFar`,
`spentNonce`, `freshNonce`) are already generic over `id: Bytes<32>` and
need no change. One new witness is required:

```
witness delegatedMandateContextOf(id: Bytes<32>): DelegatedMandateContext;
```

## 5. Circuit model

Three new circuits, added alongside Wave 1's three, in the same contract
(justified in §10). All are illustrative pseudocode.

```
export circuit delegate(parentId: Bytes<32>, childId: Bytes<32>): [] {
  // --- parent: authenticate the caller as the parent's agent, check liveness ---
  const ppid = disclose(parentId);
  assert(registered.member(ppid), "unknown parent mandate");
  assert(!revoked.member(ppid), "parent mandate revoked");
  const parentCtx = mandateContextOf(ppid);
  assert(mandateId(parentCtx) == ppid, "parent context does not match its public id");
  assert(pkOf(agentSecret(ppid)) == parentCtx.agentPk, "caller is not the parent mandate's agent");
  assert(blockTimeLte(disclose(parentCtx.policy.expiry)), "parent mandate expired");

  // --- child: self-consistency, and an explicit bind to *this* parent ---
  const cid = disclose(childId);
  assert(!registered.member(cid), "mandate already exists");
  const childCtx = delegatedMandateContextOf(cid);
  assert(delegatedMandateId(childCtx) == cid, "child context does not match its public id");
  assert(childCtx.parentId == ppid, "child context bound to a different parent");
  assert(pkOf(principalSecret(cid)) == childCtx.principalPk, "caller does not hold the child's principal secret");
  assert(childCtx.policy.actionCountLimit > 0, "action count limit must be positive");
  assert(blockTimeLte(disclose(childCtx.policy.expiry)), "child expiry must be in the future");

  // --- narrowing: child policy must be a subset of parent policy ---
  assert(childCtx.policy.asset == parentCtx.policy.asset, "asset not inherited from parent");
  assert(childCtx.policy.actionType == parentCtx.policy.actionType, "action type not inherited from parent");
  assert(childCtx.policy.destinationCategory == parentCtx.policy.destinationCategory, "destination not inherited from parent");
  assert(childCtx.policy.expiry <= parentCtx.policy.expiry, "child cannot outlive parent");

  // --- reservation: child's cap must fit inside parent's remaining budget ---
  const parentPriorSpent = spentSoFar(ppid);
  const parentPriorNonce = spentNonce(ppid);
  assert(spentCommitment.lookup(ppid) == spendCommitment(parentPriorSpent, parentPriorNonce), "stale or forged parent spend state");
  const parentNewTotal = parentPriorSpent + childCtx.policy.maxAmount;
  assert(parentNewTotal <= parentCtx.policy.maxAmount, "delegated cap exceeds parent's remaining budget");
  const parentPriorCount = actionCount.lookup(ppid).read();
  assert(parentPriorCount < parentCtx.policy.actionCountLimit as Uint<64>, "parent action count limit reached");

  // --- commit: reserve parent budget + one parent action slot, register the child ---
  spentCommitment.insert(ppid, disclose(spendCommitment(parentNewTotal as Uint<64>, freshNonce(ppid))));
  actionCount.lookup(ppid).increment(1);

  registered.insert(cid);
  actionCount.insert(cid, default<Counter>);
  spentCommitment.insert(cid, disclose(spendCommitment(0, freshNonce(cid))));
}

export circuit authorizeDelegated(
  childId: Bytes<32>, requestedAmount: Uint<64>, requestedAsset: Bytes<32>,
  requestedActionType: Bytes<32>, requestedDestinationCategory: Bytes<32>
): [] {
  const cid = disclose(childId);
  assert(registered.member(cid), "unknown mandate");
  assert(!revoked.member(cid), "mandate revoked");

  const childCtx = delegatedMandateContextOf(cid);
  assert(delegatedMandateId(childCtx) == cid, "child context does not match its public id");
  assert(pkOf(agentSecret(cid)) == childCtx.agentPk, "caller is not the authorized sub-agent for this mandate");

  // the one check creation-time binding cannot provide — see §7
  assert(!revoked.member(disclose(childCtx.parentId)), "parent mandate revoked");

  assert(blockTimeLte(disclose(childCtx.policy.expiry)), "mandate expired");
  assert(requestedAsset == childCtx.policy.asset, "asset not permitted by mandate");
  assert(requestedActionType == childCtx.policy.actionType, "action type not permitted by mandate");
  assert(requestedDestinationCategory == childCtx.policy.destinationCategory, "destination not permitted by mandate");

  const priorCount = actionCount.lookup(cid).read();
  assert(priorCount < childCtx.policy.actionCountLimit as Uint<64>, "action count limit reached");
  const priorSpent = spentSoFar(cid);
  const priorNonce = spentNonce(cid);
  assert(spentCommitment.lookup(cid) == spendCommitment(priorSpent, priorNonce), "stale or forged spend state");
  const newTotal = priorSpent + requestedAmount;
  assert(newTotal <= childCtx.policy.maxAmount, "policy violation: amount exceeds mandate cap");

  spentCommitment.insert(cid, disclose(spendCommitment(newTotal as Uint<64>, freshNonce(cid))));
  actionCount.lookup(cid).increment(1);
}

export circuit revokeDelegated(childId: Bytes<32>): [] {
  const cid = disclose(childId);
  assert(registered.member(cid), "unknown mandate");
  assert(!revoked.member(cid), "mandate already revoked");
  const childCtx = delegatedMandateContextOf(cid);
  assert(delegatedMandateId(childCtx) == cid, "child context does not match its public id");
  assert(pkOf(principalSecret(cid)) == childCtx.principalPk, "caller is not the principal for this mandate");
  revoked.insert(cid);
}
```

Note the explicit `childCtx.parentId == ppid` bind in `delegate`. Without
it, an attacker could satisfy `delegatedMandateId(childCtx) == cid` using a
`childCtx.parentId` that matches the child's own hash, while the *circuit
argument* `parentId` — the one actually used for the agent-secret and
budget checks — points at a different, more generously-funded mandate the
attacker doesn't control the agent secret for anyway (so this specific
substitution is already blocked by the agent-secret check), or, more
subtly, at a mandate they *do* control, decoupling "whose budget is
consumed" from "who the child claims descent from" for later ancestor
checks. The explicit equality assert closes this regardless, and mirrors
Wave 1's own pattern of never trusting a witness-supplied field without an
explicit cross-check against the circuit's public arguments.

`authorize`, `createMandate`, and `revoke` (Wave 1) are unmodified.

## 6. Authorization flow

```
Principal ──createMandate──▶ root mandate (Wave 1)
                                   │
                    Agent ──delegate(rootId, childId)──▶ delegated mandate
                    (reserves budget + 1 action slot from root)
                                   │
              Sub-agent ──authorizeDelegated(childId, …)──▶ action
                    (checked: child's own state AND root's live revoked flag)
```

Revocation entry points: `revoke(rootId)` (Wave 1, root's principal only) and
`revokeDelegated(childId)` (child's principal — the delegating agent — only).
The root principal cannot directly call `revokeDelegated` on a child unless
it also happens to hold the agent's secret; its power is over the root.

## 7. Revocation semantics

This is the asymmetry worth stating precisely, since it's the crux of the
whole design:

**Expiry propagates for free.** `child.expiry <= parent.expiry` is enforced
once, at delegation time, and baked immutably into the child's hash-committed
policy. Since time only moves forward, `currentTime <= child.expiry` already
implies `currentTime <= parent.expiry`. `authorizeDelegated` never needs to
re-read the parent's expiry.

**Revocation does not propagate for free.** Revocation is an event, not a
value fixed at creation time — there is nothing to bake in at delegation
time about a revocation that hasn't happened yet. `authorizeDelegated`
therefore performs a *live* read of `revoked.member(parentId)` on every
call. This is the one mechanism in this design with no Wave 1 precedent, and
it has a direct privacy cost: making that check requires `disclose`-ing
`childCtx.parentId` (see §8).

**Worked example — Principal → Agent → Sub-agent:**

1. Parent (root) has `maxAmount = 1000`.
2. Agent delegates Child A with `maxAmount = 800`. Parent's
   `spentCommitment` now reflects 800 reserved; 200 remains for the parent's
   own direct spend or further delegation.
3. Child A authorizes two actions totaling 500 of its own 800.
4. Principal calls `revoke(rootId)`.
5. Child A's next `authorizeDelegated` call fails at
   `!revoked.member(parentId)` — permanently. Its unused 300 (800 − 500) is
   **not** returned to the parent's pool; it is stranded. Reservations are
   not refundable in this design (see §11).
6. Child A's own `revoked` ledger entry is never set. A `status()` query
   that only checks the child's own `revoked` flag would incorrectly report
   it as still active — the application layer (SDK) must also check
   ancestor revocation to report an accurate effective status. This is a
   concrete SDK requirement for Wave 2 implementation, not solved by the
   contract alone.

**Cross-branch isolation.** Revoking Child A sets only `revoked[childA]`.
Child B's checks are `!revoked[childB]` and `!revoked[parentId]` — never
`!revoked[childA]`. Siblings cannot affect each other except through the
shared parent budget pool, which is the intended shared resource, not an
interference channel.

## 8. Privacy model

| Category | Fields | Notes |
|---|---|---|
| **Private** | Child `Policy` fields except `expiry` (same rule as Wave 1); `principalSecret`/`agentSecret` for the child; `DelegatedMandateContext.principalPk`/`agentPk` | Same as Wave 1's equivalent fields. |
| **Public** | `DelegatedMandateContext.parentId`; child `expiry`; the child's `registered`/`revoked`/`spentCommitment`/`actionCount` entries | `parentId` is a **new** disclosure this design requires — see below. |
| **Derived** | `delegatedMandateId` | Computed off-chain, submitted as a public argument, re-verified in-circuit — same pattern as Wave 1's `mandateId`. |
| **Inferable** | Delegation topology | `parentId` being public means an observer can reconstruct which ids delegate from which, fan-out per parent, and chain depth — the tree *shape* — without seeing any policy content or amount. |

**Why `parentId` must be public (critical question 4/8).** Compact requires
the key used in a ledger `Set`/`Map` membership check to be disclosed — this
is the same compiler-enforced rule that made Wave 1's `expiry` public via
`blockTimeLte`. `authorizeDelegated`'s live check,
`revoked.member(childCtx.parentId)`, requires the same. An alternative that
keeps `parentId` fully private — pushing revocation-cascade to be an
off-chain bookkeeping responsibility of the principal (manually revoking
every known child instead of a single `revoke(rootId)` propagating
automatically) — was considered and rejected: it downgrades "revoking a
parent makes its children unusable" from a cryptographic guarantee to an
operational one, without buying meaningfully more privacy (each child's own
`revoked` flag is already public either way). The live on-chain check is the
sound default.

**A genuine positive property, not just a cost.** `delegate` and `authorize`
write to the parent's `spentCommitment`/`actionCount` in the identical
format. An observer watching the *parent's* own entries cannot tell whether
a given update was the parent directly spending, or the parent granting a
child a reservation — that distinction is only visible from the child's
side (via its `parentId`), never inferable from the parent's own state
alone.

## 9. Threat model

| Threat | Invariant that prevents it |
|---|---|
| Child authority escalation | `delegate`'s narrowing asserts (§3) are checked against the parent's *authenticated* context (`mandateId(parentCtx) == parentId`) at the only point the child's policy is ever fixed; `authorizeDelegated` re-derives `delegatedMandateId(childCtx) == cid` every call, so the committed policy can never be altered afterward. |
| Forged parent context | `mandateId(parentCtx) == parentId` plus `registered.member(parentId)` — the parent must be a real, previously-created mandate; an attacker cannot supply a fabricated context with favorable fields. |
| Forged parent authorization | `pkOf(agentSecret(parentId)) == parentCtx.agentPk` — only the real parent's agent secret satisfies this. |
| Stale parent state | `spentCommitment[parentId] == spendCommitment(parentSpentSoFar, parentSpentNonce)` — a witness cannot understate the parent's committed spend without a hash preimage it doesn't have. |
| Delegation replay | `!registered.member(childId)` blocks re-creating the same child; a replayed transaction's asserted pre-state (parent's old `spentCommitment`) no longer matches current ledger state once the first application lands — delegated to the base ledger's transaction-application model, per Wave 1 §3. |
| Double-spending parent allowance across siblings | Every `delegate` call serializes through the *same* parent `spentCommitment` hash-chain used for the parent's own direct spends — siblings cannot be independently checked against the parent's original cap. |
| Revocation bypass | `authorizeDelegated` discloses and checks `!revoked.member(parentId)` live, every call. |
| Expiry bypass | `child.expiry <= parent.expiry`, enforced once and immutable, transitively covers the parent — see §7. |
| Cross-branch interference | Every mandate (root or delegated) is keyed by its own id with its own `spentCommitment`/`actionCount`/`revoked` entry; no circuit reads a sibling's state. |
| Malicious intermediate agent | Bounded by "forged parent context/authorization" above — the agent can only delegate from a parent it can prove control of, within that parent's actual remaining budget. |
| Compromised child agent | Blast radius is capped at the child's own (already-narrower) policy — this is delegation's actual value, not just a risk to mitigate. The compromised child can be revoked surgically via `revokeDelegated` without touching the parent. |
| Parent/child identity collisions | Domain-separated hashing (`warden:mandate:` vs. `warden:delegated-mandate:`) makes a root id and a delegated id structurally unable to collide; in-circuit self-consistency checks (`mandateId`/`delegatedMandateId` re-derivation) catch any witness dishonesty about which struct an id belongs to. |
| Self-delegation (`childId == parentId`) | Prevented for free: `delegate` requires `registered.member(parentId)` *and* `!registered.member(childId)` — the same id cannot satisfy both simultaneously. |
| Deep delegation chains | Not supported by this design — see §11. Compact has no recursion or unbounded loops, so chain depth must be fixed at compile time; this design fixes it at 1. |

## 10. Architecture decision

**Same contract, new circuits. Not a new contract.**

- Critical question 1 (does Wave 1 need to change): **No.** `Policy`,
  `MandateContext`, `mandateId`, `createMandate`, `authorize`, `revoke` are
  untouched. This design is strictly additive.
- Critical question 2 (can the one-contract model support this safely):
  **Yes, and it must be one contract for the same reason Wave 1 is one
  contract.** `delegate`'s parent-side budget reservation needs to read and
  advance `spentCommitment[parentId]` atomically with the same guarantee
  `authorize` needs for its own spend check — if delegation lived in a
  separate contract, a sibling delegation and a parent's own `authorize`
  call could race across a contract boundary Compact cannot currently make
  atomic (the same composability limitation already on record in
  `docs/IMPLEMENTATION-NOTES.md`), reopening exactly the double-allocation
  bug §3 exists to close.
- Critical question 3 (circuit or separate contract): **New circuits in the
  existing contract** — `delegate`, `authorizeDelegated`, `revokeDelegated` —
  reusing the existing ledger fields and all five reusable Wave 1 witnesses.

## 11. Open questions

Deliberately deferred, not solved here:

1. **Grandchildren.** This design supports exactly one delegation hop. A
   depth-2+ generalization needs a bounded ancestor array
   (`Vector<D, Bytes<32>>`, `D` fixed at compile time) checked in full on
   every `authorizeDelegated` call, and — because Compact structs/circuits
   aren't generic over depth — realistically a parallel struct/circuit
   family per supported depth level, growing contract complexity linearly
   with `D`. This is a structural cost of Compact's bounded computation
   model, not a flaw specific to this design, but it means "how deep can
   delegation go" is a concrete, non-free capacity decision for whoever
   implements this, not a parameter to leave open-ended.
2. **Categorical narrowing.** `asset`/`actionType`/`destinationCategory` can
   only be inherited exactly, not restricted to a smaller allow-list, because
   `Policy` stores them as single values. A richer `Policy` shape (e.g. a
   small fixed-size allow-list or a Merkle-set membership proof per field)
   would enable genuine subsetting on these fields but changes `policyHash`
   and is a larger change than this increment should take on.
3. **Reservation reclaim.** Revoking a child does not return its unused
   allocation to the parent (§7, step 5). Reclaiming it would require
   `revokeDelegated` to also read the child's `spentSoFar` and credit
   `child.maxAmount - spentSoFar` back to the parent's available budget —
   possible with the same witness-verification pattern used elsewhere, but
   adds real complexity and is left for a later wave.
4. **Delegation vs. execution action-count budgets.** This design charges
   delegation against the same `actionCount` the parent's own executions
   use. Whether delegation should instead consume a separate, dedicated
   counter is an open product/design question, not a security one.
5. **SDK/status semantics.** An accurate `status()` for a delegated mandate
   must check ancestor revocation and expiry, not just its own ledger
   entries (§7). Not designed here; flagged as a concrete requirement for
   whoever implements the Wave 2 SDK surface.

## 12. Implementation plan

Not started. Recommended order once this design is approved:

1. Add `DelegatedMandateContext`, `delegatedMandateId`, and
   `delegatedMandateContextOf` to `warden.compact`/`witnesses.ts`, with
   contract tests for the struct/hash alone before any circuit uses them.
2. Implement `delegate`, with adversarial tests mirroring
   `warden.test.ts`'s existing style: over-budget delegation, expired/revoked
   parent, wrong agent, mismatched `parentId`, sibling double-allocation,
   replay against a stale parent commitment.
3. Implement `authorizeDelegated`, with tests for the live
   parent-revocation check specifically (revoke parent mid-chain, confirm
   child's next call fails; confirm child's *own* prior successful calls are
   unaffected).
4. Implement `revokeDelegated`.
5. Extend the SDK (`WardenClient` or a parallel delegated-mandate client) and
   `status()` to handle the two mandate kinds and ancestor-aware status —
   only after 1–4 are merged and tested in isolation.
6. Frontend/demo integration is out of scope until the above is complete and
   itself documented as a new baseline, the same way Wave 1 was.
