// Live devnet/Preprod deployment against the *stable* midnight-js line
// (4.1.1), using warden.compact recompiled with Compact compiler 0.31.1 —
// whose synchronous circuit API matches the compact-runtime version that
// line's dependency chain actually ships with. This is the path
// apps/web's live Preprod backend (apps/web/src/server/preprod/) reuses —
// see docs/DEPLOYMENT.md for the resulting evidence. Otherwise identical
// to infra/devnet/deploy-script's deploy-and-call.ts — same genesis
// wallet, same devnet, same demo sequence — the only difference is which
// compiled contract and which midnight-js version it targets.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import * as Rx from "rxjs";
import { WebSocket } from "ws";

import { type ContractAddress } from "@midnight-ntwrk/compact-runtime";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import { unshieldedToken } from "@midnight-ntwrk/ledger-v8";
import { deployContract } from "@midnight-ntwrk/midnight-js/contracts";
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
// InMemoryTransactionHistoryStorage left wallet-sdk-unshielded-wallet's exports between 2.1.0 and
// 3.1.0 (now lives in wallet-sdk-abstractions, and needs a schema argument this script doesn't
// need). NoOpTransactionHistoryStorage needs neither — this script never reads transaction history.
import { NoOpTransactionHistoryStorage } from "@midnight-ntwrk/wallet-sdk-abstractions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- local legacy-compiled module, no published types package
import * as WardenContract from "../contract/src/managed/contract/index.js";
import { emptyWardenPrivateState, withMandate, idHex, type WardenPrivateState, type MandateRecord, witnesses } from "../contract/src/witnesses.ts";

// @ts-expect-error: needed to enable WebSocket usage through apollo, same as the reference CLI
globalThis.WebSocket = WebSocket;

// TARGET=preprod npm run start points this same script at the real public
// Preprod network instead of the local devnet — everything else (contract,
// wallet-building logic, demo sequence) is identical either way. The proof
// server is *always* local regardless of target: Midnight's own docs are
// explicit that it "runs locally... because it handles your private data".
const TARGET = process.env.TARGET === "preprod" ? "preprod" : "local";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(currentDir, "..", "contract", "src", "managed");
const privateStateId = "wardenPrivateStateLegacy";

const GENESIS_MINT_WALLET_SEED = "0000000000000000000000000000000000000000000000000000000000000001";
// A real, freshly-generated seed for Preprod — the well-known genesis seed
// above only has funds on a fresh *local* devnet; reusing a publicly-known
// seed on a real network would be a shared, valueless address. Generated
// once with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
// kept only in this local, gitignored file. See print-preprod-address.ts.
const PREPROD_SEED_PATH = path.resolve(currentDir, "..", ".preprod-seed");
const seed =
  TARGET === "preprod" ? fs.readFileSync(PREPROD_SEED_PATH, "utf8").trim() : GENESIS_MINT_WALLET_SEED;

setNetworkId(TARGET === "preprod" ? "preprod" : "undeployed");

const config =
  TARGET === "preprod"
    ? {
        indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
        indexerWS: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
        node: "https://rpc.preprod.midnight.network",
        proofServer: "http://127.0.0.1:6300"
      }
    : {
        indexer: "http://127.0.0.1:8088/api/v3/graphql",
        indexerWS: "ws://127.0.0.1:8088/api/v3/graphql/ws",
        node: "http://127.0.0.1:9944",
        proofServer: "http://127.0.0.1:6300"
      };

async function withStatus<T>(message: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`  … ${message}`);
  try {
    const result = await fn();
    process.stdout.write(`\r  ✓ ${message}\n`);
    return result;
  } catch (e) {
    process.stdout.write(`\r  ✗ ${message}\n`);
    throw e;
  }
}
function log(msg: string) {
  console.log(`  ${msg}`);
}

const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, "hex"));
  if (hdWallet.type !== "seedOk") throw new Error("Failed to initialize HDWallet from seed");
  const derivationResult = hdWallet.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
  if (derivationResult.type !== "keysDerived") throw new Error("Failed to derive keys");
  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

async function buildWallet() {
  const keys = deriveKeysFromSeed(seed);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());
  const walletConfig = {
    networkId: getNetworkId(),
    indexerClientConnection: { indexerHttpUrl: config.indexer, indexerWsUrl: config.indexerWS },
    provingServerUrl: new URL(config.proofServer),
    relayURL: new URL(config.node.replace(/^http/, "ws")),
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 }
  };
  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) => DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust)
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}

const waitForSync = (wallet: WalletFacade) => Rx.firstValueFrom(wallet.state().pipe(Rx.throttleTime(2_000), Rx.filter((s) => s.isSynced)));

// Only relevant on Preprod: the local devnet's genesis wallet starts funded
// and pre-registered for dust generation, but a freshly generated Preprod
// wallet starts at zero and needs both a real faucet transfer and a real
// on-chain dust-registration transaction before it can pay any fees itself.
const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => s.isSynced),
      Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
      Rx.filter((b) => b > 0n)
    )
  );

async function registerForDustGeneration(wallet: WalletFacade, unshieldedKeystore: ReturnType<typeof createKeystore>) {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  if (state.dust.availableCoins.length > 0 && state.dust.balance(new Date()) > 0n) {
    log(`dust already available (${state.dust.balance(new Date())})`);
    return;
  }
  const nightUtxos = state.unshielded.availableCoins.filter((c: any) => c.meta?.registeredForDustGeneration !== true);
  if (nightUtxos.length > 0) {
    await withStatus(`registering ${nightUtxos.length} NIGHT UTXO(s) for dust generation`, async () => {
      const recipe = await wallet.registerNightUtxosForDustGeneration(nightUtxos, unshieldedKeystore.getPublicKey(), (payload) =>
        unshieldedKeystore.signData(payload)
      );
      const finalized = await wallet.finalizeRecipe(recipe);
      await wallet.submitTransaction(finalized);
    });
  }
  await withStatus("waiting for dust to generate", () =>
    Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(3_000),
        Rx.filter((s) => s.isSynced),
        Rx.filter((s) => s.dust.balance(new Date()) > 0n)
      )
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
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) }
      );
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx(tx: any) {
      return ctx.wallet.submitTransaction(tx) as any;
    }
  };
}

async function main() {
  console.log(
    `\nWarden — live ${TARGET === "preprod" ? "Preprod" : "devnet"} validation (legacy SDK line, compiler 0.31.1)\n====================================================================\n`
  );

  const ctx = await withStatus(TARGET === "preprod" ? "building Preprod wallet" : "building genesis wallet", buildWallet);
  await withStatus("syncing with node", () => waitForSync(ctx.wallet));
  const balance0 = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n)));
  log(`unshielded balance: ${balance0.toLocaleString()} tNight`);
  if (balance0 === 0n) {
    await withStatus("waiting for faucet funds", () => waitForFunds(ctx.wallet));
  }
  await registerForDustGeneration(ctx.wallet, ctx.unshieldedKeystore);

  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, "hex").toString("base64")}!`;

  const providers = {
    privateStateProvider: levelPrivateStateProvider<typeof privateStateId>({
      privateStateStoreName: "warden-private-state-legacy",
      accountId,
      privateStoragePasswordProvider: () => storagePassword
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider
  };

  // CompiledContract.make's 2nd argument is the contract constructor itself, not the whole
  // module namespace — passing the namespace compiles under `as any` but fails at runtime with
  // "context.ctor is not a constructor" (there's no real class behind a namespace object).
  const compiledContract = CompiledContract.make("warden", (WardenContract as any).Contract).pipe(
    CompiledContract.withWitnesses(witnesses as any),
    CompiledContract.withCompiledFileAssets(zkConfigPath)
  );

  const deployed = await withStatus("deploying warden.compact (0.31.1) via midnight-js@4.1.1", () =>
    deployContract(providers as any, {
      compiledContract,
      privateStateId,
      initialPrivateState: emptyWardenPrivateState()
    } as any)
  );
  const contractAddress: ContractAddress = (deployed as any).deployTxData.public.contractAddress;
  log(`deployed at ${contractAddress}`);

  const principalSecret = new Uint8Array(32).fill(7);
  const agentSecret = new Uint8Array(32).fill(9);
  const principalPk = (WardenContract as any).pureCircuits.pkOf(principalSecret);
  const agentPk = (WardenContract as any).pureCircuits.pkOf(agentSecret);
  const enc = (s: string) => {
    const out = new Uint8Array(32);
    out.set(new TextEncoder().encode(s));
    return out;
  };
  const policy = {
    maxAmount: 500n,
    asset: enc("DEMO"),
    actionType: enc("payment"),
    destinationCategory: enc("vendor:approved"),
    expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
    actionCountLimit: 5n,
    salt: new Uint8Array(32).fill(3)
  };
  const contextObj = { principalPk, agentPk, policy };
  const id = (WardenContract as any).pureCircuits.mandateId(contextObj);
  log(`mandate id: ${idHex(id)}`);

  const record: MandateRecord = { context: contextObj, principalSecret, agentSecret, spentTotal: 0n, spentNonce: new Uint8Array(32) };
  await providers.privateStateProvider.set(privateStateId, withMandate(emptyWardenPrivateState(), id, record));

  await withStatus("createMandate (real proof + real transaction)", async () => {
    const finalized = await (deployed as any).callTx.createMandate(id);
    log(`  tx ${finalized.public.txId} in block ${finalized.public.blockHeight}`);
  });

  // Fold the real freshNonce the circuit actually drew into our local record,
  // exactly as packages/sdk's client.ts does for the simulator backend.
  let ps = (await providers.privateStateProvider.get(privateStateId)) as WardenPrivateState;
  const afterCreate = ps.mandates[idHex(id)];
  if (afterCreate?.pendingNonce) {
    ps = withMandate(ps, id, { ...afterCreate, spentTotal: 0n, spentNonce: afterCreate.pendingNonce, pendingNonce: undefined });
    await providers.privateStateProvider.set(privateStateId, ps);
  }

  await withStatus("authorize 120 (within cap — expect AUTHORIZED)", async () => {
    const finalized = await (deployed as any).callTx.authorize(id, 120n, policy.asset, policy.actionType, policy.destinationCategory);
    log(`  tx ${finalized.public.txId} in block ${finalized.public.blockHeight}`);
  });
  ps = (await providers.privateStateProvider.get(privateStateId)) as WardenPrivateState;
  const afterAuth = ps.mandates[idHex(id)];
  if (afterAuth?.pendingNonce) {
    ps = withMandate(ps, id, { ...afterAuth, spentTotal: afterAuth.spentTotal + 120n, spentNonce: afterAuth.pendingNonce, pendingNonce: undefined });
    await providers.privateStateProvider.set(privateStateId, ps);
  }

  try {
    await withStatus("authorize 99999 (over cap — expect BLOCKED)", async () => {
      await (deployed as any).callTx.authorize(id, 99_999n, policy.asset, policy.actionType, policy.destinationCategory);
    });
    log("  !! unexpectedly succeeded");
  } catch (e) {
    log(`  correctly rejected: ${(e as Error).message.split("\n")[0]}`);
  }

  await withStatus("revoke", async () => {
    const finalized = await (deployed as any).callTx.revoke(id);
    log(`  tx ${finalized.public.txId} in block ${finalized.public.blockHeight}`);
  });

  try {
    await withStatus("authorize 120 after revoke (expect BLOCKED)", async () => {
      await (deployed as any).callTx.authorize(id, 120n, policy.asset, policy.actionType, policy.destinationCategory);
    });
    log("  !! unexpectedly succeeded");
  } catch (e) {
    log(`  correctly rejected: ${(e as Error).message.split("\n")[0]}`);
  }

  console.log("\n✓ Live devnet validation (legacy SDK line) complete — full mandate lifecycle, real proofs, real transactions.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✗ Live devnet validation (legacy) failed:\n", e);
  process.exit(1);
});
