// Test/SDK-facing simulator for the Warden contract, following the same
// pattern Midnight's own official examples use for unit testing (see
// `docs/IMPLEMENTATION-NOTES.md` — this mirrors `example-counter`'s
// `CounterSimulator` and `example-bboard`'s `BBoardSimulator`, updated for
// the current, async `@midnight-ntwrk/compact-runtime@0.19.0` API, which
// this file's construction was empirically verified against before being
// written this way).
//
// No Docker, no proof server, no network: `contract.impureCircuits.*` runs
// the real compiled circuit logic (including every `assert`) in-process.
// A rejected call throws — callers should expect that and catch it, exactly
// as the deployed contract will reject an invalid transaction.

import {
  type CircuitContext,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, pureCircuits, type Ledger } from "../managed/warden/contract/index.js";
import {
  emptyWardenPrivateState,
  witnesses,
  withMandate,
  type MandateRecord,
  type WardenPrivateState
} from "../witnesses.js";

export class WardenSimulator {
  readonly contract: Contract<WardenPrivateState>;
  circuitContext!: CircuitContext<WardenPrivateState>;

  private constructor() {
    this.contract = new Contract<WardenPrivateState>(witnesses);
  }

  static async create(privateState: WardenPrivateState = emptyWardenPrivateState()): Promise<WardenSimulator> {
    const sim = new WardenSimulator();
    const ctor = await sim.contract.initialState(createConstructorContext(privateState, "0".repeat(64)));
    sim.circuitContext = createCircuitContext(
      "createMandate",
      sampleContractAddress(),
      ctor.currentZswapLocalState,
      ctor.currentContractState,
      ctor.currentPrivateState
    );
    return sim;
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.callContext.currentQueryContext.state);
  }

  getPrivateState(): WardenPrivateState {
    return this.circuitContext.callContext.currentPrivateState as WardenPrivateState;
  }

  /** Seeds a mandate record into local private state without touching the ledger. */
  seedMandate(id: Uint8Array, record: MandateRecord): void {
    const nextPs = withMandate(this.getPrivateState(), id, record);
    this.circuitContext = {
      ...this.circuitContext,
      callContext: { ...this.circuitContext.callContext, currentPrivateState: nextPs }
    };
  }

  async createMandate(id: Uint8Array): Promise<Ledger> {
    const res = await this.contract.impureCircuits.createMandate(this.circuitContext, id);
    this.circuitContext = res.context;

    // Same fold as `authorize`: `createMandate` also draws a fresh nonce (for
    // the mandate's initial spend commitment, total = 0) via the `freshNonce`
    // witness. Confirm it into `spentNonce` now that the call has succeeded.
    const ps = this.getPrivateState();
    const key = Buffer.from(id).toString("hex");
    const rec = ps.mandates[key];
    if (rec?.pendingNonce) {
      this.seedMandate(id, { ...rec, spentTotal: 0n, spentNonce: rec.pendingNonce, pendingNonce: undefined });
    }
    return this.getLedger();
  }

  async authorize(
    id: Uint8Array,
    requestedAmount: bigint,
    requestedAsset: Uint8Array,
    requestedActionType: Uint8Array,
    requestedDestinationCategory: Uint8Array,
    currentTime: bigint
  ): Promise<Ledger> {
    const res = await this.contract.impureCircuits.authorize(
      this.circuitContext,
      id,
      requestedAmount,
      requestedAsset,
      requestedActionType,
      requestedDestinationCategory,
      currentTime
    );
    this.circuitContext = res.context;

    // Fold the pending spend-commitment nonce the `freshNonce` witness
    // stashed during this call into confirmed state, now that we know the
    // call actually succeeded. Mirrors what `packages/sdk` does after a real
    // network submission confirms. See `docs/ARCHITECTURE.md` §5.
    const ps = this.getPrivateState();
    const key = Buffer.from(id).toString("hex");
    const rec = ps.mandates[key];
    if (rec?.pendingNonce) {
      this.seedMandate(id, {
        ...rec,
        spentTotal: rec.spentTotal + requestedAmount,
        spentNonce: rec.pendingNonce,
        pendingNonce: undefined
      });
    }
    return this.getLedger();
  }

  async revoke(id: Uint8Array): Promise<Ledger> {
    const res = await this.contract.impureCircuits.revoke(this.circuitContext, id);
    this.circuitContext = res.context;
    return this.getLedger();
  }
}

export { pureCircuits };
