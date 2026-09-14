# Warden — Implementation Notes

Implementation constraints and ecosystem limitations that shaped Warden's
design, and the exact toolchain/API surface it's built against. This is
reference material for extending the code, not a narrative of how it was
built — for the protocol itself, see `docs/WAVE-1-SPEC.md`.

## Toolchain

- `compact` CLI (version manager/wrapper): **0.5.2**, installed via the
  official installer script from `midnightntwrk/compact` GitHub releases.
- Compact **compiler** (managed by the CLI): **0.34.0**, matching the latest
  toolchain release documented at `docs.midnight.network/relnotes/compact`.
- Node.js 24, on Linux/macOS/WSL — Midnight's own docs recommend WSL on
  Windows, so this project is developed and compiled there rather than
  against an unsupported native-Windows path.
- Compiling and running the test suites requires none of the below — only
  the CLI and Node. The full local devnet
  (`infra/devnet/standalone.yml`: `midnightntwrk/midnight-node:0.22.3`,
  `midnightntwrk/indexer-standalone:4.0.0`, `midnightntwrk/proof-server:8.0.3`)
  is optional, Docker-based, real-network validation tooling — see "Local
  devnet" below.

## Real API shape (from the official example repos)

Source: `midnightntwrk/example-counter` and `midnightntwrk/example-bboard`,
current `main`.

- Contracts declare `pragma language_version ...;` then `import CompactStandardLibrary;`.
- Public state is declared with `export ledger <name>: <LedgerType>;` using
  `Cell<T>`, `Counter`, `Set<T>`, `Map<K,V>` (values may themselves be ledger
  types, e.g. `Map<Bytes<32>, Counter>`), `List<T>`, `MerkleTree`/`HistoricMerkleTree`.
- `witness <name>(args): <Type>;` declares a private-state accessor
  implemented in TypeScript. The implementation receives a
  `WitnessContext<Ledger, PrivateState>` and returns `[newPrivateState,
  returnValue]`. **Witness output is untrusted by the circuit** — stated
  explicitly in Midnight's own docs, not an inference Warden makes.
- `export circuit name(args): ReturnType { ... }` is the on-chain entry
  point; `assert(cond, "message")` is the invariant-checking primitive;
  `disclose(x)` is required by the compiler before any witness-tainted value
  can be written to the ledger, returned, or passed cross-contract — a
  compiler-enforced rule, confirmed via the bboard contract's own
  `owner = disclose(publicKey(localSecretKey(), ...))` line, not just
  documented behavior.
- Commitment pattern used in shipped Midnight code:
  `persistentHash<Vector<3, Bytes<32>>>([pad(32, "domain:prefix:"), a, b])` —
  domain separation via a literal string prefix is a real, working idiom
  there, which Warden reuses for its own mandate commitment rather than
  inventing a different hashing convention.
- The **TypeScript simulator pattern** (`CounterSimulator`, `BBoardSimulator`
  in the official examples) wraps `new Contract<PrivateState>(witnesses)`,
  calls `contract.initialState(createConstructorContext(privateState, coinPk))`
  to get `{currentPrivateState, currentContractState, currentZswapLocalState}`,
  builds a `CircuitContext` via `createCircuitContext(...)`, and calls
  `contract.impureCircuits.<name>(context, ...args)`, which returns
  `{context, result}`. `ledger(context.currentQueryContext.state)` decodes
  typed public state. Tests run under Vitest against this simulator with no
  Docker, no proof server, no network — the same methodology Midnight's own
  example contracts use for unit tests, and what `packages/contracts`' and
  `packages/sdk`'s test suites both use.
- Dependency versions pinned in the current official `example-counter`
  monorepo: `@midnight-ntwrk/compact-runtime@0.15.0`,
  `@midnight-ntwrk/midnight-js@^4.0.4` plus its provider packages
  (`-http-client-proof-provider`, `-indexer-public-data-provider`,
  `-level-private-state-provider`, `-node-zk-config-provider`), and the
  `@midnight-ntwrk/wallet-sdk-*` family. Warden's own `package.json` files
  pin to matching versions rather than guessed ones.

## Design decisions shaped by real Compact/Midnight constraints

1. **Revocation is application-level state, not a native Zswap nullifier.**
   Zswap nullifiers are a coin-spending primitive inside the shielded-token
   protocol, not an exposed general-purpose "revoke any application
   credential" API in Compact. Warden's revocation is a `Set<Bytes<32>>` on
   the contract's own public ledger, giving the same externally-observable
   guarantee (a mandate commitment, once published to the set, can never
   again satisfy `authorize`) — but it is the contract's own state, not a
   base-layer cryptographic nullifier, and every doc/UI string in this
   project says so explicitly (see `docs/PRIVACY.md`).
2. **Nested delegation lives inside one contract, not two.** The Compact
   reference documents that a circuit which calls a witness currently cannot
   satisfy an external `contract` type — a clean "mandate contract" /
   "sub-mandate contract" split across two deployed contracts isn't
   available today. Wave 2's delegation design (`docs/WAVE-2-DELEGATION-DESIGN.md`)
   keeps all mandate and sub-mandate state inside **one** contract instead,
   addressed by a `parentId` field.
3. **Off-chain action verification is out of scope.** There is no
   Midnight-native oracle primitive in the current docs or SDK; Warden
   proves authorization, not real-world effect (see `docs/ARCHITECTURE.md` §7).
4. **Cumulative spend is a commitment chain, not a history scan.** Compact
   circuits are bounded and stateless per call — there is no way to "loop
   over history" inside a circuit. To let the public ledger enforce a
   cumulative cap across many independent calls without ever publishing the
   cap itself, Warden publishes a per-mandate re-randomized spend commitment
   while the cap, asset policy, destination-category policy, and (with one
   exception — see below) expiry stay in private witness state, reasserted
   against the mandate commitment on every call.

## Block-time enforcement

`authorize` and `createMandate` check expiry with `blockTimeLte`, a Compact
standard-library primitive comparing the **ledger's own current block
time** — not a caller-supplied one — against a given value:

- `blockTimeLte(x)` requires `x` to be disclosed: passing a witness-derived
  value directly fails to compile with a disclosure error (the compiler
  reports that the call "might disclose the upper bound of the time being
  checked"). `disclose(expiry)` resolves it. This is the mechanical reason
  `Policy.expiry` is public (see `docs/PRIVACY.md`) — not a design
  preference.
- `@midnight-ntwrk/compact-runtime`'s `createCircuitContext(...)` takes an
  optional 9th positional `time` argument (seconds); `blockTimeLte` reads it
  live at construction time — mutating an existing context's
  `callContext.time` afterward has no effect, only rebuilding via
  `createCircuitContext` with a new `time` does. This is why
  `WardenSimulator` builds a fresh `CircuitContext` per call, and why its
  `createMandate`/`authorize`/`revoke` all take an optional `atTime` for
  deterministic tests.
- Omitting `time` defaults to real wall-clock seconds
  (`Math.floor(Date.now()/1000)`), which is why `packages/sdk`'s
  `LocalSimulatorNetwork` needs no explicit time handling: it already gets
  real current time by default, in the simulator and in any real deployed
  network alike.

See `docs/THREAT-MODEL.md`, "Block-time enforcement," and
`docs/ARCHITECTURE.md` §5b for how this shapes `authorize`'s and
`createMandate`'s assertions.

## Known implementation gotchas

- **A mandate handoff must carry its real initial `spentNonce`.**
  `createMandate`'s own `freshNonce` witness call decides the nonce behind a
  mandate's *initial* spend commitment; a handoff that only carries
  `MandateContext` leaves the agent guessing (`spentNonce: 0`), which fails
  the agent's first `authorize` call with `StaleStateError`. See
  `packages/sdk/src/client.ts`, `MandateHandoff.spentNonce`.
- **`WardenError` subclasses need an explicit `name`.** `new.target.name`
  works under Vitest and `next dev`, but a production bundler's minification
  renames every error class, so `error.name` comes back mangled
  (`"J"`, `"H"`, …) instead of `"PolicyViolationError"` /
  `"MandateRevokedError"`, silently breaking any `error.name`-based
  branching. Each `WardenError` subclass sets an explicit,
  minification-proof `name` string instead — see `packages/sdk/src/errors.ts`.
  Verifying this required building `apps/web` for production and curling
  the actual `/api/*` routes, not just running the unit-test suites.

## Local devnet

A full local Midnight devnet (node + indexer + proof server) is available
under `infra/devnet/` for real-network validation, separate from the
simulator-based test suites:

- `infra/devnet/standalone.yml` brings up the real, official
  `midnightntwrk/midnight-node:0.22.3`, `midnightntwrk/indexer-standalone:4.0.0`,
  and `midnightntwrk/proof-server:8.0.3` images (topology and healthchecks
  copied from `example-counter`'s own `standalone.yml`) via `docker compose`.
  All three containers reach a healthy, request-serving state.
- `infra/devnet/deploy-script/src/deploy-and-call.ts` derives a real HD
  wallet from the well-known local-devnet genesis seed (the same constant
  `example-counter`'s own CLI uses for standalone mode, `0000...0001`) using
  `@midnight-ntwrk/wallet-sdk-hd`, wires a real `WalletFacade`, and syncs it
  against the running node over its real WebSocket RPC — producing a real,
  non-zero genesis balance (250,000,000,000,000 tNight, real DUST), i.e.
  wallet↔node↔indexer communication over the current wire protocol works,
  no faucet needed.

### Where contract deployment currently stops, and why

Submitting an actual `deployContract` call — generating a real ZK proof via
the live proof server and posting a real transaction to the node — fails
due to a version-skew problem across the published `@midnight-ntwrk/*`
package ecosystem, not a Warden defect:

1. The current Compact compiler (0.34.0) generates an *async* circuit API
   (`impureCircuits.foo(...)` returns `Promise<CircuitResults<...>>`), which
   requires `@midnight-ntwrk/compact-runtime@0.19.0`.
2. The current *stable* `midnight-js` line does not support that runtime:
   `midnight-js-contracts@4.0.4` bundles `compact-js@2.5.0`
   (→ `compact-runtime@0.15.0`); `midnight-js-protocol@4.1.1` bundles
   `compact-js@2.5.1` (→ `compact-runtime@0.16.0`). Both predate the async
   API change. Deploying a 0.34.0-compiled contract through `midnight-js@4.0.4`
   fails immediately inside its bundled `compact-js` with
   `TypeError: Cannot read properties of undefined (reading 'ctor')` — two
   `compact-js` instances disagreeing about the shape of a compiled contract.
3. The only published `midnight-js` line whose dependency chain matches
   `compact-runtime@0.19.0` is `5.0.0-beta.*`. As of `5.0.0-beta.8`, that
   line's `midnight-js-protocol` now depends on **both**
   `@midnightntwrk/ledger-v8@8.1.2` and `@midnightntwrk/ledger-v9@1.0.0-rc.4`
   (note the non-hyphenated `@midnightntwrk` scope — a different npm scope
   from `@midnight-ntwrk`, a real, easy-to-miss inconsistency in the
   ecosystem's own naming) — a genuine improvement over earlier betas, which
   depended on the v9 line only. Tested directly against this devnet
   (`midnightntwrk/midnight-node:0.22.3`, built for `ledger-v8`): wallet
   construction, node sync over the live WebSocket RPC, and real DUST
   registration all work, confirming the wire protocol is compatible this
   far. Three real bugs were found and fixed getting this far, each a
   genuine defect in `infra/devnet/deploy-script`, not the ecosystem:
   `CompiledContract.make`'s second argument must be the contract
   *constructor* (`WardenContract.Contract`), not the whole module
   namespace — passing the namespace compiles clean under `as any` but fails
   at runtime deep inside `compact-js` with `context.ctor is not a
   constructor`; the pipeline was also missing a `.withWitnesses(...)` step
   entirely, masked by the same `as any`; and `midnight-js-contracts`'
   version-tagged provider seams (new in this line) reject a raw
   `{ balanceTx, submitTx, ... }` object with `SeamEraUnsupportedError`
   unless it's built via `createWalletProvider`/`createMidnightProvider`
   from `@midnight-ntwrk/midnight-js/types`, which declare `supportedEras`
   correctly. Past all three: `deployContract`'s actual fee-balancing step
   fails with `expected instance of LedgerParameters` inside
   `@midnightntwrk/ledger-v9`'s WASM (`Transaction.feesWithMargin`), called
   from `wallet-sdk-dust-wallet@4.1.0`'s internal
   `TransactingCapabilityImplementation.calculateFee`. This is not something
   `deploy-and-call.ts` constructs or passes — `wallet-sdk-dust-wallet`
   syncs `ledgerParameters` itself from the live node
   (`RunningV1Variant.js`'s `syncService.blockData().ledgerParameters`),
   building it with `@midnight-ntwrk/ledger-v8` WASM bindings (per
   `wallet-sdk-dust-wallet`'s own type imports), while the `Transaction`
   object being fee-calculated is v9-native, produced by
   `midnight-js-contracts@5.0.0-beta.8`'s deploy pipeline. Its bound
   `.feesWithMargin` method belongs to the v9 WASM module and rejects a
   `LedgerParameters` instance from the v8 module — a WASM class-identity
   mismatch between two *different* packages (`wallet-sdk-dust-wallet` and
   `midnight-js-contracts`) that neither Warden's code nor its own
   dependency choices control. `wallet-sdk-dust-wallet@4.1.0` is the latest
   published version as of this writing; there is no newer release that
   might already resolve it.
4. Bridging from the other direction — recompiling `warden.compact` with an
   older compiler (0.31.1, producing the pre-async, synchronous circuit API
   compatible with `compact-runtime@0.16.0`) and targeting `midnight-js@4.1.1`
   specifically (`infra/devnet/deploy-script-legacy/`) — resolves the
   version-skew problem entirely rather than just narrowing it. Past
   compilation, past a `ledger-v8` WASM version mismatch (fixed by aligning
   `wallet-sdk-facade`/`-dust-wallet`/`-shielded`/`-unshielded-wallet` to a
   mutually consistent set pinned to `ledger-v8@^8.1.0`, applied via root
   `package.json`'s `"overrides"` plus a full clean reinstall — a duplicate
   WASM module instance is otherwise silently installed alongside the
   pinned one, producing cryptic `"expected instance of X"` errors from
   `wasm-bindgen`'s class-identity checks, not structural ones), past a real
   public API removal (`wallet-sdk-unshielded-wallet@2.1.0`'s
   `InMemoryTransactionHistoryStorage` export moved to
   `@midnight-ntwrk/wallet-sdk-abstractions` in `3.1.0` and requires a schema
   argument it didn't before — `NoOpTransactionHistoryStorage` from the same
   package needs neither and is a drop-in fix), and past a genuine upstream
   memory leak in `wallet-sdk-facade@4.0.1`/`wallet-sdk-dust-wallet@4.1.0`/
   `wallet-sdk-shielded@3.0.1` during real-network wallet sync (unbounded
   growth, ~7.6GB and still climbing after 17.5 minutes; fixed by bumping to
   the next stable patch releases, `4.1.0`/`4.2.0`/`3.0.2`, after which
   memory stayed flat at ~460–580MB for the full multi-hour sync) — this
   combination deploys and runs the complete mandate lifecycle successfully,
   with real ZK proofs and real transactions, on **both** the local devnet
   and the real public Midnight Preprod network.

**Local devnet, full lifecycle (`TARGET=local`):** deploy → `createMandate`
→ `authorize` within cap (accepted) → `authorize` over cap (correctly
rejected: `policy violation: amount exceeds mandate cap`) → `revoke` →
`authorize` after revoke (correctly rejected: `mandate revoked`). All six
steps produce real proofs via the local proof server and real transactions
against the local node.

**Live Midnight Preprod, full lifecycle (`TARGET=preprod`):** the same six
steps, against the real public network (`rpc.preprod.midnight.network`,
`indexer.preprod.midnight.network`), funded via the public faucet. A
brand-new wallet's first sync against Preprod's block height (~2.55M at the
time of this run) took roughly 3 hours 45 minutes — consistent with other
teams' reports on the buildathon's public channel — with a local proof
server for the ZK proving step throughout (proof generation and
verification are always local, regardless of which network the transaction
posts to; the proof server never handles private witness data over the
network). Real, on-chain evidence from that run:

| Step | Result |
|---|---|
| Contract address | `a61fb3417a82f6eff61e98e3ac50e759d916a86636f9ec25b9551375be8162bb` |
| Mandate ID | `e77c6743bf8b89f0541edeaeaf13926223123baad3d14ae6a6c523e9b90d13bf` |
| `createMandate` | tx `00c149d58e622dbbe8a20c6e326fd24c0219ba5e759e8d6c1bc72218ad9a579885`, block 2,549,815 |
| `authorize` 120 (within cap) | AUTHORIZED — tx `00985974c7948e7d0720383d2b39db27162756dc2314c1c9645c026b6a7ef20a45`, block 2,549,825 |
| `authorize` 99,999 (over cap) | correctly rejected: `policy violation: amount exceeds mandate cap` |
| `revoke` | tx `00670f4349e16ec52092fd49fc8e217ac1247b632b16587c5338353fe085d74b91`, block 2,549,832 |
| `authorize` 120 (after revoke) | correctly rejected: `mandate revoked` |

Both runs use the current, security-fixed `warden.compact` source (the same
`blockTimeLte` trusted-ledger-time logic in `packages/contracts/src/warden.compact`,
not a weakened snapshot) — the older 0.31.1 compiler and the current 0.34.0
compiler accept the same source unchanged, confirmed by compiling it under
both. Reproduce with `TARGET=local npm start` or
`TARGET=preprod npm start` from `infra/devnet/deploy-script-legacy/` (a
funded `.preprod-seed` file is required for the latter — see that
directory's own notes).

**Conclusion.** Deploying a contract compiled with the current (0.34.0)
Compact compiler directly through the newest `midnight-js@5.0.0-beta.*`
line remains blocked by the WASM class-identity mismatch described in item
3 above — that specific combination is not fixed and is not needed. The
practical, proven path is compiling with the older 0.31.1 compiler against
the stable `midnight-js@4.1.1` line, and that path now has genuine,
reproducible evidence of a full mandate lifecycle — deploy, authorize,
policy-cap enforcement, revoke, and post-revoke enforcement — with real
proofs and real transactions on both a local devnet and the live public
Preprod network.

**What this does not affect:** the Wave 1 deliverable. `packages/contracts`
stays on the current 0.34.0 compiler throughout, and its test suite
exercises the real compiled circuit logic via the
`@midnight-ntwrk/compact-runtime@0.19.0` simulator — the same methodology
Midnight's own official example contracts use for testing. See
`docs/WAVE-1-SPEC.md` §11 for the deployment-status summary and
`README.md` §12 for how this is represented to judges.
`infra/devnet/deploy-script*` are kept as working, documented evidence of
both how the current-compiler pipeline behaves and how the proven
older-compiler/stable-SDK path was validated end to end.
