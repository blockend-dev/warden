// Test/SDK-facing simulator for the Warden contract, following the same
// pattern Midnight's own official examples use for unit testing (see
// `docs/IMPLEMENTATION-NOTES.md` — this mirrors `example-counter`'s
// `CounterSimulator` and `example-bboard`'s `BBoardSimulator`, updated for
// the current, async `@midnight-ntwrk/compact-runtime@0.19.0` API, which
// this file's construction was empirically verified against before being
// written this way).
//
// A fresh `CircuitContext` is built for every call rather than threaded
// forward, so tests can pin `atTime` deterministically — `authorize` and
// `createMandate` both assert against `blockTimeLte`, which reads whatever
// time the context was built with (verified empirically; see
// docs/IMPLEMENTATION-NOTES.md). No Docker, no proof server, no network:
// `contract.impureCircuits.*` runs the real compiled circuit logic
// (including every `assert`) in-process. A rejected call throws — callers
// should expect that and catch it, exactly as the deployed contract will
// reject an invalid transaction.

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

  /** Folds the pending spend-commitment nonce a `freshNonce` witness call
   * stashed during a just-succeeded call into confirmed state. Mirrors what
   * `packages/sdk`'s `WardenClient` does after a real network call confirms
   * — see `packages/sdk/src/client.ts`, `finalizeAfterCall`. */
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

  /** `atTime`, in Unix seconds, is what `blockTimeLte` inside the circuit
   * sees as "now" — omit it to use the simulator's real wall-clock default. */
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
