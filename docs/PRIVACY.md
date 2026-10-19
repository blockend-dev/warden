# Warden — Privacy Review

Every datum Warden touches, classified, with who can see it and why, in
table form rather than a diagram because a table is more auditable for a
list this exact — `docs/DEMO.md` has the one-diagram version.

Legend: **PUBLIC** = on the ledger, any observer sees it. **PRIVATE** = never
leaves the holder's machine as plaintext. **SELECTIVE** = disclosed only to a
specific party by an explicit, out-of-band step. **DERIVED** = computed, not
stored. **COMMITMENT** = a one-way hash standing in for a private value.
**REVOCATION MARKER** = Warden's own application-level revocation state
(explicitly **not** a native Zswap nullifier — Zswap nullifiers are a
coin-spending primitive, not an exposed general-purpose "revoke any
application credential" API in Compact; see `docs/ARCHITECTURE.md` §3).

| Datum | Class | Who can see it |
|---|---|---|
| `Policy.maxAmount` / `.asset` / `.actionType` / `.destinationCategory` / `.actionCountLimit` | PRIVATE | Whoever holds the `MandateContext`: the principal always, the agent because it must to prove compliance |
| `Policy.expiry` | PUBLIC | Any chain observer, disclosed on every `createMandate` and `authorize` call. Not a design preference: `blockTimeLte`, the standard-library primitive that checks it against the ledger's real block time, requires its argument to be public — the compiler rejects the alternative (see `docs/THREAT-MODEL.md`, "Block-time enforcement"). This is the one field the audit moved from PRIVATE to PUBLIC; every other field is unaffected |
| `principalSecret` / `agentSecret` | PRIVATE | Their respective holder only. Never appears in any circuit argument, ledger write, or SDK return value — only a `pkOf(...)` commitment to each ever reaches the contract |
| `mandateId` | PUBLIC / COMMITMENT | Any chain observer. Reveals nothing about the policy, principal, or agent behind it without already knowing the preimage |
| `registered` / `revoked` set membership | PUBLIC | Any chain observer. Reveals "a mandate with this id exists / was revoked", nothing about who or what it governs |
| `spentCommitment[id]` | PUBLIC / COMMITMENT | Any chain observer sees an opaque 32-byte value that changes on every `authorize` call. Without the witness-held `(total, nonce)` pair, it reveals nothing about the running total, the cap, or any individual action's amount |
| `actionCount[id]` | PUBLIC | Any chain observer. Reveals *how many* actions a mandate has authorized, not what any of them were |
| Per-action `requestedAmount` / `requestedAsset` / `requestedActionType` / `requestedDestinationCategory` | PRIVATE | Circuit arguments are private-by-default in Compact (verified empirically against the real compiler) and are used only inside `assert` comparisons, never written to the ledger. No chain observer, including the principal watching the chain rather than their own local records, learns any individual action's specifics from on-chain data alone |
| `MandateContext` (the full private bundle) | SELECTIVE | Handed by the principal to the agent out of band at creation time — the contract never transmits it. See `docs/ARCHITECTURE.md` §7 for the honest caveat on how that handoff is (not yet) secured in Wave 1 |

## The one deliberate leak, stated precisely

`spentCommitment` hides the running total and the cap, but **consecutive
values from the same session are only unlinkable to an outside observer, not
to whoever already knows one prior `(total, nonce)` pair** — because knowing
the prior total plus the new opaque commitment does not, on its own, reveal
the new total (that still requires brute-forcing `requestedAmount`, which
is infeasible over a 64-bit range). What *is* true, and worth stating
plainly: the **principal**, who by construction always holds the mandate's
private policy and can therefore verify the commitment chain, learns the
exact history of amounts the agent has spent under that mandate by
observing the chain and locally maintaining the same running total the
witness does. This is intentional, not a leak — the principal is meant to be
able to audit their own agent's spending. It is not visible to anyone else.

## Who sees what — by party

| Party | Sees |
|---|---|
| **Chain observers / validators** | `mandateId`, set membership, opaque `spentCommitment`, `actionCount`, `Policy.expiry` — and that a submitted proof verified or a transaction reverted. Nothing about the cap, asset, action type, destination category, identities, or individual action parameters |
| **The principal** | Everything about mandates they created: full policy, and (by locally tracking the same commitment chain the circuit checks) the exact spend history of their own agent |
| **The agent** | The `MandateContext` it was handed (policy + both key-commitments) and its own spend history for mandates it holds — never another agent's mandate, never the principal's secret |
| **A counterparty to an authorized action** | Nothing, from Warden itself — Warden is an authorization gate, not a payment or messaging channel (see `docs/ARCHITECTURE.md` §7). Any disclosure to a counterparty would happen in whatever system carries out the action, outside Warden's scope |
| **Warden's frontend (`apps/web`)** | Exactly what the connected session's private state holds locally (browser storage) plus whatever it reads from the public ledger — no more than any other agent/principal client |
| **Warden's SDK consumer** | Whatever role (principal/agent) it authenticates as locally; the SDK never phones home to a Warden-operated backend, because there isn't one — see `docs/ARCHITECTURE.md` |

## What each circuit cryptographically proves — stated precisely

Loose language ("proves the action is authorized") invites overclaiming.
Per circuit, what a verified proof actually establishes:

- **`createMandate`** proves: the prover knows a `MandateContext` whose hash
  equals the public `id`; the prover knows a secret whose `pkOf` equals that
  context's `principalPk`; the context's `actionCountLimit` is nonzero; and
  the ledger's block time was `<=` the context's (now-public) `expiry` at
  the moment the proof was checked. It does **not** prove the principal is
  any particular real-world identity — only that they control the secret
  behind `principalPk`, whatever that secret is bound to outside Warden.
- **`authorize`** proves: the prover knows the `MandateContext` behind `id`;
  the prover knows a secret whose `pkOf` equals that context's `agentPk`;
  block time is `<= expiry`; the requested asset/action type/destination
  category exactly equal the context's; the mandate's action count so far is
  below `actionCountLimit`; the prover's claimed prior spend `(total, nonce)`
  hashes to the value currently stored on-chain for `id`; and the new total
  (`prior + requestedAmount`) is `<= maxAmount`. It does **not** prove the
  requested action was actually carried out anywhere outside Warden, that
  `requestedAmount` reflects a real-world transfer, or that the agent is a
  distinct party from the principal (see "Known non-guarantees" below).
- **`revoke`** proves: the prover knows the `MandateContext` behind `id` and
  a secret whose `pkOf` equals `principalPk`. It does not prove *why* the
  mandate is being revoked, nor does it (or can it) undo actions already
  authorized before revocation.

In short: every circuit proves **knowledge of secrets bound to a specific
public commitment, checked against specific public and previously-committed
values** — never a real-world fact about identity, intent, or off-chain
effect. See "Known non-guarantees" in `docs/ARCHITECTURE.md` for the
consolidated list of what Warden explicitly does not claim.

## The judge test

> Could we replace Midnight with a normal database plus encryption and get
> essentially the same security property?

No — and precisely because of what this table shows: a database-plus-encryption
design gives a *trusted operator* the ability to verify "this action complies
with a hidden policy," which just relocates the trust problem to whoever
runs the database. Warden needs a **public, permissionless party with no
access to the policy** to be convinceable that a hidden policy was respected.
That is a zero-knowledge proof-of-compliance problem, not an
access-control problem, and it is the reason this system requires Midnight's
specific combination of compiler-enforced disclosure taint, ZK circuits, and
a public verifiable ledger rather than a database with row-level encryption.

## Wave 2 additions

| Datum | Class | Who can see it |
|---|---|---|
| `delegatedFrom[child] = parent` | PUBLIC | Any chain observer. Reveals the delegation tree's **shape** (fan-out, depth) — no policy, amount or identity. Public because Compact requires the key of a ledger `member` check to be disclosed, and the live parent-revocation check needs it |
| `paused` set membership | PUBLIC | Any chain observer: "this mandate is currently frozen" |
| `attestedCeiling[id]`, `attestedAtCount[id]` | PUBLIC (opt-in) | Any chain observer — the one spend-related number ever published, and only if the agent chooses to attest. The true total is never revealed; a false ceiling cannot be proven |
| Child `Policy` (cap, limits, salt), child principal/agent secrets | PRIVATE | Same rules as root mandates: the delegating agent and the sub-agent |
| Reserved budget for a child | PRIVATE | Folded into the parent's re-randomized `spentCommitment`; indistinguishable from a direct spend |

New proof statements:

- **`delegate`** proves: the prover is the parent's agent; the parent is live (registered, not revoked, not paused, not itself delegated, not expired); the child context hashes to the public child id and is bound to this parent; child expiry ≤ parent expiry; inherited policy fields equal the parent's; the parent's prior spend hashes to its on-chain commitment; and `prior + child cap ≤ parent cap`.
- **`authorizeDelegated`** proves everything `authorize` does for the child, plus that the parent is **currently** neither revoked nor paused.
- **`attestSpend`** proves: the prover is the agent and knows the `(total, nonce)` behind the on-chain commitment, with `total ≤ ceiling`.

Cascade revocation is visible to an observer as "parent revoked ⇒ every child edge dead" without any child's own flag changing.
