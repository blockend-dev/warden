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
> [Current limitations](#12-current-limitations).

**Live demo:** [wardenweb-production.up.railway.app](https://wardenweb-production.up.railway.app/)
— no setup required; see [§9](#9-demo) for exactly what it is and isn't.

License: [Apache 2.0](LICENSE). Built on [Midnight](https://docs.midnight.network/)
and its [Compact](https://docs.midnight.network/compact) language
([`midnightntwrk`](https://github.com/midnightntwrk) on GitHub). This
repository's devnet topology and Compact idioms are adapted from the
official [`midnightntwrk/example-counter`](https://github.com/midnightntwrk/example-counter)
and `example-bboard` reference contracts, cited by exact provenance in
[`docs/IMPLEMENTATION-NOTES.md`](docs/IMPLEMENTATION-NOTES.md). Authoritative
technical spec: [`docs/WAVE-1-SPEC.md`](docs/WAVE-1-SPEC.md) — if anything
below and that document disagree, the spec, and the Compact source it was
derived from, wins.

## 1. What Warden is

A principal defines a private policy: a spending cap, permitted asset,
action type, destination category, expiry, and a limit on how many times it
can be used. It hands that mandate to an agent. Every time the agent wants
to act, it proves — in zero knowledge, against the real Midnight ledger —
that the requested action satisfies every clause of that policy, without
revealing what the policy actually says. The proof either exists or it
doesn't; there is no application layer in between to trust.

## 2. Why this matters

Autonomous agents are starting to hold and move value on someone else's
behalf. Today there are exactly two ways to constrain that: enforce a limit
in the agent's own application code — trustworthy only as long as that code
runs correctly and isn't compromised — or put a human in the loop for every
action, which deletes the autonomy the agent was for. Neither gives a third
party (the principal, an auditor, a counterparty) a way to *verify* the
agent stayed within bounds without either trusting whoever operates it, or
the principal publishing its private budget and strategy on a public ledger
for anyone to see. The mandate's terms — the cap, the permitted asset, the
approved destinations — are exactly the information a principal will never
agree to make public. But the *proof* that an action complied with those
terms has to be publicly checkable, or "verifiable" collapses back into
"trust the operator." Warden needs both at once: terms that stay private,
and a compliance proof that doesn't.

## 3. Why Midnight

This isn't a generic "put it on a blockchain" problem — it needs a
smart-contract environment where private state and public, verifiable
computation are both first-class, not private state bolted on one layer up
(off-chain, encrypted-at-rest) with public logic underneath. Compact's
compiler enforces a private-by-default type system: a value cannot reach
the public ledger, an exported circuit's return, or another contract
without an explicit `disclose()` — a language-level guarantee, not a
convention a developer has to remember to uphold. Combined with
commitment-gated authorization and re-randomized commitment chaining (both
described in [§5](#5-how-it-works)), that's what lets Warden's private/public
boundary be enforced by the compiler rather than by application discipline.

Midnight separates two kinds of ledger state. **Zswap** is the native
shielded-token ledger — nullifier-based, purpose-built for private value
transfer. **Contract state** is the second ledger: arbitrary, per-contract
public state (`Cell`, `Counter`, `Set`, `Map`, `MerkleTree`), read and
written only through that contract's own circuits. Warden lives entirely in
the second ledger — its ledger fields are contract state, not Zswap
outputs, because Warden is an authorization gate, not a payment rail (see
[§10](#10-non-guarantees)): it never needs to move a shielded token itself.
Its revocation mechanism is accordingly a `Set` insertion in contract state,
explicitly **not** a native Zswap nullifier, which is scoped to spending a
specific coin, not to invalidating an arbitrary application mandate.
Transaction fees still flow through the wallet/DUST layer on the Zswap
side, transparently to the contract — Warden's circuits never see or touch
it.

## 4. Wave 1: what's actually built

One Compact contract, three circuits, private policy enforcement,
on-chain identity binding for both principal and agent, permanent on-chain
revocation, expiry enforced against real ledger time (not a caller-supplied
value), private spend-cap and action-count enforcement via a re-randomized
commitment chain, a network-agnostic TypeScript SDK, a framework-agnostic
agent adapter, and a demo web app that exercises all of the above against
the real compiled circuits — plus a live, publicly reachable deployment of
that demo. All frozen and specified in
[`docs/WAVE-1-SPEC.md`](docs/WAVE-1-SPEC.md).

**Not** in Wave 1, and not implemented anywhere in this repository: nested
delegation, a secured principal→agent handoff channel, and submission to a
live Midnight network. See [§12](#12-current-limitations) and
[§13](#13-roadmap).

## 5. How it works

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
reopen exactly the race it exists to prevent — see
[`docs/WAVE-1-SPEC.md`](docs/WAVE-1-SPEC.md) §2 for the full argument.

Cumulative spend is enforced via a re-randomized commitment chain
(`spentCommitment = H(total ‖ nonce)`, re-committed with a fresh nonce every
call) so that even the running total and per-action amounts stay hidden from
chain observers. Action count, expiry, and revocation are enforced the same
way — a circuit-level `assert`, not a UI check.

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
   library's `blockTimeLte` — the ledger's own real block time, not a value
   the caller supplies.
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

## 6. Privacy model

| Category | What's in it | Notes |
|---|---|---|
| **Private** | Spend cap, asset, action type, destination category, action-count limit, salt, both parties' secrets, the running spend total | Never written to the ledger, never returned by any circuit. |
| **Public** | `expiry`, mandate `registered`/`revoked` status, the exact `actionCount` integer, the opaque `spentCommitment` hash | Directly readable by anyone. `expiry` is public because `blockTimeLte` requires its argument disclosed — a compiler-enforced fact, not a design preference. |
| **Derived** | `mandateId` (computed off-chain, submitted as a public argument, re-verified in-circuit against a private re-derivation); `spendCommitment` values (computed from private inputs, explicitly disclosed before being written) | |
| **Inferable** | *Cadence* — `actionCount` and `spentCommitment` both change on every successful `authorize`, so an observer learns exactly when and how often a mandate is used, even with amount, asset, type, and destination all hidden | Inherent to any on-chain commitment accumulator, not a defect specific to this implementation — named here rather than left for someone to discover. |

Full field-by-field version: [`docs/PRIVACY.md`](docs/PRIVACY.md). Warden
does **not** hide everything, and does not prove everything it enforces is
tied to a real-world fact — see [§10](#10-non-guarantees).

## 7. Midnight implementation

- **Contract:** [`packages/contracts/src/warden.compact`](packages/contracts/src/warden.compact) — one file, `pragma language_version >= 0.20`, `import CompactStandardLibrary`.
- **Ledger state (public):** `registered: Set<Bytes<32>>`, `revoked: Set<Bytes<32>>`, `spentCommitment: Map<Bytes<32>, Bytes<32>>`, `actionCount: Map<Bytes<32>, Counter>`.
- **Circuits:** `createMandate(id)`, `authorize(id, amount, asset, actionType, destinationCategory)`, `revoke(id)`, plus exported pure helpers `pkOf`, `mandateId`, `spendCommitment` the SDK reuses client-side rather than reimplementing.
- **Private state / witnesses:** [`packages/contracts/src/witnesses.ts`](packages/contracts/src/witnesses.ts) — `principalSecret`, `agentSecret`, `mandateContextOf`, `spentSoFar`, `spentNonce`, `freshNonce`. Every value a witness returns is untrusted by the circuit that calls it and is re-verified against a public commitment before anything depends on it — never assumed honest because it came from TypeScript rather than the proof.
- **Commitment model:** domain-separated `persistentHash` calls (`"warden:pk:"`, `"warden:policy:"`, `"warden:mandate:"`, `"warden:spent:"`) so no two commitment types can collide — see [`docs/WAVE-1-SPEC.md`](docs/WAVE-1-SPEC.md) §3 for each primitive's exact definition and the invariant it provides.
- **Enforcement invariants:** the nine-step `authorize` list in [§5](#5-how-it-works), normatively listed in [`docs/WAVE-1-SPEC.md`](docs/WAVE-1-SPEC.md) §4.

## 8. SDK + Agent Adapter

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

agent.importMandate(handoff);   // principal hands `handoff` to the agent out of band

await agent.authorize(handoff.id, { amount: 120n, asset: "DEMO", actionType: "payment", destinationCategory: "vendor:approved" });
// -> resolves on success; throws a typed WardenError (see packages/sdk/src/errors.ts) otherwise

await principal.revoke(handoff.id);
await agent.authorize(handoff.id, { amount: 1n, asset: "DEMO", actionType: "payment", destinationCategory: "vendor:approved" });
// -> throws MandateRevokedError
```

The SDK ([`packages/sdk`](packages/sdk)) is not a thin wrapper around the
demo — it's the actual interface to the protocol. `apps/web`'s API routes
call the same `WardenClient` shown above and nothing else; there is no
parallel, simplified path the frontend uses instead. It's network-agnostic
by design (`WardenBackend` is an interface — `LocalSimulatorNetwork` is the
only implementation that exists today, see [§12](#12-current-limitations))
and identity-portable (`identityFromSecret` rehydrates a previously-generated
identity, so a real agent process can persist its own key rather than
regenerate one per run). Its own test suite
([`packages/sdk/src/client.test.ts`](packages/sdk/src/client.test.ts))
drives this exact two-client flow against the real compiled contract.

[`packages/agent-adapter`](packages/agent-adapter) is the integration
surface for an actual agent framework, not the demo UI — a minimal,
framework-agnostic wrapper that gates an agent's own tool/effect functions
behind a real Warden authorization:

```ts
import { createWardenTool } from "@warden/agent-adapter";

const transferTool = createWardenTool({
  name: "transfer",
  description: "Move funds to an approved vendor",
  warden: agent,           // the same WardenClient from above
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

## 9. Demo

Try it live: **[wardenweb-production.up.railway.app](https://wardenweb-production.up.railway.app/)**.
It runs the real compiled circuits against `LocalSimulatorNetwork` — every
action is a real call into the real compiled `warden.compact` through
`@midnight-ntwrk/compact-runtime`'s in-process simulator, hosted as a single
persistent process (see [`docs/DEPLOY-RAILWAY.md`](docs/DEPLOY-RAILWAY.md)).
It is **not** a live network: no part of this repository submits a
transaction to Preview, Preprod, or Mainnet, and the UI's environment badge
says `LOCAL SIMULATOR` for exactly this reason — on the live deployment too.

- Shot-by-shot script for the current UI (for recording a walkthrough):
  [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md).
- A command-line procedure to verify the same claims yourself, against
  either the live deployment or a local run — no UI required:
  [`docs/DEMO.md`](docs/DEMO.md).

## 10. Non-guarantees

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

## 11. Run it, test it

Verified against the real, current toolchain (see
[`docs/IMPLEMENTATION-NOTES.md`](docs/IMPLEMENTATION-NOTES.md)) — Compact
compiler **0.34.0**, `@midnight-ntwrk/compact-runtime@0.19.0`, Node 24, on
Linux/macOS/WSL. No Docker required for any of the below.

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

To verify the whole repository, not just run it:

```bash
npm run typecheck --workspace apps/web   # tsc --noEmit
npm run build --workspace apps/web       # next build, all routes
```

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
- **The demo runs entirely against `LocalSimulatorNetwork`**, locally and on
  the live deployment alike — see [§9](#9-demo).
- **Live deployment is proven, on both a local devnet and the real public
  Midnight Preprod network** — full mandate lifecycle (deploy,
  `createMandate`, `authorize` within cap, `authorize` over cap correctly
  rejected, `revoke`, post-revoke `authorize` correctly rejected), real ZK
  proofs, real transactions. This requires compiling `warden.compact` with
  an older Compact compiler (0.31.1) against the stable `midnight-js@4.1.1`
  line rather than the current compiler (0.34.0) directly — the current
  compiler's async circuit API has no currently-*stable* `midnight-js`
  release that supports it yet. Both compiler versions accept the same,
  unmodified security-fixed contract source. Real contract address,
  mandate ID, transaction hashes, and block numbers from the Preprod run,
  plus the full root-cause history, are in
  [`docs/IMPLEMENTATION-NOTES.md`](docs/IMPLEMENTATION-NOTES.md). The Wave 1
  deliverable itself doesn't depend on any of this — `packages/contracts`
  runs on the current compiler throughout, exercised via the real
  `@midnight-ntwrk/compact-runtime` simulator, the same methodology
  Midnight's own official example contracts use for their unit tests.
- **Principal→agent handoff is not yet a secured channel.** The MVP
  colocates both roles' secrets in one demo session for simplicity; a real
  encrypted handoff is a named Wave 2 item.
- **Cross-contract hierarchical delegation is not yet possible** — a current
  Compact composability limitation, not a Warden design gap. See
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §7.

## 13. Roadmap

**Wave 2 — the natural next evolution, not yet built.** A full protocol
design for nested delegation (Principal → Agent → Sub-agent, where a child
mandate can never grant more authority than its parent has remaining) has
been written and adversarially reviewed:
[`docs/WAVE-2-DELEGATION-DESIGN.md`](docs/WAVE-2-DELEGATION-DESIGN.md). It is
a design document only — none of it is implemented in this repository. It
also outlines a read-only auditor-disclosure circuit, richer policy
composition, and an encrypted principal→agent handoff as further,
not-yet-designed extensions.

**Wave 3 — direction, not a plan.** An open SDK/protocol other agent
frameworks integrate against, cross-contract composition once upstream
Compact tooling supports it, and a privacy-preserving agent
reputation/marketplace layer.

## 14. Technical documentation

| Doc | What it covers |
|---|---|
| [`docs/WAVE-1-SPEC.md`](docs/WAVE-1-SPEC.md) | Authoritative frozen Wave 1 spec — invariants, cryptographic model, privacy boundary, validation baseline. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Full system design and the one-contract rationale. |
| [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) | Attack list, each mapped to a named test. |
| [`docs/PRIVACY.md`](docs/PRIVACY.md) | Field-by-field public/private/derived/inferable classification. |
| [`docs/DEMO.md`](docs/DEMO.md) | Command-line judge/developer verification procedure. |
| [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md) | Shot-by-shot narration script for a recorded demo. |
| [`docs/IMPLEMENTATION-NOTES.md`](docs/IMPLEMENTATION-NOTES.md) | Verified toolchain versions, real API shapes, the live-devnet investigation. |
| [`docs/DEPLOY-RAILWAY.md`](docs/DEPLOY-RAILWAY.md) | Deployment instructions for the live demo (`Dockerfile` at repo root). |
| [`docs/WAVE-2-DELEGATION-DESIGN.md`](docs/WAVE-2-DELEGATION-DESIGN.md) | Nested-delegation protocol design — not implemented. |
| [`docs/SUBMISSION-NARRATIVE.md`](docs/SUBMISSION-NARRATIVE.md) | Problem/product narrative for slides and pitch copy. |
| [`docs/SUBMISSION-CHECKLIST.md`](docs/SUBMISSION-CHECKLIST.md) | Buildathon hard-requirement checklist with evidence. |

## License

[Apache License 2.0](LICENSE).
