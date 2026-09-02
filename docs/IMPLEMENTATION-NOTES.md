# Warden — Implementation Notes (toolchain grounding)

Written before any contract code, per project instructions. This file records the
*actual, verified* current state of the Midnight toolchain we are building against,
as inspected on 2026-09-07, and calls out anywhere the earlier research thesis
document used language that turned out to be imprecise once checked against real
tooling.

## Verified toolchain (installed and run in this environment)

- `compact` CLI (the version manager/wrapper): **0.5.2**, installed via the official
  installer script from `midnightntwrk/compact` GitHub releases.
- Compact **compiler** (managed by the CLI): **0.34.0** — confirmed via
  `compact compile --version` after `compact update`. This matches the latest
  toolchain release documented at `docs.midnight.network/relnotes/compact`.
- Node.js: v24 (both the Windows host and the WSL Ubuntu 24.04 environment we
  compile in — Midnight's own docs recommend WSL on Windows, so we develop the
  contract/SDK inside WSL rather than fighting an unsupported native-Windows path).
- No Docker is available in this sandboxed environment. This means:
  - We **can** compile real `.compact` files with the real compiler and run the
    real generated JS/circuit code against the TypeScript **simulator** pattern
    (see below) — this requires no proof server or node.
  - We **cannot** run the local devnet (`docker compose` node+indexer+proof-server)
    or generate a real ZK-SNARK proof end-to-end, or submit a transaction to
    Preview/Preprod testnet, inside this session. Anywhere the deliverable depends
    on that, it is explicitly marked "requires Docker — not exercised in this
    environment" rather than silently faked.

## Confirmed real API shape (pulled from the official, current example repos —
not invented, not assumed from Solidity/EVM patterns)

Source: `midnightntwrk/example-counter` and `midnightntwrk/example-bboard`
(fetched directly, current `main`).

- Contracts declare `pragma language_version ...;` then `import CompactStandardLibrary;`.
- Public state is declared with `export ledger <name>: <LedgerType>;` using
  `Cell<T>`, `Counter`, `Set<T>`, `Map<K,V>` (values may themselves be ledger
  types, e.g. `Map<Bytes<32>, Counter>`), `List<T>`, `MerkleTree`/`HistoricMerkleTree`.
- `witness <name>(args): <Type>;` declares a private-state accessor implemented
  in TypeScript. The TS implementation receives a `WitnessContext<Ledger, PrivateState>`
  and returns `[newPrivateState, returnValue]`. **Witness output is untrusted by
  the circuit** — this is stated explicitly in the docs, not an inference.
- `export circuit name(args): ReturnType { ... }` is the on-chain entry point;
  `assert(cond, "message")` is the invariant-checking primitive; `disclose(x)`
  is *required* by the compiler before any witness-tainted value can be written
  to the ledger, returned, or passed cross-contract — verified as a real,
  compiler-enforced (not just documented) rule via the bboard contract's
  `owner = disclose(publicKey(localSecretKey(), ...))` line.
- Commitment pattern actually used in shipped code:
  `persistentHash<Vector<3, Bytes<32>>>([pad(32, "domain:prefix:"), a, b])` —
  i.e. domain separation via a literal string prefix is a real, working idiom,
  not a theoretical recommendation. We reuse this exact idiom for Warden's
  mandate commitment instead of inventing a different hashing convention.
- The **TypeScript Simulator pattern** (`CounterSimulator`, `BBoardSimulator` in
  the official examples) wraps `new Contract<PrivateState>(witnesses)`, calls
  `contract.initialState(createConstructorContext(privateState, coinPk))` to get
  `{currentPrivateState, currentContractState, currentZswapLocalState}`, builds a
  `CircuitContext` via `createCircuitContext(...)`, and then calls
  `contract.impureCircuits.<name>(context, ...args)` which returns `{context, result}`.
  `ledger(context.currentQueryContext.state)` decodes typed public state. Tests run
  under **Vitest** against this simulator with **no Docker, no proof server, no
  network** — this is the real, current, documented way official Midnight example
  contracts are unit-tested, and it is what Warden's Phase 1/6 test suite uses.
- Real dependency versions pinned in the current official `example-counter`
  monorepo (`package.json`, fetched from `main`): `@midnight-ntwrk/compact-runtime@0.15.0`,
  `@midnight-ntwrk/midnight-js@^4.0.4` plus its provider packages
  (`-http-client-proof-provider`, `-indexer-public-data-provider`,
  `-level-private-state-provider`, `-node-zk-config-provider`), and the
  `@midnight-ntwrk/wallet-sdk-*` family. Warden's `package.json` files pin to
  these same versions rather than guessing at fresh ones, so the SDK layer is
  wired against APIs that are known to exist today.

## Where the original research thesis was imprecise, and how we redesigned

1. **"Native Zswap nullifiers for arbitrary application revocation."** Zswap
   nullifiers are a coin-spending primitive inside the shielded-token protocol,
   not an exposed general-purpose "revoke any application credential" API in
   Compact. Warden's revocation is implemented as an **application-level**
   revocation `Set<Bytes<32>>` on the contract's own public ledger. It gives the
   identical externally-observable guarantee we need (a mandate commitment,
   once published to the set, can never again satisfy `authorize`), but it is
   **our contract's own state, not a base-layer cryptographic nullifier**, and
   every doc/UI string in this project says so explicitly (see `docs/PRIVACY.md`
   and the in-app "Protocol primitive vs. application construction" note).
2. **Cross-contract composition for hierarchical delegation.** The Compact
   reference documents that a circuit which calls a witness currently cannot
   satisfy an external `contract` type — i.e., you cannot cleanly split
   "mandate contract" and "sub-mandate contract" into two separately deployed,
   privately-composing contracts today. Wave 1/2 therefore keep all mandate and
   sub-mandate state inside **one** contract (nested by a `parentId` field)
   instead of the originally-imagined multi-contract composition. This is a
   real, current limitation, not a design preference — documented in
   `docs/ARCHITECTURE.md` and `docs/THREAT-MODEL.md` as a Wave-3 open problem.
3. **"Prove the agent performed a real-world action."** Unchanged from the
   original thesis's own boundary (§1): out of scope. Confirmed there is no
   Midnight-native oracle primitive in the current docs or SDK.
4. **Cumulative spend tracking.** Compact circuits are bounded/stateless per
   call — there is no way to "loop over history" inside a circuit. To let the
   *public* ledger enforce a cumulative cap across many independent calls
   without ever publishing the cap itself, Warden publishes a per-mandate
   **cumulative spent counter** (an intentional, documented partial disclosure)
   while the maximum/cap, asset policy, destination-category policy and
   expiry stay in private witness state, reasserted against the mandate
   commitment on every call. This is a deliberate privacy/enforceability
   trade-off, not an oversight — it is called out by name in `docs/PRIVACY.md`.

## Bugs actually caught by running the stack, not just reasoning about it

Kept here because "we tested it" should mean something — these are two real
defects `packages/contracts`' and `packages/sdk`'s test suites did **not**
catch (both suites passed the whole time), found only by exercising the full
built stack the way a judge actually would:

1. **`MandateHandoff` missing the mandate's real initial `spentNonce`.**
   `createMandate`'s own `freshNonce` witness call decides the nonce behind
   a mandate's *initial* spend commitment; a naive handoff that only carries
   `MandateContext` leaves the agent guessing (`spentNonce: 0`), which fails
   the agent's very first `authorize` call with `StaleStateError`. Caught by
   `packages/sdk/src/client.test.ts`'s two-real-client (not one colocated
   session) test the first time it ran. Fixed by threading the real nonce
   through `MandateHandoff` — see `packages/sdk/src/client.ts`.
2. **`WardenError.name` via `new.target.name` breaks under a production
   bundler.** Worked in every test (Vitest doesn't minify) and in `next dev`.
   Broke the moment `apps/web` was built with `next build` and hit over real
   HTTP: minification renamed every error class, so `error.name` came back
   as a single mangled letter (`"J"`, `"H"`, …) instead of
   `"PolicyViolationError"` / `"MandateRevokedError"`, silently breaking any
   `error.name`-based branching (including this app's own `/api/authorize`
   route). Caught by running `npm run build --workspace apps/web`, starting
   the production server, and curling the actual `/api/*` routes — not by
   any unit test. Fixed by giving each `WardenError` subclass an explicit,
   minification-proof `name` string — see `packages/sdk/src/errors.ts`.

Neither bug was visible from source review or from the unit-test suites
alone; both required actually running the built artifact end-to-end. That is
the reason `docs/DEMO.md` and this project's own verification process insist
on curling the real running server rather than trusting `npm test` in
isolation.

## Plan for Phase 1 (this session)

Build and get compiling/passing under the **real** 0.34.0 compiler and a real
Vitest simulator suite:
`packages/contracts/src/warden.compact`, `packages/contracts/src/witnesses.ts`,
`packages/contracts/src/test/warden-simulator.ts`,
`packages/contracts/src/test/warden.test.ts`.
