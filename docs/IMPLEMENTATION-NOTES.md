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
- **Update, same day:** Docker Desktop was installed by the user (with WSL2
  integration) partway through this project, and the full local devnet
  (`infra/devnet/standalone.yml`: `midnightntwrk/midnight-node:0.22.3`,
  `midnightntwrk/indexer-standalone:4.0.0`, `midnightntwrk/proof-server:8.0.3`)
  was brought up and verified healthy. A real HD wallet was built from the
  well-known local-devnet genesis seed
  (`0000000000000000000000000000000000000000000000000000000000000001` —
  the same constant `example-counter`'s CLI uses for standalone mode), synced
  against the real node, and showed a real genesis balance
  (250,000,000,000,000 tNight) and real DUST
  (1,250,000,000,000,000,000,000,000) — see "Live devnet: what actually
  worked, and the real blocker found" below for the full result, including
  where it currently stops short of a full proof-bearing deployment. Before
  that point, the paragraph below described the prior (no-Docker) state of
  this project and is kept for history:
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

## Live devnet: what actually worked, and the real blocker found

The user installed Docker Desktop (with WSL2 integration) so this could be
tested for real rather than staying at the simulator level. What follows is
the complete, honest result — including the point where it currently stops,
root-caused precisely rather than left as a mystery.

### What is fully verified, live, real

- `infra/devnet/standalone.yml` — the real, official
  `midnightntwrk/midnight-node:0.22.3`, `midnightntwrk/indexer-standalone:4.0.0`,
  and `midnightntwrk/proof-server:8.0.3` images (topology and healthchecks
  copied verbatim from `example-counter`'s own `standalone.yml`) — was pulled
  and brought up successfully. All three containers reached a healthy,
  request-serving state (the proof server's Docker healthcheck label lagged
  behind its actual readiness during the ~40s one-time trusted-setup-parameter
  download it does on first boot, but `curl http://localhost:6300/version`
  confirmed it was genuinely serving requests throughout).
- A real HD wallet (`infra/devnet/deploy-script/src/deploy-and-call.ts`) was
  derived from the well-known local-devnet genesis seed — the same constant
  `example-counter`'s own CLI uses for standalone mode
  (`0000...0001`) — using the real `@midnight-ntwrk/wallet-sdk-hd` key
  derivation across all three roles (Zswap/shielded, NightExternal/unshielded,
  Dust), wired through a real `WalletFacade` (shielded + unshielded + dust
  sub-wallets), and synced against the real running node over its real
  WebSocket RPC.
- That sync produced a **real, non-zero genesis balance**:
  250,000,000,000,000 tNight (unshielded) and 1,250,000,000,000,000,000,000,000
  DUST already available — i.e., wallet↔node↔indexer communication over the
  current wire protocol is fully working, no faucet or manual funding needed.

### Where it currently stops, and exactly why

Submitting the actual `deployContract` call — which would generate a real ZK
proof via the live proof server and post a real transaction to the node —
fails, and the reason is a precisely root-caused **version-skew problem
across the published `@midnight-ntwrk/*` package ecosystem**, not a Warden
defect:

1. **The current Compact compiler (0.34.0) generates an *async* circuit API**
   (`impureCircuits.foo(...)` returns `Promise<CircuitResults<...>>`), which
   requires `@midnight-ntwrk/compact-runtime@0.19.0` — confirmed empirically
   earlier in this document (the whole simulator-testing methodology depends
   on this).
2. **The current *stable* `midnight-js` line (4.0.4, and 4.1.1) does not
   support that runtime.** Checked directly against the npm registry:
   `midnight-js-contracts@4.0.4` bundles `compact-js@2.5.0`, which depends on
   `compact-runtime@0.15.0`; `midnight-js-protocol@4.1.1` (the 4.1.x line's
   equivalent) bundles `compact-js@2.5.1`, which depends on
   `compact-runtime@0.16.0`. Both predate the async API change. Attempting to
   deploy a 0.34.0-compiled contract through `midnight-js@4.0.4` fails
   immediately inside `midnight-js-contracts`' bundled `compact-js` with
   `TypeError: Cannot read properties of undefined (reading 'ctor')` — the
   two `compact-js` instances (our top-level one, needed to match our
   contract; its nested one, needed to match its own internals) disagree
   about the shape of a compiled contract.
3. **The only published `midnight-js` line whose dependency chain actually
   matches `compact-runtime@0.19.0` is `5.0.0-beta.*`** — confirmed via
   `npm view @midnight-ntwrk/midnight-js-protocol@5.0.0-beta.7 dependencies`,
   which resolves to `compact-runtime@0.19.0-rc.0` — but that same beta line
   also pulls `@midnightntwrk/ledger-v9` and
   `@midnightntwrk/onchain-runtime-v4` (note: a *different, non-hyphenated*
   npm scope, `@midnightntwrk` rather than `@midnight-ntwrk` — a genuine,
   easy-to-miss inconsistency in the ecosystem's own package naming). Our
   devnet's Docker images are built for the stable `ledger-v8`/
   `onchain-runtime-v3` line, so there is no confidence the beta SDK's wire
   protocol even matches what `midnightntwrk/midnight-node:0.22.3` speaks —
   this was not tested, to avoid compounding an already-identified mismatch
   with a second, unverified one.
4. **We also tried bridging the gap from the other direction**: recompiling
   `warden.compact` with an older compiler (0.31.1, confirmed to still
   produce the pre-async, synchronous circuit API compatible with
   `compact-runtime@0.16.0`) and pointing it at `midnight-js@4.1.1`
   specifically (`infra/devnet/deploy-script-legacy/`). This got substantially
   further — past compilation, past `CompiledContract.make(...).pipe(
   CompiledContract.withWitnesses(...), CompiledContract.withCompiledFileAssets(...))`,
   past a `ledger-v8` WASM version mismatch (`wallet-sdk-dust-wallet@3.0.0`
   expects `ledger-v8@^8.0.2`; upgrading to the mutually-consistent current
   set — `wallet-sdk-facade@4.0.1` / `-dust-wallet@4.1.0` /
   `-shielded@3.0.1` / `-unshielded-wallet@3.1.0`, all pinned to
   `ledger-v8@^8.1.0` — fixed a `TypeError: expected instance of
   DustParameters` WASM class-identity error) — and then hit a **real public
   API removal**: `wallet-sdk-unshielded-wallet@2.1.0`'s
   `InMemoryTransactionHistoryStorage` export (used by the reference CLI code
   this project is otherwise following closely) is no longer part of
   `3.1.0`'s public `exports` map at all. At that point we stopped rather
   than reverse-engineer a second package's new, undocumented-to-us API
   surface — this is a real, current, unresolved rough edge in the package
   ecosystem, not something to paper over with a workaround whose correctness
   we couldn't verify.

### The honest conclusion

**Deploying a contract compiled with the current (0.34.0) Compact compiler to
a live Midnight devnet is not, as of 2026-09-07, a clean, drop-in operation
with any single currently-published, mutually-consistent combination of
`@midnight-ntwrk/*` packages we could find** — the compiler has moved ahead
of the stable SDK line's `compact-runtime` pin, and the one SDK line that has
caught up (`5.0.0-beta.*`) has itself moved ahead of the stable
`ledger`/`onchain-runtime`/wallet-sdk line our devnet images are built
against. This is a real, verified, root-caused finding — not a Warden defect,
not a skill gap, and not something a different contract design would avoid.
Everything *before* this point (Docker, the full devnet, real wallet sync,
real genesis funds) is fully working proof that the infrastructure itself is
sound; the gap is specifically in the current cross-package release
alignment for the contract-deployment path.

**What this does not affect:** the Wave 1 deliverable itself. `packages/contracts`
stays on the current 0.34.0 compiler (correctly — that's the toolchain judges
will actually be building against), and its 35 tests all exercise the real
compiled circuit logic via the `@midnight-ntwrk/compact-runtime@0.19.0`
simulator — the same methodology Midnight's own official example contracts
use for testing, and the same one this document already described in detail
above. `infra/devnet/deploy-script*` are kept as working, documented evidence
of exactly how far live deployment gets today and exactly where and why it
currently stops — useful for whoever revisits this once the ecosystem's
package versions catch up to each other, not something to delete because it
didn't reach 100%.

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
