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
> [Current limitations](#current-limitations).

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
```

No Docker is required for any of the above — see
[`docs/IMPLEMENTATION-NOTES.md`](docs/IMPLEMENTATION-NOTES.md) for exactly
what Docker *would* add (a live devnet + proof server) and why this
environment doesn't have it.

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
(one field, the expiry, is a deliberate, narrow exception — see
[`docs/PRIVACY.md`](docs/PRIVACY.md)). But the proof that an action complied
with the mandate must still be publicly checkable, or decentralized
enforcement collapses back into "trust the operator." Warden needs both at
once: private terms, public proof.

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
`authorize`, and `revoke` each independently recompute this from
witness-supplied private data and assert it matches — the entire
access-control model, no separate role registry or admin key. Cumulative
spend is enforced via a re-randomized commitment chain
(`spentCommitment = H(total ‖ nonce)`, re-committed with a fresh nonce every
call) so that even the running total and per-action amounts stay hidden from
chain observers — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the
full design and [`docs/PRIVACY.md`](docs/PRIVACY.md) for the exhaustive
public/private classification of every field.

## 7. Architecture

```
packages/contracts/   Compact contract + witnesses + simulator-based tests
packages/sdk/         TypeScript SDK — the supported way to talk to Warden
packages/agent-adapter/ Minimal framework-agnostic "call through Warden" middleware
packages/shared/       Types/encoding helpers shared across the above
apps/web/              Judge-facing demo UI
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full breakdown,
including exactly what Wave 1 does and does not include and why.

## 8. Demo

See [`docs/DEMO.md`](docs/DEMO.md) for the full sub-60-second script: create
a private mandate, an authorized action succeeds, an over-cap action is
blocked by the circuit itself, revoke, and the same previously-valid action
now fails too.

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

See [`packages/sdk`](packages/sdk) — it is deliberately usable independently
of `apps/web`, and its own test suite
([`packages/sdk/src/client.test.ts`](packages/sdk/src/client.test.ts)) drives
this exact two-client flow against the real compiled contract.

## 10. Testing

QA is treated as a first-class deliverable (15% of the buildathon rubric).
`packages/contracts/src/test/warden.test.ts` runs real circuit calls through
the Compact-runtime simulator against the actual compiled `warden.compact` —
no mocks — covering policy boundaries, authorization/impersonation attempts,
revocation, and privacy-surface leakage. See
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) for the full attack list, each
tied to a named test.

## 11. Security assumptions

Witness output is untrusted by every circuit that consumes it; every
security-relevant claim a witness makes is re-verified against a public
commitment before anything depends on it. Full model:
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md), which also documents a
real vulnerability a production audit found and fixed — mandate expiry was
originally checked against a caller-supplied timestamp an agent could set to
anything, making it unenforceable. It now checks the ledger's real block
time via the Compact standard library's `blockTimeLte`.

## 12. Current limitations

- **On-chain-verifiable actions only.** Warden proves an agent was
  authorized; it cannot and does not verify that an off-chain effect (an API
  call, a real-world purchase) occurred. Oracle problems are out of scope.
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
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §7.

## 13. Wave 2

Nested mandates (sub-agent delegation within one contract via a `parentId`
field), a read-only auditor-disclosure circuit, richer policy composition,
encrypted principal→agent handoff.

## 14. Wave 3

An open SDK/protocol other agent frameworks integrate against, cross-contract
composition once upstream tooling supports it, a privacy-preserving agent
reputation/marketplace layer.
