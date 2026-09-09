# Warden — Submission Narrative

For slides, pitch copy, or a judge reading before the demo. Every claim
here is backed by [`docs/WAVE-1-SPEC.md`](WAVE-1-SPEC.md) and the actual
code — nothing below is aspirational.

## The problem

Autonomous agents are starting to hold and move value on someone else's
behalf. Today there are exactly two ways to constrain that: enforce a limit
in the agent's own application code (trustworthy only as long as that code
runs correctly and isn't compromised), or put a human in the loop for every
action (which deletes the autonomy the agent was for). Neither gives a
third party — the principal, an auditor, a counterparty — any way to
*verify* the agent stayed within bounds without either trusting whoever
operates it, or the principal publishing its private budget and strategy on
a public ledger for anyone to see.

## Why privacy is essential, not incidental

The mandate's terms — the spending cap, the permitted asset, the approved
destinations — are exactly the information a principal will never agree to
put on a public ledger. But the *proof* that an action complied with those
terms has to be publicly checkable, or "verifiable" collapses back into
"trust the operator" — the same failure mode as application-enforced
limits. Warden needs both at once: terms that stay private, and a
compliance proof that doesn't.

## Why Midnight specifically

This is not a generic "put it on a blockchain" problem. It requires a
smart-contract environment where private state and public, verifiable
computation are both first-class — not private state one layer up
(off-chain, encrypted-at-rest) with public logic bolted on. Compact's
compiler-enforced disclosure taint (a value cannot reach the ledger, a
circuit's public return, or another contract without an explicit
`disclose()`) means Warden's private/public boundary is a language-level
guarantee, not a convention a developer has to remember to uphold —
verified empirically against the real compiler, documented in
[`docs/IMPLEMENTATION-NOTES.md`](IMPLEMENTATION-NOTES.md).

## The product statement

> Warden gives autonomous agents bounded authority without requiring the
> principal to expose the full authorization policy publicly.

Concretely: a principal defines a private policy (spend cap, asset, action
type, destination, action count, expiry). An agent requests to act.
Midnight's circuits verify the request against that private policy and
either accept or reject — cryptographically, not by convention. The public
ledger sees only what enforcement requires: a commitment identifying the
mandate, its expiry, whether it's revoked, an opaque re-randomized spend
commitment, and an action count. It never sees the cap, the asset, the
destination, or the running total.

## Wave 1 story

**Private agent authorization primitive.** The principal defines a private
mandate. The agent requests authorization. Midnight verifies the request
against private policy state. The public ledger exposes only what
verification and lifecycle management require. Revocation is enforced
on-chain and is permanent. Spend limits and action limits are enforced
without ever publishing the policy behind them.

What Wave 1 deliberately does **not** include: nested delegation (an agent
sub-granting part of its own authority), a secured principal→agent handoff
channel, and live network deployment (blocked by a documented, current
package-version mismatch across the Midnight ecosystem, not a Warden
defect — see [`README.md`](../README.md) §12). Wave 2 has a complete,
adversarially-reviewed protocol design for the first of these
(`docs/WAVE-2-DELEGATION-DESIGN.md`) that is not implemented — a decision,
not an oversight: Wave 1 was frozen and audited before any Wave 2 line was
designed, on the belief that a smaller, provably-correct primitive beats a
larger, shakier one.

## Who actually uses this

Not "blockchain users." The realistic first adopters are the people who
already have to answer "how do I let an agent act without giving it
everything":

- **Agent platform builders** who need a real authorization primitive
  instead of an ad hoc allowlist in application code.
- **Wallets and protocols exposing agent-facing APIs**, who need a way to
  cryptographically bound what a connected agent can do, and prove it to
  their own users.
- **Organizations deploying internal agents with real budgets**, who need
  an audit story stronger than "we trust the code" without publishing
  internal spending policy.

This is a primitive, not a finished product with users or revenue today —
the honest adoption path is: ship the SDK and agent adapter as an
integration surface (already usable independently of the demo UI, see
`README.md` §9–§10), get it in front of one or two agent-framework
integrators, and let Wave 2's delegation model be the reason a platform
picks Warden over rolling its own allowlist.
