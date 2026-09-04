// Real end-to-end validation against the local Docker devnet
// (infra/devnet/standalone.yml): deploys the actual compiled warden.compact
// contract, and submits real, proof-bearing transactions for createMandate,
// authorize (valid), authorize (over-cap — expected to fail), revoke, and
// authorize-after-revoke (expected to fail).
//
// This is deliberately a standalone script, not (yet) wired into
// packages/sdk's WardenBackend abstraction — see docs/IMPLEMENTATION-NOTES.md
// for why: the wallet/provider plumbing below (HD key derivation across
// three roles, dust registration, RxJS-based sync) is real, non-trivial
// integration surface that's worth validating in isolation first. Promoting
// this into a proper `LiveNetwork implements WardenBackend` is a named next
// step once this script itself is proven out.
//
// Adapted directly from midnightntwrk/example-counter's counter-cli
// (api.ts / cli.ts / config.ts), fetched 2026-09-07 — see
// docs/IMPLEMENTATION-NOTES.md. Structure and provider wiring follow that
// reference as closely as possible rather than being invented, since this is
// exactly the kind of "trust the current official implementation" case the
// project was asked to prioritize.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import * as Rx from "rxjs";
import { WebSocket } from "ws";

import { type ContractAddress } from "@midnight-ntwrk/compact-runtime";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
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

import * as WardenContract from "@warden/contracts";
import { emptyWardenPrivateState, withMandate, idHex, type WardenPrivateState, type MandateRecord } from "@warden/contracts";

// Required for GraphQL subscriptions (wallet sync) to work in Node.js
// @ts-expect-error: needed to enable WebSocket usage through apollo, same as the reference CLI
globalThis.WebSocket = WebSocket;

const GENESIS_MINT_WALLET_SEED = "0000000000000000000000000000000000000000000000000000000000000001";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(currentDir, "..", "..", "..", "..", "packages", "contracts", "src", "managed", "warden");
const privateStateId = "wardenPrivateState";

setNetworkId("undeployed");

const config = {
  indexer: "http://127.0.0.1:8088/api/v3/graphql",
  indexerWS: "ws://127.0.0.1:8088/api/v3/graphql/ws",
  node: "http://127.0.0.1:9944",
  proofServer: "http://127.0.0.1:6300"
};

function log(msg: string) {
  console.log(`  ${msg}`);
}

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

const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, "hex"));
  if (hdWallet.type !== "seedOk") throw new Error("Failed to initialize HDWallet from seed");
  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derivationResult.type !== "keysDerived") throw new Error("Failed to derive keys");
  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

const buildShieldedConfig = () => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: config.indexer, indexerWsUrl: config.indexerWS },
  provingServerUrl: new URL(config.proofServer),
  relayURL: new URL(config.node.replace(/^http/, "ws"))
});
const buildUnshieldedConfig = () => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: config.indexer, indexerWsUrl: config.indexerWS },
  txHistoryStorage: new InMemoryTransactionHistoryStorage()
});
const buildDustConfig = () => ({
  networkId: getNetworkId(),
  costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  indexerClientConnection: { indexerHttpUrl: config.indexer, indexerWsUrl: config.indexerWS },
  provingServerUrl: new URL(config.proofServer),
  relayURL: new URL(config.node.replace(/^http/, "ws"))
});

async function buildWallet() {
  const keys = deriveKeysFromSeed(GENESIS_MINT_WALLET_SEED);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

  const walletConfig = { ...buildShieldedConfig(), ...buildUnshieldedConfig(), ...buildDustConfig() };
  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) => DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust)
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}

const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(wallet.state().pipe(Rx.throttleTime(2_000), Rx.filter((s) => s.isSynced)));

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

async function createWalletAndMidnightProvider(ctx: {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: ReturnType<typeof createKeystore>;
}): Promise<WalletProvider & MidnightProvider> {
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
  console.log("\nWarden — live devnet validation\n================================\n");

  const { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = await withStatus("building genesis wallet", buildWallet);
  await withStatus("syncing with node", () => waitForSync(wallet));
  const balance0 = await Rx.firstValueFrom(wallet.state().pipe(Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n)));
  log(`unshielded balance: ${balance0.toLocaleString()} tNight`);
  if (balance0 === 0n) {
    await withStatus("waiting for genesis funds", () => waitForFunds(wallet));
  }
  await registerForDustGeneration(wallet, unshieldedKeystore);

  const walletAndMidnightProvider = await createWalletAndMidnightProvider({ wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore });
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, "hex").toString("base64")}!`;

  const providers = {
    privateStateProvider: levelPrivateStateProvider<typeof privateStateId>({
      privateStateStoreName: "warden-private-state",
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
    CompiledContract.withCompiledFileAssets(zkConfigPath)
  );

  const deployed = await withStatus("deploying warden.compact to the devnet", () =>
    deployContract(providers as any, {
      compiledContract,
      privateStateId,
      initialPrivateState: emptyWardenPrivateState()
    })
  );
  const contractAddress: ContractAddress = (deployed as any).deployTxData.public.contractAddress;
  log(`deployed at ${contractAddress}`);

  // --- Build a real mandate and seed private state, exactly like the fixtures used in packages/contracts' own tests ---
  const principalSecret = new Uint8Array(32).fill(7);
  const agentSecret = new Uint8Array(32).fill(9);
  const principalPk = WardenContract.pureCircuits.pkOf(principalSecret);
  const agentPk = WardenContract.pureCircuits.pkOf(agentSecret);
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
  const context = { principalPk, agentPk, policy };
  const id = WardenContract.pureCircuits.mandateId(context);
  log(`mandate id: ${idHex(id)}`);

  const record: MandateRecord = { context, principalSecret, agentSecret, spentTotal: 0n, spentNonce: new Uint8Array(32) };
  let ps = withMandate(emptyWardenPrivateState(), id, record);
  await providers.privateStateProvider.set(privateStateId, ps);

  await withStatus("createMandate (real proof + real transaction)", async () => {
    const finalized = await (deployed as any).callTx.createMandate(id);
    log(`  tx ${finalized.public.txId} in block ${finalized.public.blockHeight}`);
  });

  // Fold the real freshNonce the circuit actually drew into our local record,
  // exactly as packages/sdk's client.ts does for the simulator backend.
  ps = (await providers.privateStateProvider.get(privateStateId)) as WardenPrivateState;
  const afterCreate = ps.mandates[idHex(id)];
  if (afterCreate?.pendingNonce) {
    ps = withMandate(ps, id, { ...afterCreate, spentTotal: 0n, spentNonce: afterCreate.pendingNonce, pendingNonce: undefined });
    await providers.privateStateProvider.set(privateStateId, ps);
  }

  await withStatus("authorize 120 (within cap — expect AUTHORIZED)", async () => {
    const finalized = await (deployed as any).callTx.authorize(id, 120n, policy.asset, policy.actionType, policy.destinationCategory, BigInt(Math.floor(Date.now() / 1000)));
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
      await (deployed as any).callTx.authorize(id, 99_999n, policy.asset, policy.actionType, policy.destinationCategory, BigInt(Math.floor(Date.now() / 1000)));
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
      await (deployed as any).callTx.authorize(id, 120n, policy.asset, policy.actionType, policy.destinationCategory, BigInt(Math.floor(Date.now() / 1000)));
    });
    log("  !! unexpectedly succeeded");
  } catch (e) {
    log(`  correctly rejected: ${(e as Error).message.split("\n")[0]}`);
  }

  console.log("\n✓ Live devnet validation complete.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✗ Live devnet validation failed:\n", e);
  process.exit(1);
});
