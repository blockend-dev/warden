import {
  emptyWardenPrivateState,
  idHex,
  withMandate,
  type MandateContext,
  type MandateRecord,
  type WardenPrivateState
} from "@warden/contracts";
import { pureCircuits } from "@warden/contracts";
import { encodeCategory, randomBytes32 } from "@warden/shared";
import type { ActionRequest, MandateSummary, PolicyInput } from "@warden/shared";
import { classifyCircuitError } from "./errors.js";
import { createIdentity, type Identity } from "./identity.js";
import { LocalSimulatorNetwork, type WardenBackend } from "./network.js";

export type WardenRole = "principal" | "agent";

export type CreateMandateParams = {
  /** The public-key commitment of the agent this mandate authorizes — the
   * agent generates this locally (`createWarden({ role: "agent" }).publicKey`)
   * and hands it to the principal out of band before the mandate exists. */
  agentPublicKey: Uint8Array;
  policy: PolicyInput;
};

/**
 * Everything an agent needs to act under a mandate the principal created:
 * the public id, and the full private context (policy + both
 * key-commitments). Handed from principal to agent out of band — Warden's
 * contract never transmits this; see docs/ARCHITECTURE.md §7 for the honest
 * limitation this implies in Wave 1.
 */
export type MandateHandoff = {
  readonly id: Uint8Array;
  readonly context: MandateContext;
  /**
   * The nonce actually behind the mandate's on-chain initial spend
   * commitment (`spendCommitment(0, spentNonce)` — see
   * `docs/ARCHITECTURE.md` §5). `createMandate`'s own `freshNonce` witness
   * call decides this value; the agent was not present for that call and so
   * cannot guess it, but needs it to pass the very first `authorize`'s
   * "does the witness's claimed prior state match the on-chain commitment"
   * check. This is real cross-party state the handoff has to carry, not a
   * placeholder — omitting it is a real, reproducible bug (a `StaleState`
   * rejection on an agent's very first authorize call), not a
   * theoretical concern.
   */
  readonly spentNonce: Uint8Array;
};

let sharedNetwork: Promise<LocalSimulatorNetwork> | undefined;
function defaultNetwork(): Promise<LocalSimulatorNetwork> {
  if (!sharedNetwork) sharedNetwork = LocalSimulatorNetwork.create();
  return sharedNetwork;
}

function finalizeAfterCall(
  privateState: WardenPrivateState,
  id: Uint8Array,
  amountJustSpent: bigint
): WardenPrivateState {
  const rec = privateState.mandates[idHex(id)];
  if (!rec?.pendingNonce) return privateState;
  return withMandate(privateState, id, {
    ...rec,
    spentTotal: rec.spentTotal + amountJustSpent,
    spentNonce: rec.pendingNonce,
    pendingNonce: undefined
  });
}

export class WardenClient {
  private readonly identity: Identity;
  private readonly network: Promise<WardenBackend>;
  private privateState: WardenPrivateState = emptyWardenPrivateState();

  constructor(identity: Identity, network: WardenBackend | Promise<WardenBackend>) {
    this.identity = identity;
    this.network = Promise.resolve(network);
  }

  /** Safe to share with a counterparty — see `Identity` in `identity.ts`. */
  get publicKey(): Uint8Array {
    return this.identity.publicKey;
  }

  /** Principal only. Creates a new mandate and returns the `MandateHandoff`
   * to send to the agent out of band. */
  async createMandate(params: CreateMandateParams): Promise<MandateHandoff> {
    const policy = {
      maxAmount: params.policy.maxAmount,
      asset: encodeCategory(params.policy.asset),
      actionType: encodeCategory(params.policy.actionType),
      destinationCategory: encodeCategory(params.policy.destinationCategory),
      expiry: params.policy.expiry,
      actionCountLimit: params.policy.actionCountLimit,
      salt: randomBytes32()
    };
    const context: MandateContext = {
      principalPk: this.identity.publicKey,
      agentPk: params.agentPublicKey,
      policy
    };
    const id = pureCircuits.mandateId(context);

    const record: MandateRecord = {
      context,
      principalSecret: this.identity.secret,
      spentTotal: 0n,
      spentNonce: new Uint8Array(32)
    };
    this.privateState = withMandate(this.privateState, id, record);

    try {
      const net = await this.network;
      const result = await net.createMandate(this.privateState, id);
      this.privateState = finalizeAfterCall(result.privateState, id, 0n);
    } catch (cause) {
      throw classifyCircuitError(cause);
    }

    const spentNonce = this.privateState.mandates[idHex(id)]?.spentNonce ?? new Uint8Array(32);
    return { id, context, spentNonce };
  }

  /** Agent only. Adopts a mandate handed off by its principal. */
  importMandate(handoff: MandateHandoff): void {
    const record: MandateRecord = {
      context: handoff.context,
      agentSecret: this.identity.secret,
      spentTotal: 0n,
      spentNonce: handoff.spentNonce
    };
    this.privateState = withMandate(this.privateState, handoff.id, record);
  }

  /** Agent only. Throws a typed `WardenError` (see `errors.ts`) rather than
   * resolving falsy — callers should treat any rejection as "blocked", not
   * inspect a boolean. Expiry is checked by the circuit itself against the
   * ledger's own block time (`blockTimeLte` — see `warden.compact`), not a
   * value this SDK supplies, so there is nothing to pass or forge here. */
  async authorize(id: Uint8Array, action: ActionRequest): Promise<void> {
    try {
      const net = await this.network;
      const result = await net.authorize(
        this.privateState,
        id,
        action.amount,
        encodeCategory(action.asset),
        encodeCategory(action.actionType),
        encodeCategory(action.destinationCategory)
      );
      this.privateState = finalizeAfterCall(result.privateState, id, action.amount);
    } catch (cause) {
      throw classifyCircuitError(cause);
    }
  }

  /** Principal only. */
  async revoke(id: Uint8Array): Promise<void> {
    try {
      const net = await this.network;
      const result = await net.revoke(this.privateState, id);
      this.privateState = result.privateState;
    } catch (cause) {
      throw classifyCircuitError(cause);
    }
  }

  /** Reads public ledger state (safe for anyone to call), plus this
   * session's own locally-held mandate context if it has one, to also
   * report `"expired"`. `expiry` is disclosed only as a transaction
   * argument on `createMandate`/`authorize` (see `warden.compact`), not
   * persisted anywhere in ledger state itself — a caller with no local
   * record of the mandate (a third party that was never handed its context)
   * cannot distinguish "active" from "expired" from public state alone, and
   * `status()` correctly reports "active" for them either way rather than
   * guessing. */
  async status(id: Uint8Array): Promise<MandateSummary> {
    const net = await this.network;
    const ledger = net.getLedger();
    const registered = ledger.registered.member(id);
    const revoked = ledger.revoked.member(id);
    const record = this.privateState.mandates[idHex(id)];
    const expired = record !== undefined && BigInt(Math.floor(Date.now() / 1000)) > record.context.policy.expiry;
    return {
      id: idHex(id),
      status: !registered ? "unknown" : revoked ? "revoked" : expired ? "expired" : "active",
      actionsAuthorized: registered ? Number(ledger.actionCount.lookup(id).read()) : 0
    };
  }
}

export type CreateWardenOptions = {
  role: WardenRole;
  /** Reuses a previously generated identity (e.g. restored from wherever the
   * caller persists it — this SDK does not persist secrets itself). */
  identity?: Identity;
  /** Defaults to a process-wide shared `LocalSimulatorNetwork` so that, in a
   * single demo process, a principal's and an agent's `createWarden(...)`
   * calls transact against the same ledger without wiring it up explicitly.
   * Pass an explicit network (or a real `WardenBackend`, once one exists) to
   * opt out. */
  network?: WardenBackend | Promise<WardenBackend>;
};

export function createWarden(options: CreateWardenOptions): WardenClient {
  const identity = options.identity ?? createIdentity();
  const network = options.network ?? defaultNetwork();
  return new WardenClient(identity, network);
}
