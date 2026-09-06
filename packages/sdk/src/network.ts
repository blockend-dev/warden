import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, witnesses, emptyWardenPrivateState, type Ledger, type WardenPrivateState } from "@warden/contracts";

type CallResult = { ledger: Ledger; privateState: WardenPrivateState };

/**
 * Everything a `WardenClient` needs from "the chain" — deliberately narrow,
 * so a real network-backed implementation (using
 * `@midnight-ntwrk/midnight-js`'s provider stack once a devnet/proof server
 * is available — see docs/IMPLEMENTATION-NOTES.md) is a drop-in
 * `WardenBackend`, not a rewrite of `client.ts`.
 */
export interface WardenBackend {
  getLedger(): Ledger;
  createMandate(privateState: WardenPrivateState, id: Uint8Array): Promise<CallResult>;
  authorize(
    privateState: WardenPrivateState,
    id: Uint8Array,
    requestedAmount: bigint,
    requestedAsset: Uint8Array,
    requestedActionType: Uint8Array,
    requestedDestinationCategory: Uint8Array
  ): Promise<CallResult>;
  revoke(privateState: WardenPrivateState, id: Uint8Array): Promise<CallResult>;
}

/**
 * Wave 1's `WardenBackend`: the real, compiled `warden.compact` circuits,
 * run in-process via `@midnight-ntwrk/compact-runtime` — the same simulator
 * methodology Midnight's own official example contracts use for testing
 * (see docs/IMPLEMENTATION-NOTES.md). Every `assert` in the contract
 * executes for real; nothing here is a mock of the protocol's logic.
 *
 * What it is *not* a substitute for: real proof generation against a live
 * proof server, and real submission to a devnet/Preview/Preprod network. A
 * live devnet was reached separately (`infra/devnet/`) but contract
 * deployment there is currently blocked by a published-package version
 * mismatch between the current Compact compiler and the stable `midnight-js`
 * SDK line, not by anything in this codebase — see
 * docs/IMPLEMENTATION-NOTES.md. `WardenBackend` exists specifically so that
 * gap is a swappable implementation, not a load-bearing assumption baked
 * into the client.
 *
 * Models the real Midnight shape correctly even though it's local: the
 * public ledger state (`this.state`) is one shared value every party's
 * calls read from and write back to, while each party keeps its own private
 * state (secrets, policy context) entirely separately, in its own
 * `WardenClient` — exactly as a real deployment would split "the chain" from
 * "each wallet's local state".
 */
export class LocalSimulatorNetwork implements WardenBackend {
  private readonly address: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque runtime state from @midnight-ntwrk/compact-runtime, not meant to be inspected here
  private state: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private zswap: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private constructor(address: string, state: any, zswap: any) {
    this.address = address;
    this.state = state;
    this.zswap = zswap;
  }

  static async create(): Promise<LocalSimulatorNetwork> {
    const bootstrap = new Contract<WardenPrivateState>(witnesses);
    const ctor = await bootstrap.initialState(createConstructorContext(emptyWardenPrivateState(), "0".repeat(64)));
    return new LocalSimulatorNetwork(sampleContractAddress(), ctor.currentContractState, ctor.currentZswapLocalState);
  }

  getLedger(): Ledger {
    return ledger(this.state);
  }

  async createMandate(privateState: WardenPrivateState, id: Uint8Array): Promise<CallResult> {
    const contract = new Contract<WardenPrivateState>(witnesses);
    const ctx = createCircuitContext("createMandate", this.address, this.zswap, this.state, privateState);
    const res = await contract.impureCircuits.createMandate(ctx, id);
    return this.commit(res.context);
  }

  async authorize(
    privateState: WardenPrivateState,
    id: Uint8Array,
    requestedAmount: bigint,
    requestedAsset: Uint8Array,
    requestedActionType: Uint8Array,
    requestedDestinationCategory: Uint8Array
  ): Promise<CallResult> {
    const contract = new Contract<WardenPrivateState>(witnesses);
    const ctx = createCircuitContext("authorize", this.address, this.zswap, this.state, privateState);
    const res = await contract.impureCircuits.authorize(
      ctx,
      id,
      requestedAmount,
      requestedAsset,
      requestedActionType,
      requestedDestinationCategory
    );
    return this.commit(res.context);
  }

  async revoke(privateState: WardenPrivateState, id: Uint8Array): Promise<CallResult> {
    const contract = new Contract<WardenPrivateState>(witnesses);
    const ctx = createCircuitContext("revoke", this.address, this.zswap, this.state, privateState);
    const res = await contract.impureCircuits.revoke(ctx, id);
    return this.commit(res.context);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private commit(context: any): CallResult {
    this.state = context.callContext.currentQueryContext.state;
    this.zswap = context.callContext.currentZswapLocalState ?? this.zswap;
    return {
      ledger: this.getLedger(),
      privateState: context.callContext.currentPrivateState as WardenPrivateState
    };
  }
}
