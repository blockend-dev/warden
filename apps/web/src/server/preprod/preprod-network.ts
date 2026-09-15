// The live Midnight Preprod backend behind apps/web's API routes — a
// `WardenBackend` (see packages/sdk/src/network.ts) that submits real
// transactions to the real public Preprod network, instead of running
// circuits in-process the way `LocalSimulatorNetwork` does.
//
// SERVER-ONLY. Never import this from a "use client" component or anything
// reachable from the browser bundle: it holds a real wallet's derived keys
// in process memory for the lifetime of the server, and depends on Node-only
// packages (fs, the legacy midnight-js/wallet-sdk stack) that cannot run in
// a browser anyway. The only caller is `../network.ts`, itself only ever
// imported by `app/api/*/route.ts` Route Handlers — see that file's own
// comment for the import chain this depends on.
//
// Why a *different* compiled contract than `@warden/contracts`: the current
// Compact compiler (0.34.0) generates an async circuit API that no
// currently-stable `midnight-js` release supports. The proven-working path
// (see docs/DEPLOYMENT.md and infra/devnet/deploy-script-legacy/) recompiles
// the same unmodified warden.compact source with an older compiler (0.31.1) to match
// the stable `midnight-js@4.1.1` line. `./contract/managed` is that same
// build, regenerated for this app specifically (`npm run compact:legacy`)
// so it lives inside apps/web's own module graph rather than reaching
// across directories into infra/devnet/deploy-script-legacy at runtime.
// `./contract/witnesses.ts` is a copy of that same proven script's witness
// implementation, structurally identical to `packages/contracts`' (same
// source, same hand-written shape) — see that file's own comment.
//
// One shared wallet, one shared contract connection, for the whole server
// process — not one per visitor. Generating and syncing a fresh Preprod
// wallet takes hours (a brand-new address has to catch up the entire chain
// history); a hosted demo cannot pay that cost per visitor, and "the goal is
// a functional judge-facing Preprod deployment, not a production custody
// architecture" (this module's design brief). Every demo session still gets
// its own principal/agent secrets and its own mandates — only the wallet
// that pays fees and submits transactions is shared. Calls are serialized
// (see `enqueue` below) so concurrent visitors' transactions cannot race
// the same wallet's nonce, and so the temporary shared private-state slot
// this module writes to the contract's private-state provider before each
// call can't be clobbered by an interleaved second call.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import * as Rx from "rxjs";
import { WebSocket } from "ws";

import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import * as ledgerV8 from "@midnight-ntwrk/ledger-v8";
import { unshieldedToken } from "@midnight-ntwrk/ledger-v8";
import { findDeployedContract, getPublicStates } from "@midnight-ntwrk/midnight-js/contracts";
import { setNetworkId, getNetworkId } from "@midnight-ntwrk/midnight-js/network-id";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { type MidnightProvider, type WalletProvider } from "@midnight-ntwrk/midnight-js/types";
import { WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import { DustWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { ShieldedWallet } from "@midnight-ntwrk/wallet-sdk-shielded";
import { createKeystore, PublicKey, UnshieldedWallet } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import { NoOpTransactionHistoryStorage } from "@midnight-ntwrk/wallet-sdk-abstractions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- local legacy-compiled module, no published types package (same as infra/devnet/deploy-script-legacy)
import * as WardenContract from "./contract/managed/contract/index.js";
import { emptyWardenPrivateState, witnesses, type WardenPrivateState as LegacyPrivateState } from "./contract/witnesses";

import type { WardenBackend, LiveEvidence } from "@warden/sdk";
import { NetworkUnavailableError, classifyLiveError } from "@warden/sdk";
import type { Ledger, WardenPrivateState } from "@warden/contracts";

if (typeof globalThis.WebSocket === "undefined") {
  // @ts-expect-error: needed to enable WebSocket usage through apollo, same as the proven deploy-script-legacy
  globalThis.WebSocket = WebSocket;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(currentDir, "contract", "managed");
const privateStateId = "warden-web-live";

export type PreprodConfig = {
  seed: string;
  contractAddress: string;
  indexer: string;
  indexerWS: string;
  node: string;
  proofServer: string;
};

/** Reads config from environment variables — see .env.example for the full
 * list and docs/DEPLOY-RAILWAY.md for what each one does. Returns
 * `undefined` (not a thrown error) when live mode simply
 * isn't configured, so the caller can fall back to an honest "unconfigured"
 * status instead of a crash. */
export function readPreprodConfig(): PreprodConfig | undefined {
  if (process.env.WARDEN_NETWORK !== "preprod") return undefined;
  const seed = process.env.WARDEN_PREPROD_SEED?.trim();
  const contractAddress = process.env.WARDEN_CONTRACT_ADDRESS?.trim();
  if (!seed || !/^[0-9a-f]{64}$/i.test(seed)) {
    throw new Error("WARDEN_NETWORK=preprod requires WARDEN_PREPROD_SEED (64 hex chars) to be set.");
  }
  if (!contractAddress) {
    throw new Error("WARDEN_NETWORK=preprod requires WARDEN_CONTRACT_ADDRESS (the deployed contract's address) to be set.");
  }
  return {
    seed,
    contractAddress,
    indexer: process.env.WARDEN_PREPROD_INDEXER ?? "https://indexer.preprod.midnight.network/api/v4/graphql",
    indexerWS: process.env.WARDEN_PREPROD_INDEXER_WS ?? "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
    node: process.env.WARDEN_PREPROD_NODE ?? "https://rpc.preprod.midnight.network",
    proofServer: process.env.WARDEN_PROOF_SERVER_URL ?? "http://127.0.0.1:6300"
  };
}

export type PreprodStatus =
  | { phase: "starting" }
  | { phase: "syncing"; detail: string }
  | { phase: "ready"; contractAddress: string; network: string }
  | { phase: "error"; detail: string };

let status: PreprodStatus = { phase: "starting" };
export function getPreprodStatus(): PreprodStatus {
  return status;
}

const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, "hex"));
  if (hdWallet.type !== "seedOk") throw new Error("Failed to initialize HDWallet from seed");
  const derivationResult = hdWallet.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
  if (derivationResult.type !== "keysDerived") throw new Error("Failed to derive keys");
  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

async function buildWallet(cfg: PreprodConfig) {
  const keys = deriveKeysFromSeed(cfg.seed);
  const shieldedSecretKeys = ledgerV8.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledgerV8.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());
  const walletConfig = {
    networkId: getNetworkId(),
    indexerClientConnection: { indexerHttpUrl: cfg.indexer, indexerWsUrl: cfg.indexerWS },
    provingServerUrl: new URL(cfg.proofServer),
    relayURL: new URL(cfg.node.replace(/^http/, "ws")),
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 }
  };
  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (c: unknown) => ShieldedWallet(c as never).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (c: unknown) => UnshieldedWallet(c as never).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (c: unknown) => DustWallet(c as never).startWithSecretKey(dustSecretKey, ledgerV8.LedgerParameters.initialParameters().dust)
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}

const waitForSync = (wallet: WalletFacade) => Rx.firstValueFrom(wallet.state().pipe(Rx.throttleTime(2_000), Rx.filter((s) => s.isSynced)));

async function registerForDustGeneration(wallet: WalletFacade, unshieldedKeystore: ReturnType<typeof createKeystore>) {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  if (state.dust.availableCoins.length > 0 && state.dust.balance(new Date()) > 0n) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wallet-sdk-facade's UTXO meta shape, no published type export used here
  const nightUtxos = state.unshielded.availableCoins.filter((c: any) => c.meta?.registeredForDustGeneration !== true);
  if (nightUtxos.length > 0) {
    const recipe = await wallet.registerNightUtxosForDustGeneration(nightUtxos, unshieldedKeystore.getPublicKey(), (payload: unknown) =>
      unshieldedKeystore.signData(payload as never)
    );
    const finalized = await wallet.finalizeRecipe(recipe);
    await wallet.submitTransaction(finalized);
  }
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(3_000),
      Rx.filter((s) => s.isSynced),
      Rx.filter((s) => s.dust.balance(new Date()) > 0n)
    )
  );
}

async function createWalletAndMidnightProvider(ctx: Awaited<ReturnType<typeof buildWallet>>): Promise<WalletProvider & MidnightProvider> {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return {
    getCoinPublicKey() {
      return state.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return state.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx: unknown, ttl?: Date) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx as never,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) }
      );
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx(tx: unknown) {
      return ctx.wallet.submitTransaction(tx as never) as never;
    }
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- FoundContract<C> / ContractProviders<C>, no published types for the locally-compiled contract
let found: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let providers: any;
let cfg: PreprodConfig;

// Serializes every call that touches the shared wallet or the shared
// private-state slot: two visitors' transactions submitting concurrently
// would race the same wallet's nonce, and two calls writing to the same
// `privateStateId` slot between each other's write-call-read sequence would
// corrupt each other's private state. One queue fixes both at once.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

let initPromise: Promise<void> | undefined;

/** Starts the wallet build + sync in the background exactly once per server
 * process. Safe to call from multiple request handlers; they all await the
 * same in-flight initialization. Never throws into an unhandled rejection —
 * failures are recorded in `status` and re-thrown to whoever's awaiting. */
export function ensurePreprodInit(config: PreprodConfig): Promise<void> {
  if (initPromise) return initPromise;
  cfg = config;
  setNetworkId("preprod");
  initPromise = (async () => {
    try {
      status = { phase: "starting" };
      const ctx = await buildWallet(cfg);
      status = { phase: "syncing", detail: "connecting to Preprod node" };
      await waitForSync(ctx.wallet);
      status = { phase: "syncing", detail: "registering for DUST generation" };
      await registerForDustGeneration(ctx.wallet, ctx.unshieldedKeystore);

      const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
      const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
      const accountId = walletAndMidnightProvider.getCoinPublicKey();
      const storagePassword = `${Buffer.from(accountId, "hex").toString("base64")}!`;

      providers = {
        privateStateProvider: levelPrivateStateProvider<typeof privateStateId>({
          privateStateStoreName: "warden-web-live-private-state",
          accountId,
          privateStoragePasswordProvider: () => storagePassword
        }),
        publicDataProvider: indexerPublicDataProvider(cfg.indexer, cfg.indexerWS),
        zkConfigProvider,
        proofProvider: httpClientProofProvider(cfg.proofServer, zkConfigProvider),
        walletProvider: walletAndMidnightProvider,
        midnightProvider: walletAndMidnightProvider
      };

      status = { phase: "syncing", detail: "connecting to the deployed contract" };
      // No published types package for this locally-compiled contract module
      // (same as infra/devnet/deploy-script-legacy, which this mirrors) —
      // `tsc --noEmit` is strict here (unlike that script, run only via
      // `node --experimental-strip-types`, which never type-checks it), so
      // this needs an explicit `any` rather than fighting inference through
      // a `.pipe()` chain whose types are only ever "whatever the compiler
      // emitted for warden.compact".
      const compiledContract: any = (CompiledContract.make as any)("warden", (WardenContract as any).Contract).pipe(
        (CompiledContract.withWitnesses as any)(witnesses),
        (CompiledContract.withCompiledFileAssets as any)(zkConfigPath)
      );
      found = await findDeployedContract(providers as any, {
        compiledContract,
        contractAddress: cfg.contractAddress,
        privateStateId,
        initialPrivateState: emptyWardenPrivateState()
      } as any);

      status = { phase: "ready", contractAddress: cfg.contractAddress, network: "Midnight Preprod" };
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      status = { phase: "error", detail };
      throw cause;
    }
  })();
  return initPromise;
}

function requireReady(): void {
  if (status.phase !== "ready") {
    const detail = status.phase === "error" ? status.detail : status.phase === "syncing" ? status.detail : "starting up";
    throw new NetworkUnavailableError(`Preprod connection not ready yet (${status.phase}: ${detail}).`);
  }
}

/** Converts between `@warden/contracts`' (0.34.0-compiled) and this
 * module's own (0.31.1-compiled) `WardenPrivateState` shapes. Both are
 * hand-written wrappers around the same warden.compact witness
 * declarations (see this directory's `contract/witnesses.ts` comment) —
 * structurally identical field-for-field, so this is a type-level
 * relabeling, not a data transformation. Kept as an explicit named function
 * rather than scattered `as any` casts so the assumption is visible in one
 * place, and the live smoke test is what actually proves it holds. */
function asLegacy(ps: WardenPrivateState): LegacyPrivateState {
  return ps as unknown as LegacyPrivateState;
}
function fromLegacy(ps: LegacyPrivateState): WardenPrivateState {
  return ps as unknown as WardenPrivateState;
}

async function withPrivateState<T>(privateState: WardenPrivateState, fn: () => Promise<T>): Promise<{ result: T; nextPrivateState: WardenPrivateState }> {
  await providers.privateStateProvider.set(privateStateId, asLegacy(privateState));
  const result = await fn();
  const nextPrivateState = fromLegacy((await providers.privateStateProvider.get(privateStateId)) as LegacyPrivateState);
  return { result, nextPrivateState };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- FinalizedCallTxData<C>, no published types for the locally-compiled contract
function evidenceOf(finalized: any): LiveEvidence {
  return {
    network: "Midnight Preprod",
    txId: finalized.public.txId,
    blockHeight: finalized.public.blockHeight,
    contractAddress: cfg.contractAddress
  };
}

/** `classifyLiveError` tries circuit-assert patterns first (a real Preprod
 * rejection throws the same `failed assert: ...` text the simulator does —
 * same compiled contract), then falls back to infra classification
 * (`NetworkUnavailableError`, `ProofGenerationError`, ...) for anything
 * else. Classifying *here*, not leaving it to `packages/sdk`'s
 * `classifyCircuitError`, is what gets `PreprodNetwork` the more specific
 * network error types — `classifyCircuitError` passes an already-typed
 * `WardenError` through unchanged, so this survives the trip back through
 * `client.ts`'s own catch block intact. */
async function callLive<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw classifyLiveError(cause);
  }
}

export class PreprodNetwork implements WardenBackend {
  async getLedger(): Promise<Ledger> {
    requireReady();
    return callLive(async () => {
      const { contractState } = await getPublicStates(providers.publicDataProvider, cfg.contractAddress);
      return (WardenContract as any).ledger(contractState.data) as Ledger;
    });
  }

  createMandate(privateState: WardenPrivateState, id: Uint8Array) {
    return enqueue(() =>
      callLive(async () => {
        requireReady();
        const { result: finalized, nextPrivateState } = await withPrivateState(privateState, () => found.callTx.createMandate(id));
        return { ledger: await this.getLedger(), privateState: nextPrivateState, evidence: evidenceOf(finalized) };
      })
    );
  }

  authorize(
    privateState: WardenPrivateState,
    id: Uint8Array,
    requestedAmount: bigint,
    requestedAsset: Uint8Array,
    requestedActionType: Uint8Array,
    requestedDestinationCategory: Uint8Array
  ) {
    return enqueue(() =>
      callLive(async () => {
        requireReady();
        const { result: finalized, nextPrivateState } = await withPrivateState(privateState, () =>
          found.callTx.authorize(id, requestedAmount, requestedAsset, requestedActionType, requestedDestinationCategory)
        );
        return { ledger: await this.getLedger(), privateState: nextPrivateState, evidence: evidenceOf(finalized) };
      })
    );
  }

  revoke(privateState: WardenPrivateState, id: Uint8Array) {
    return enqueue(() =>
      callLive(async () => {
        requireReady();
        const { result: finalized, nextPrivateState } = await withPrivateState(privateState, () => found.callTx.revoke(id));
        return { ledger: await this.getLedger(), privateState: nextPrivateState, evidence: evidenceOf(finalized) };
      })
    );
  }
}
