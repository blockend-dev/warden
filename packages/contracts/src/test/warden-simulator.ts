// In-process simulator: runs the compiled contract via
// @midnight-ntwrk/compact-runtime, no proof server or network. A fresh
// CircuitContext is built per call so tests can pin blockTimeLte's clock
// via `atTime`. A rejected call throws.

import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, pureCircuits, type Ledger } from "../managed/warden/contract/index.js";
import {
  emptyWardenPrivateState,
  witnesses,
  withMandate,
  idHex,
  type MandateRecord,
  type WardenPrivateState
} from "../witnesses.js";

export class WardenSimulator {
  readonly contract: Contract<WardenPrivateState>;
  private readonly address: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque runtime state from @midnight-ntwrk/compact-runtime
  private publicState: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private zswapState: any;
  private privateState: WardenPrivateState;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private constructor(address: string, publicState: any, zswapState: any, privateState: WardenPrivateState) {
    this.contract = new Contract<WardenPrivateState>(witnesses);
    this.address = address;
    this.publicState = publicState;
    this.zswapState = zswapState;
    this.privateState = privateState;
  }

  static async create(privateState: WardenPrivateState = emptyWardenPrivateState()): Promise<WardenSimulator> {
    const bootstrap = new Contract<WardenPrivateState>(witnesses);
    const ctor = await bootstrap.initialState(createConstructorContext(privateState, "0".repeat(64)));
    return new WardenSimulator(
      sampleContractAddress(),
      ctor.currentContractState,
      ctor.currentZswapLocalState,
      ctor.currentPrivateState
    );
  }

  getLedger(): Ledger {
    return ledger(this.publicState);
  }

  getPrivateState(): WardenPrivateState {
    return this.privateState;
  }

  /** Seeds a mandate record into local private state without touching the ledger. */
  seedMandate(id: Uint8Array, record: MandateRecord): void {
    this.privateState = withMandate(this.privateState, id, record);
  }

  private buildContext(circuitId: string, atTime?: bigint) {
    return createCircuitContext(
      circuitId,
      this.address,
      this.zswapState,
      this.publicState,
      this.privateState,
      undefined,
      undefined,
      undefined,
      atTime === undefined ? undefined : Number(atTime)
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private commit(context: any): void {
    this.publicState = context.callContext.currentQueryContext.state;
    this.zswapState = context.callContext.currentZswapLocalState ?? this.zswapState;
    this.privateState = context.callContext.currentPrivateState as WardenPrivateState;
  }

  /** Folds a `freshNonce` call's pending nonce into confirmed state after a
   * successful call (mirrors `client.ts`'s `finalizeAfterCall`). */
  private confirmNonce(id: Uint8Array, amountJustSpent: bigint): void {
    const rec = this.privateState.mandates[idHex(id)];
    if (!rec?.pendingNonce) return;
    this.privateState = withMandate(this.privateState, id, {
      ...rec,
      spentTotal: rec.spentTotal + amountJustSpent,
      spentNonce: rec.pendingNonce,
      pendingNonce: undefined
    });
  }

  /** `atTime` (Unix seconds) is what `blockTimeLte` sees as "now"; omit for
   * wall-clock time. */
  async createMandate(id: Uint8Array, atTime?: bigint): Promise<Ledger> {
    const res = await this.contract.impureCircuits.createMandate(this.buildContext("createMandate", atTime), id);
    this.commit(res.context);
    this.confirmNonce(id, 0n);
    return this.getLedger();
  }

  async authorize(
    id: Uint8Array,
    requestedAmount: bigint,
    requestedAsset: Uint8Array,
    requestedActionType: Uint8Array,
    requestedDestinationCategory: Uint8Array,
    atTime?: bigint
  ): Promise<Ledger> {
    const res = await this.contract.impureCircuits.authorize(
      this.buildContext("authorize", atTime),
      id,
      requestedAmount,
      requestedAsset,
      requestedActionType,
      requestedDestinationCategory
    );
    this.commit(res.context);
    this.confirmNonce(id, requestedAmount);
    return this.getLedger();
  }

  async revoke(id: Uint8Array, atTime?: bigint): Promise<Ledger> {
    const res = await this.contract.impureCircuits.revoke(this.buildContext("revoke", atTime), id);
    this.commit(res.context);
    return this.getLedger();
  }
}

export { pureCircuits };
