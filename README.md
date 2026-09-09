# Warden

**Give AI agents real on-chain authority without giving them unrestricted power.**

Warden is a privacy-preserving authorization protocol for autonomous agents,
built on [Midnight](https://docs.midnight.network/). A principal grants an
agent a cryptographically enforceable, privately scoped mandate. The agent
can act on-chain only when an action satisfies that mandate. The mandate's
terms stay private. The principal can revoke it at any time, and revocation
is publicly verifiable — no future action can succeed against a revoked
mandate, by construction, not by convention.

> Warden verifies what an agent is authorized to do on-chain. It does not,
> and does not claim to, verify what an agent does off-chain — see
> "Current limitations" (§12) below.

License: [Apache 2.0](LICENSE). Authoritative technical spec:
[`docs/WAVE-1-SPEC.md`](docs/WAVE-1-SPEC.md) — if anything below and that
document disagree, the spec (and the Compact source it was derived from)
wins.

Built on [Midnight](https://docs.midnight.network/) and its
[Compact](https://docs.midnight.network/compact) language
([`midnightntwrk`](https://github.com/midnightntwrk) on GitHub). This
repository's devnet topology and Compact idioms were verified against —
and in places directly adapted from — the official
[`midnightntwrk/example-counter`](https://github.com/midnightntwrk/example-counter)
and `example-bboard` reference contracts; exact provenance for every
borrowed pattern is cited in [`docs/IMPLEMENTATION-NOTES.md`](docs/IMPLEMENTATION-NOTES.md)
rather than asserted here.

## 0. Getting started

Verified against the real, current toolchain (see
[`docs/IMPLEMENTATION-NOTES.md`](docs/IMPLEMENTATION-NOTES.md) for exactly
how) — Compact compiler **0.34.0**, `@midnight-ntwrk/compact-runtime@0.19.0`,
Node 24, on Linux/macOS/WSL (this project was built and tested inside WSL on
Windows, matching Midnight's own documented recommendation).

```bash
# 1. Install the Compact compiler (one-time, machine-wide):
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh

# 2. Install JS dependencies:
npm install

# 3. Compile the contract (generated output is gitignored — this step is required):
npm run compact

# 4. Run every package's test suite against the real compiled circuits:
npm test

# 5. Run the demo UI:
npm run build --workspace packages/contracts   # build @warden/contracts' dist/ once
npm run build --workspace packages/shared
npm run build --workspace packages/sdk
npm run dev --workspace apps/web
# → http://localhost:3000
```

**To verify the whole repository the way this audit did**, not just run it:

```bash
npm run typecheck --workspace apps/web   # tsc --noEmit
npm run build --workspace apps/web       # next build, all routes
```

No Docker is required for any of the above — see
[`docs/IMPLEMENTATION-NOTES.md`](docs/IMPLEMENTATION-NOTES.md) for exactly
what Docker *would* add (a live devnet + proof server) and why this
environment doesn't have it, and [§12](#12-current-limitations) below for
exactly what "no live network" means for this submission.

## 1. The problem

Give an autonomous agent a hot wallet, and its only real constraint is
"trust the code." Route every action through a human, and you've deleted the
autonomy you wanted. There is no way today for a third party — the
principal, an auditor, a counterparty — to *verify* an agent stayed within
its bounds without either the principal exposing its private budget and
strategy on a public ledger, or falling back to blind trust in whoever
operates the agent.

## 2. Why autonomous agents need constrained authority

2026's agentic economy assumes agents will hold and move value on a
principal's behalf. Every existing option is a false choice between
autonomy and verifiability. Warden is neither: a mandate is enforced
cryptographically, not administratively, and compliance is provable to
anyone without anyone but the mandate's own parties ever seeing its terms.

## 3. Why ordinary wallets fail

A wallet with a spending limit enforced in application code is only as
trustworthy as whoever runs that code — a compromised or malicious agent
runtime can simply not check the limit. A multisig requires a human in the
loop for every action, which is not autonomy. Neither gives a third party a
way to verify compliance without trusting an operator.

## 4. Why privacy is necessary

The mandate itself — the cap, the permitted asset, the destination category —
is exactly the information a principal will never put on a public ledger
(one field, the expiry, is a deliberate, narrow exception — see §7). But the
proof that an action complied with the mandate must still be publicly
checkable, or decentralized enforcement collapses back into "trust the
operator." Warden needs both at once: private terms, public proof.

## 5. Why Midnight

Compact's compiler enforces a private-by-default type system — a value
cannot reach the public ledger, an exported circuit's return, or another
contract without an explicit `disclose()` (verified empirically against the
real compiler; see [`docs/IMPLEMENTATION-NOTES.md`](docs/IMPLEMENTATION-NOTES.md)).
Combined with commitment-gated authorization and re-randomized commitment
chaining (both described below), that gives Warden a language-level
guarantee that its private state stays private, not a convention a developer
has to remember to uphold.

## 6. How Warden works

**PRIVATE MANDATE → LOCAL WITNESS → ZK CIRCUIT → PUBLIC COMPLIANCE PROOF → ON-CHAIN ACTION.**

A mandate's public identity is a commitment,
`mandateId = H(principalPk ‖ agentPk ‖ H(policy ‖ salt))`. `createMandate`,
`authorize`, and `revoke` — the whole contract, one Compact source file,
[`packages/contracts/src/warden.compact`](packages/contracts/src/warden.compact) —
each independently recompute this from witness-supplied private data and
assert it matches. That's the entire access-control model: no separate role
registry, no admin key. All three circuits, and every piece of mandate
state, live in **one contract** deliberately: `authorize` has to read and
mutate revocation status, spend commitment, and action count against one
consistent snapshot in one proof, and splitting that across contracts would
reopen exactly the race it exists to prevent (a `revoke` landing between one
contract's "not revoked" read and another's state write) — see
[`docs/WAVE-1-SPEC.md`](docs/WAVE-1-SPEC.md) §2 for the full argument.

Cumulative spend is enforced via a re-randomized commitment chain
(`spentCommitment = H(total ‖ nonce)`, re-committed with a fresh nonce every
call) so that even the running total and per-action amounts stay hidden from
chain observers. Action count, expiry, and revocation are enforced the same
way — a circuit-level `assert`, not a UI check.

### Midnight's dual-ledger model, and where Warden sits in it

Midnight separates two kinds of ledger state. **Zswap** is the native
shielded-token ledger — nullifier-based, purpose-built for private value
transfer, and not something a contract author touches directly. **Contract
state** is the second ledger: arbitrary, per-contract public state (`Cell`,
`Counter`, `Set`, `Map`, `MerkleTree`), read and written only through that
contract's own circuits. Warden lives entirely in the second ledger —
`registered`, `revoked`, `spentCommitment`, and `actionCount` are contract
state, not Zswap outputs. This is a deliberate boundary, not an oversight:
Warden is an authorization gate, not a payment rail (see
[§13](#13-non-guarantees)), so it never needs to move a shielded token
itself, and its revocation mechanism is a `Set` insertion in contract
state — explicitly **not** a native Zswap nullifier, which is scoped to
spending a specific coin, not to invalidating an arbitrary application
mandate (investigated and ruled out explicitly, not assumed — see
[`docs/PRIVACY.md`](docs/PRIVACY.md) and [`docs/IMPLEMENTATION-NOTES.md`](docs/IMPLEMENTATION-NOTES.md)).
Transaction fees still flow through the wallet/DUST layer on the Zswap side,
transparently to the contract — Warden's circuits never see or touch it.

### What the contract actually enforces

Every one of these is a real `assert` in `authorize`, checked in this order,
on every call — not a description, a list you can check against
[`packages/contracts/src/warden.compact`](packages/contracts/src/warden.compact)
line by line:

1. The mandate exists and has not been revoked.
2. The caller's private context hashes back to the mandate's public id
   (`mandateId(ctx) == id`) — a stale, substituted, or forged context is
   rejected before anything else is checked.
3. The caller holds the secret behind the mandate's committed *agent* public
   key (`pkOf(agentSecret) == agentPk`) — proof of control, not identity.
4. The mandate has not expired, checked against the Compact standard
   library's `blockTimeLte` — the ledger's own real block time, not a
   value the caller supplies (see [§11](#11-security-assumptions) — this is
   the exact spot a real vulnerability was found and fixed).
5. The requested asset, action type, and destination category match the
   private policy exactly.
6. The action count is still within the private per-mandate limit.
7. The claimed prior spend state matches the on-chain `spentCommitment`
   exactly — a witness cannot lie about history without a hash preimage it
   doesn't have.
8. The new cumulative total still fits the private spend cap.
9. Only then: the commitment advances and the action counter increments,
   atomically with everything above.

`revoke` is gated the same way on the *principal's* secret specifically, and
is permanent — there is no circuit that clears an entry from `revoked`.

## 7. Privacy model

| Category | What's in it | Notes |
|---|---|---|
| **Private** | Spend cap, asset, action type, destination category, action-count limit, salt, both parties' secrets, the running spend total | Never written to the ledger, never returned by any circuit. |
| **Public** | `expiry`, mandate `registered`/`revoked` status, the exact `actionCount` integer, the opaque `spentCommitment` hash | Directly readable by anyone. `expiry` is public because `blockTimeLte` requires its argument disclosed — a compiler-enforced fact, not a design preference. |
| **Derived** | `mandateId` (computed off-chain, submitted as a public argument, re-verified in-circuit against a private re-derivation); `spendCommitment` values (computed from private inputs, explicitly disclosed before being written) | |
| **Inferable** | *Cadence* — `actionCount` and `spentCommitment` both change on every successful `authorize`, so an observer learns exactly when and how often a mandate is used, even with amount, asset, type, and destination all hidden | Inherent to any on-chain commitment accumulator, not a defect specific to this implementation — named here rather than left for someone to discover. |

Full field-by-field version: [`docs/PRIVACY.md`](docs/PRIVACY.md). Warden
does **not** hide everything — see [§13](#13-non-guarantees) for the
complete list of what it explicitly does not prove.

## 8. Demo

See [`docs/DEMO.md`](docs/DEMO.md) for the full sub-60-second script: create
a private mandate, an authorized action succeeds, an over-cap action is
blocked by the circuit itself, revoke, and the same previously-valid action
now fails too. The demo UI (`apps/web`) runs this exact flow against real
compiled circuits through `LocalSimulatorNetwork` — see
[§12](#12-current-limitations) for precisely what that does and doesn't mean.

## 9. SDK

```ts
import { createWarden } from "@warden/sdk";

// Two genuinely separate clients — their own generated identity, their own
// local private state — sharing one ledger (defaults to a process-wide
// LocalSimulatorNetwork; see packages/sdk/src/network.ts).
const principal = createWarden({ role: "principal" });
const agent = createWarden({ role: "agent" });

const handoff = await principal.createMandate({
  agentPublicKey: agent.publicKey,           // the agent generated this locally and shared it out of band
  policy: {
    maxAmount: 500n,
    asset: "DEMO",
    actionType: "payment",
    destinationCategory: "vendor:approved",
    expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
    actionCountLimit: 5n,
  },
});

// principal hands `handoff` to the agent out of band (see docs/ARCHITECTURE.md §7)
agent.importMandate(handoff);

await agent.authorize(handoff.id, { amount: 120n, asset: "DEMO", actionType: "payment", destinationCategory: "vendor:approved" });
// -> resolves on success; throws a typed WardenError (see packages/sdk/src/errors.ts) otherwise

await principal.revoke(handoff.id);
await agent.authorize(handoff.id, { amount: 1n, asset: "DEMO", actionType: "payment", destinationCategory: "vendor:approved" });
// -> throws MandateRevokedError
```

The SDK is not a thin wrapper around the demo — it's the actual interface to
the protocol. `apps/web`'s API routes call the same `WardenClient` shown
above and nothing else; there is no parallel, simplified path the frontend
uses instead. It's network-agnostic by design (`WardenBackend` is an
interface — `LocalSimulatorNetwork` is the only implementation that exists
today, see [§12](#12-current-limitations)) and identity-portable
(`identityFromSecret` rehydrates a previously-generated identity, so a real
agent process can persist its own key rather than regenerate one per run).
See [`packages/sdk`](packages/sdk) and its test suite
([`packages/sdk/src/client.test.ts`](packages/sdk/src/client.test.ts)),
which drives this exact two-client flow against the real compiled contract.

## 10. Agent adapter

`packages/agent-adapter` is the integration surface for an actual agent
framework, not the demo UI — a minimal, framework-agnostic wrapper that
gates an agent's own tool/effect functions behind a real Warden
authorization:

```ts
import { createWardenTool } from "@warden/agent-adapter";

const transferTool = createWardenTool({
  name: "transfer",
  description: "Move funds to an approved vendor",
  warden: agent,           // the same WardenClient from §9
  mandateId: handoff.id,
  effect: async (action) => sendPayment(action),   // your framework's own tool implementation
});

// transferTool.run(action) calls warden.authorize(...) first; `sendPayment`
// only ever runs if the circuit accepted the request.
await transferTool.run({ amount: 120n, asset: "DEMO", actionType: "payment", destinationCategory: "vendor:approved" });
```

It imports nothing framework-specific (no LangChain, no particular agent
runtime) — `guard`/`createWardenTool` take a plain effect function, so
wiring Warden into any tool-calling agent framework is a matter of wrapping
that framework's own tool functions, not adopting a new one.

## 11. Testing

QA is treated as a first-class deliverable (15% of the buildathon rubric),
not an afterthought behind the frontend.

| Suite | File | Count |
|---|---|---|
| Contract | [`packages/contracts/src/test/warden.test.ts`](packages/contracts/src/test/warden.test.ts) | 36 tests |
| SDK | [`packages/sdk/src/client.test.ts`](packages/sdk/src/client.test.ts) | 9 tests |
| Agent adapter | [`packages/agent-adapter/src/index.test.ts`](packages/agent-adapter/src/index.test.ts) | 3 tests |

`warden.test.ts` runs real circuit calls through the Compact-runtime
simulator against the actual compiled `warden.compact` — no mocks —
covering mandate creation, valid and invalid authorization, wrong
principal/agent identity, forged/mismatched context, over-cap and
action-count-exhaustion attempts, expiry, revocation, authorization after
revocation, nonce/commitment progression, concurrent independent mandates,
and adversarial substitution/replay paths. Every attack has a named test —
see [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) for the full list mapped
to test names. Run all three with `npm test`.

## 12. Current limitations

- **On-chain-verifiable actions only.** Warden proves an agent was
  authorized; it cannot and does not verify that an off-chain effect (an API
  call, a real-world purchase) occurred. Oracle problems are out of scope.
- **The demo runs entirely against `LocalSimulatorNetwork`.** Every action
  in the browser demo is a real call into the real compiled circuit through
  `@midnight-ntwrk/compact-runtime`'s in-process simulator — no mocked
  results, no fabricated transaction hashes. It is **not** a live network:
  no part of this repository submits a transaction to Preview, Preprod, or
  Mainnet, and the UI's environment badge says `LOCAL SIMULATOR` for exactly
  this reason.
- **Live devnet deployment is blocked by real, current ecosystem version
  skew, not a Warden defect.** Docker Desktop + WSL2 integration was set up
  and the full local devnet (`infra/devnet/standalone.yml`) came up cleanly —
  a real genesis wallet synced and showed real funds
  (250,000,000,000,000 tNight, real DUST). Submitting an actual contract
  deployment fails because the current Compact compiler (0.34.0) requires
  `compact-runtime@0.19.0`, which no currently-*stable* `midnight-js` release
  supports (they're pinned to `0.15.0`/`0.16.0`); the only SDK line that does
  match (`5.0.0-beta.*`) depends on a different, unstable `ledger`/
  `onchain-runtime` generation not proven compatible with our devnet's images.
  Full root-cause, exact package versions, and what was actually tried:
  [`docs/IMPLEMENTATION-NOTES.md`](docs/IMPLEMENTATION-NOTES.md), "Live
  devnet: what actually worked, and the real blocker found". The Wave 1
  deliverable itself is unaffected — `packages/contracts` runs on the current
  compiler throughout, exercised via the real
  `@midnight-ntwrk/compact-runtime` simulator (the same methodology
  Midnight's own official example contracts use for their unit tests).
- **Principal→agent handoff is not yet a secured channel.** The MVP
  colocates both roles' secrets in one demo session for simplicity; a real
  encrypted handoff is a named Wave 2 item.
- **Cross-contract hierarchical delegation is not yet possible** — a current
  Compact composability limitation, not a Warden design gap. See
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §7 and the Wave 2 design
  below.

## 13. Non-guarantees

Stated plainly rather than left implied — Warden's circuits do **not**
prove:

- That a real-world identity controls a principal or agent key — only that
  someone controls the secret behind that commitment.
- That the principal and agent are distinct parties — one entity can hold
  both secrets for a mandate.
- That a requested action's off-chain or real-world effect actually
  occurred.
- That the requested amount corresponds to a real transfer of value —
  Warden is an authorization gate, not a payment rail.

Full list with reasoning: [`docs/WAVE-1-SPEC.md`](docs/WAVE-1-SPEC.md) §9.

## 14. Wave 1 scope

Implemented, tested, and frozen (see [`docs/WAVE-1-SPEC.md`](docs/WAVE-1-SPEC.md)):
one contract, three circuits (`createMandate`, `authorize`, `revoke`),
private policy enforcement, on-chain identity binding for both principal and
agent, permanent on-chain revocation, expiry enforced against real ledger
time, private spend-cap and action-count enforcement via a re-randomized
commitment chain, a network-agnostic TypeScript SDK, a framework-agnostic
agent adapter, and a demo UI that exercises all of the above against real
compiled circuits.

## 15. Wave 2

A full protocol design for nested delegation — Principal → Agent →
Sub-agent, where a child mandate can never grant more authority than its
parent has remaining — has been written and adversarially reviewed:
[`docs/WAVE-2-DELEGATION-DESIGN.md`](docs/WAVE-2-DELEGATION-DESIGN.md). It is
a design document only; none of it is implemented. It also covers a
read-only auditor-disclosure circuit and richer policy composition as
further, not-yet-designed extensions, and an encrypted principal→agent
handoff.

## 16. Wave 3

An open SDK/protocol other agent frameworks integrate against, cross-contract
composition once upstream tooling supports it, a privacy-preserving agent
reputation/marketplace layer.

## Documentation index

| Doc | What it covers |
|---|---|
| [`docs/WAVE-1-SPEC.md`](docs/WAVE-1-SPEC.md) | Authoritative frozen Wave 1 spec — invariants, cryptographic model, privacy boundary, validation baseline. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Full system design and the one-contract rationale. |
| [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) | Attack list, each mapped to a named test. |
| [`docs/PRIVACY.md`](docs/PRIVACY.md) | Field-by-field public/private/derived/inferable classification. |
| [`docs/DEMO.md`](docs/DEMO.md) | The sub-60-second demo script. |
| [`docs/IMPLEMENTATION-NOTES.md`](docs/IMPLEMENTATION-NOTES.md) | Verified toolchain versions, real API shapes, the live-devnet investigation. |
| [`docs/WAVE-2-DELEGATION-DESIGN.md`](docs/WAVE-2-DELEGATION-DESIGN.md) | Nested-delegation protocol design (not implemented). |
| [`docs/SUBMISSION-NARRATIVE.md`](docs/SUBMISSION-NARRATIVE.md) | The problem/product narrative for judges. |
| [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md) | Spoken walkthrough script for a recorded demo. |
| [`docs/SUBMISSION-CHECKLIST.md`](docs/SUBMISSION-CHECKLIST.md) | Buildathon hard-requirement checklist with evidence. |
| [`docs/DEPLOY-RAILWAY.md`](docs/DEPLOY-RAILWAY.md) | Verified guide to a live, publicly-reachable deployment (`Dockerfile` at repo root). |

## License

[Apache License 2.0](LICENSE).
