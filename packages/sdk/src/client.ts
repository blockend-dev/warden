import {
  emptyWardenPrivateState,
  idHex,
  withMandate,
  type MandateContext,
  type MandateRecord,
  type WardenPrivateState
} from "@warden/contracts";
import { pureCircuits } from "@warden/contracts";
import { encodeCategory, randomBytes32, toHex } from "@warden/shared";
import type { ActionRequest, MandateSummary, PolicyInput } from "@warden/shared";
import { classifyCircuitError } from "./errors.js";
import { createIdentity, type Identity } from "./identity.js";
import { LocalSimulatorNetwork, type LiveEvidence, type WardenBackend } from "./network.js";

export type WardenRole = "principal" | "agent";

export type CreateMandateParams = {
  /** The agent's public-key commitment, handed to the principal out of band. */
  agentPublicKey: Uint8Array;
  policy: PolicyInput;
};

/** Sent from principal to agent out of band; the contract never transmits it. */
export type MandateHandoff = {
  readonly id: Uint8Array;
  readonly context: MandateContext;
  // Nonce behind the mandate's initial spend commitment. Required for the
  // agent's first authorize call to match the on-chain commitment.
  readonly spentNonce: Uint8Array;
  /** Set only by a real network-backed `WardenBackend` (never the simulator)
   * — verifiable proof this call actually reached the chain. */
  readonly evidence?: LiveEvidence;
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

  /** Principal only. Returns the handoff to send to the agent. */
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

    let evidence: LiveEvidence | undefined;
    try {
      const net = await this.network;
      const result = await net.createMandate(this.privateState, id);
      this.privateState = finalizeAfterCall(result.privateState, id, 0n);
      evidence = result.evidence;
    } catch (cause) {
      throw classifyCircuitError(cause);
    }

    const spentNonce = this.privateState.mandates[idHex(id)]?.spentNonce ?? new Uint8Array(32);
    return { id, context, spentNonce, evidence };
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

  /** Agent only. Throws a typed `WardenError` on rejection. Returns
   * verifiable on-chain evidence when the backend is a real network (never
   * the simulator). */
  async authorize(id: Uint8Array, action: ActionRequest): Promise<LiveEvidence | undefined> {
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
      return result.evidence;
    } catch (cause) {
      throw classifyCircuitError(cause);
    }
  }

  /** Principal only. Returns verifiable on-chain evidence when the backend
   * is a real network (never the simulator). */
  async revoke(id: Uint8Array): Promise<LiveEvidence | undefined> {
    try {
      const net = await this.network;
      const result = await net.revoke(this.privateState, id);
      this.privateState = result.privateState;
      return result.evidence;
    } catch (cause) {
      throw classifyCircuitError(cause);
    }
  }

  /** Reads public ledger state; also reports "expired" if this session holds
   * the mandate's context locally (expiry isn't persisted on-chain). */
  async status(id: Uint8Array): Promise<MandateSummary> {
    const net = await this.network;
    const ledger = await net.getLedger();
    const registered = ledger.registered.member(id);
    const revoked = ledger.revoked.member(id);
    const record = this.privateState.mandates[idHex(id)];
    const expired = record !== undefined && BigInt(Math.floor(Date.now() / 1000)) > record.context.policy.expiry;
    return {
      id: idHex(id),
      status: !registered ? "unknown" : revoked ? "revoked" : expired ? "expired" : "active",
      actionsAuthorized: registered ? Number(ledger.actionCount.lookup(id).read()) : 0,
      spentCommitment: registered ? toHex(ledger.spentCommitment.lookup(id)) : undefined
    };
  }
}

export type CreateWardenOptions = {
  role: WardenRole;
  /** Reuses a previously generated identity; this SDK does not persist secrets. */
  identity?: Identity;
  /** Defaults to a process-wide shared `LocalSimulatorNetwork`. */
  network?: WardenBackend | Promise<WardenBackend>;
};

export function createWarden(options: CreateWardenOptions): WardenClient {
  const identity = options.identity ?? createIdentity();
  const network = options.network ?? defaultNetwork();
  return new WardenClient(identity, network);
}
