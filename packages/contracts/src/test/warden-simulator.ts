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

  /** Folds every in-flight `freshNonce` into confirmed state after a
   * successful call (mirrors `client.ts`'s `finalizeAfterCall`). `spends` maps
   * a mandate id to the amount that call debited from it. */
  private confirmNonces(spends: Array<[Uint8Array, bigint]>): void {
    for (const [id, amount] of spends) {
      const rec = this.privateState.mandates[idHex(id)];
      if (!rec?.pendingNonce) continue;
      this.privateState = withMandate(this.privateState, id, {
        ...rec,
        spentTotal: rec.spentTotal + amount,
        spentNonce: rec.pendingNonce,
        pendingNonce: undefined
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async run(circuit: string, atTime: bigint | undefined, args: any[], spends: Array<[Uint8Array, bigint]> = []): Promise<Ledger> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (this.contract.impureCircuits as any)[circuit];
    const res = await fn(this.buildContext(circuit, atTime), ...args);
    this.commit(res.context);
    this.confirmNonces(spends);
    return this.getLedger();
  }

  /** `atTime` (Unix seconds) is what `blockTimeLte` sees as "now"; omit for
   * wall-clock time. */
  createMandate(id: Uint8Array, atTime?: bigint): Promise<Ledger> {
    return this.run("createMandate", atTime, [id], [[id, 0n]]);
  }

  authorize(
    id: Uint8Array,
    requestedAmount: bigint,
    requestedAsset: Uint8Array,
    requestedActionType: Uint8Array,
    requestedDestinationCategory: Uint8Array,
    atTime?: bigint
  ): Promise<Ledger> {
    return this.run("authorize", atTime, [id, requestedAmount, requestedAsset, requestedActionType, requestedDestinationCategory], [[id, requestedAmount]]);
  }

  revoke(id: Uint8Array, atTime?: bigint): Promise<Ledger> {
    return this.run("revoke", atTime, [id]);
  }

  pause(id: Uint8Array, atTime?: bigint): Promise<Ledger> {
    return this.run("pause", atTime, [id]);
  }

  resume(id: Uint8Array, atTime?: bigint): Promise<Ledger> {
    return this.run("resume", atTime, [id]);
  }

  attestSpend(id: Uint8Array, ceiling: bigint, atTime?: bigint): Promise<Ledger> {
    return this.run("attestSpend", atTime, [id, ceiling]);
  }

  /** The parent's agent debits `childCap` from the parent and registers the child. */
  delegate(parentId: Uint8Array, childId: Uint8Array, childCap: bigint, atTime?: bigint): Promise<Ledger> {
    return this.run("delegate", atTime, [parentId, childId], [
      [parentId, childCap],
      [childId, 0n]
    ]);
  }

  authorizeDelegated(
    id: Uint8Array,
    requestedAmount: bigint,
    requestedAsset: Uint8Array,
    requestedActionType: Uint8Array,
    requestedDestinationCategory: Uint8Array,
    atTime?: bigint
  ): Promise<Ledger> {
    return this.run(
      "authorizeDelegated",
      atTime,
      [id, requestedAmount, requestedAsset, requestedActionType, requestedDestinationCategory],
      [[id, requestedAmount]]
    );
  }

  revokeDelegated(id: Uint8Array, atTime?: bigint): Promise<Ledger> {
    return this.run("revokeDelegated", atTime, [id]);
  }
}

export { pureCircuits };
