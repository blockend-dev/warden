import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, witnesses, emptyWardenPrivateState, type Ledger, type WardenPrivateState } from "@warden/contracts";

/** Present only on a `WardenBackend` that actually submitted a transaction
 * to a real network (never on `LocalSimulatorNetwork`) — lets callers show
 * a judge/user verifiable on-chain evidence, without every backend having
 * to fabricate placeholder values for it. */
export type LiveEvidence = {
  readonly network: string;
  readonly txId: string;
  readonly blockHeight: number;
  readonly contractAddress: string;
};

type CallResult = { ledger: Ledger; privateState: WardenPrivateState; evidence?: LiveEvidence };

/** Everything a `WardenClient` needs from "the chain", kept narrow so a real
 * network-backed provider is a drop-in replacement.
 *
 * `getLedger` is async because a real network-backed implementation has to
 * query it (an indexer round-trip) — `LocalSimulatorNetwork` just wraps its
 * in-memory state in an already-resolved promise. */
export interface WardenBackend {
  getLedger(): Promise<Ledger>;
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
 * In-process `WardenBackend`: runs the real compiled circuits via
 * `@midnight-ntwrk/compact-runtime`, no proof server or network. Used as the
 * default for local development and as the explicit fallback/dev mode
 * alongside the real `PreprodNetwork`
 * (`apps/web/src/server/preprod/preprod-network.ts`) — see
 * docs/DEPLOYMENT.md for why they're two different compiled artifacts, not
 * one.
 *
 * `state`/`zswap` are the shared public ledger; `privateState` is passed in
 * per call as each party's own state.
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

  async getLedger(): Promise<Ledger> {
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
      ledger: ledger(this.state),
      privateState: context.callContext.currentPrivateState as WardenPrivateState
    };
  }
}
