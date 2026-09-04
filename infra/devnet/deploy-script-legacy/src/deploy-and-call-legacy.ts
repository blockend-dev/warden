// Experiment: live devnet deployment against the *stable* midnight-js line
// (4.1.1), using warden.compact recompiled with Compact compiler 0.31.1 —
// whose synchronous circuit API matches the compact-runtime version that
// line's dependency chain actually ships with (see
// docs/IMPLEMENTATION-NOTES.md for the full version-skew story that led
// here). Otherwise identical to infra/devnet/deploy-script's
// deploy-and-call.ts — same genesis wallet, same devnet, same demo
// sequence — the only difference is which compiled contract and which
// midnight-js version it targets.

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
import { createKeystore, InMemoryTransactionHistoryStorage, PublicKey, UnshieldedWallet } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- local legacy-compiled module, no published types package
import * as WardenContract from "../contract/src/managed/contract/index.js";
import { emptyWardenPrivateState, withMandate, idHex, type WardenPrivateState, type MandateRecord, witnesses } from "../contract/src/witnesses.ts";

// @ts-expect-error: needed to enable WebSocket usage through apollo, same as the reference CLI
globalThis.WebSocket = WebSocket;

const GENESIS_MINT_WALLET_SEED = "0000000000000000000000000000000000000000000000000000000000000001";
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(currentDir, "..", "contract", "src", "managed");
const privateStateId = "wardenPrivateStateLegacy";

setNetworkId("undeployed");

const config = {
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
  const keys = deriveKeysFromSeed(GENESIS_MINT_WALLET_SEED);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());
  const walletConfig = {
    networkId: getNetworkId(),
    indexerClientConnection: { indexerHttpUrl: config.indexer, indexerWsUrl: config.indexerWS },
    provingServerUrl: new URL(config.proofServer),
    relayURL: new URL(config.node.replace(/^http/, "ws")),
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
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
  console.log("\nWarden — live devnet validation (legacy SDK line, compiler 0.31.1)\n====================================================================\n");

  const ctx = await withStatus("building genesis wallet", buildWallet);
  await withStatus("syncing with node", () => waitForSync(ctx.wallet));
  const balance = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n)));
  log(`unshielded balance: ${balance.toLocaleString()} tNight`);

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

  const compiledContract = CompiledContract.make("warden", WardenContract as any).pipe(
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

  console.log("\n✓ Live devnet validation (legacy SDK line) complete.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✗ Live devnet validation (legacy) failed:\n", e);
  process.exit(1);
});
