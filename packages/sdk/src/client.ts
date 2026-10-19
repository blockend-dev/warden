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
import { LocalSimulatorNetwork, type CircuitName, type LiveEvidence, type WardenBackend } from "./network.js";

export type WardenRole = "principal" | "agent";

export type CreateMandateParams = {
  /** The agent's public-key commitment, handed to the principal out of band. */
  agentPublicKey: Uint8Array;
  policy: PolicyInput;
};

/** What a delegating agent narrows when carving a child out of its mandate.
 * Asset, action type and destination are inherited verbatim from the parent
 * (Policy fields are single values, so "narrower" degenerates to "equal"). */
export type DelegateParams = {
  parentId: Uint8Array;
  /** The sub-agent's public-key commitment, handed over out of band. */
  subAgentPublicKey: Uint8Array;
  /** Budget carved out of (and reserved against) the parent's cap. */
  maxAmount: bigint;
  actionCountLimit: bigint;
  /** Defaults to the parent's expiry; may be earlier, never later. */
  expiry?: bigint;
};

/** Sent from principal to agent out of band; the contract never transmits it. */
export type MandateHandoff = {
  readonly id: Uint8Array;
  readonly context: MandateContext;
  // Nonce behind the mandate's initial spend commitment. Required for the
  // agent's first authorize call to match the on-chain commitment.
  readonly spentNonce: Uint8Array;
  /** Set only for a delegated mandate: the parent it was carved from. */
  readonly parentId?: Uint8Array;
  /** Set only by a real network-backed `WardenBackend` (never the simulator)
   * — verifiable proof this call actually reached the chain. */
  readonly evidence?: LiveEvidence;
};

let sharedNetwork: Promise<LocalSimulatorNetwork> | undefined;
function defaultNetwork(): Promise<LocalSimulatorNetwork> {
  if (!sharedNetwork) sharedNetwork = LocalSimulatorNetwork.create();
  return sharedNetwork;
}

/** Folds every in-flight `freshNonce` into confirmed state once the call is
 * known to have landed. `spends` maps a mandate id to the amount that call
 * debited from its committed total. */
function finalizeAfterCall(privateState: WardenPrivateState, spends: Array<[Uint8Array, bigint]>): WardenPrivateState {
  let next = privateState;
  for (const [id, amount] of spends) {
    const rec = next.mandates[idHex(id)];
    if (!rec?.pendingNonce) continue;
    next = withMandate(next, id, {
      ...rec,
      spentTotal: rec.spentTotal + amount,
      spentNonce: rec.pendingNonce,
      pendingNonce: undefined
    });
  }
  return next;
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

  /** Runs one circuit, applies the resulting private state, and classifies
   * any failure into a typed `WardenError`. */
  private async invoke(
    circuit: CircuitName,
    args: unknown[],
    spends: Array<[Uint8Array, bigint]>
  ): Promise<LiveEvidence | undefined> {
    try {
      const net = await this.network;
      const result = await net.call(circuit, this.privateState, args);
      this.privateState = finalizeAfterCall(result.privateState, spends);
      return result.evidence;
    } catch (cause) {
      throw classifyCircuitError(cause);
    }
  }

  private record(id: Uint8Array): MandateRecord | undefined {
    return this.privateState.mandates[idHex(id)];
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

    const before = this.privateState;
    this.privateState = withMandate(this.privateState, id, {
      context,
      principalSecret: this.identity.secret,
      spentTotal: 0n,
      spentNonce: new Uint8Array(32)
    });

    let evidence: LiveEvidence | undefined;
    try {
      evidence = await this.invoke("createMandate", [id], [[id, 0n]]);
    } catch (cause) {
      this.privateState = before;
      throw cause;
    }

    const spentNonce = this.record(id)?.spentNonce ?? new Uint8Array(32);
    return { id, context, spentNonce, evidence };
  }

  /** Agent or sub-agent. Adopts a mandate handed off by its principal. */
  importMandate(handoff: MandateHandoff): void {
    const record: MandateRecord = {
      context: handoff.context,
      agentSecret: this.identity.secret,
      spentTotal: 0n,
      spentNonce: handoff.spentNonce,
      parentId: handoff.parentId
    };
    this.privateState = withMandate(this.privateState, handoff.id, record);
  }

  /** Agent only. Carves a child mandate out of one of this agent's own
   * mandates and reserves its budget against the parent. Returns the handoff
   * to give the sub-agent. */
  async delegate(params: DelegateParams): Promise<MandateHandoff> {
    const parent = this.record(params.parentId);
    if (!parent || !parent.agentSecret) {
      throw classifyCircuitError(
        new Error("Warden: no local record for mandate — this session is not the agent of the parent mandate.")
      );
    }
    const policy = {
      maxAmount: params.maxAmount,
      asset: parent.context.policy.asset,
      actionType: parent.context.policy.actionType,
      destinationCategory: parent.context.policy.destinationCategory,
      expiry: params.expiry ?? parent.context.policy.expiry,
      actionCountLimit: params.actionCountLimit,
      salt: randomBytes32()
    };
    const childCtx = {
      parentId: params.parentId,
      principalPk: this.identity.publicKey,
      agentPk: params.subAgentPublicKey,
      policy
    };
    const id = pureCircuits.delegatedMandateId(childCtx);
    const context: MandateContext = { principalPk: childCtx.principalPk, agentPk: childCtx.agentPk, policy };

    const before = this.privateState;
    this.privateState = withMandate(this.privateState, id, {
      context,
      parentId: params.parentId,
      principalSecret: this.identity.secret,
      spentTotal: 0n,
      spentNonce: new Uint8Array(32)
    });

    let evidence: LiveEvidence | undefined;
    try {
      evidence = await this.invoke(
        "delegate",
        [params.parentId, id],
        [
          [params.parentId, params.maxAmount],
          [id, 0n]
        ]
      );
    } catch (cause) {
      this.privateState = before;
      throw cause;
    }

    const spentNonce = this.record(id)?.spentNonce ?? new Uint8Array(32);
    return { id, context, spentNonce, parentId: params.parentId, evidence };
  }

  /** Agent or sub-agent. Throws a typed `WardenError` on rejection. Picks the
   * root or delegated circuit from what this session knows about `id`.
   * Returns verifiable on-chain evidence when the backend is a real network
   * (never the simulator). */
  authorize(id: Uint8Array, action: ActionRequest): Promise<LiveEvidence | undefined> {
    const circuit: CircuitName = this.record(id)?.parentId ? "authorizeDelegated" : "authorize";
    return this.invoke(
      circuit,
      [id, action.amount, encodeCategory(action.asset), encodeCategory(action.actionType), encodeCategory(action.destinationCategory)],
      [[id, action.amount]]
    );
  }

  /** Principal of the mandate (for a delegated mandate: the delegating
   * agent). Permanent. */
  revoke(id: Uint8Array): Promise<LiveEvidence | undefined> {
    const circuit: CircuitName = this.record(id)?.parentId ? "revokeDelegated" : "revoke";
    return this.invoke(circuit, [id], []);
  }

  /** Principal only. Reversible kill-switch. */
  pause(id: Uint8Array): Promise<LiveEvidence | undefined> {
    return this.invoke("pause", [id], []);
  }

  /** Principal only. */
  resume(id: Uint8Array): Promise<LiveEvidence | undefined> {
    return this.invoke("resume", [id], []);
  }

  /** Agent only. Proves "cumulative spend <= ceiling" against the on-chain
   * commitment and publishes only the ceiling. */
  attestSpend(id: Uint8Array, ceiling: bigint): Promise<LiveEvidence | undefined> {
    return this.invoke("attestSpend", [id, ceiling], []);
  }

  /** What this session holds privately for a mandate it participates in — the
   * agent's own spend total is the one number that is never public. */
  privateSpend(id: Uint8Array): bigint | undefined {
    return this.record(id)?.spentTotal;
  }

  /** ADVERSARY SIMULATION ONLY (used by the Attack Lab and tests). Calls any
   * circuit directly with this session's private state, bypassing the
   * client's own routing — e.g. a delegated id on the Wave 1 `authorize`
   * circuit. The circuit, not this client, is what must refuse. */
  unsafeInvoke(circuit: CircuitName, args: unknown[], spends: Array<[Uint8Array, bigint]> = []): Promise<LiveEvidence | undefined> {
    return this.invoke(circuit, args, spends);
  }

  /** ADVERSARY SIMULATION ONLY. Overwrites the locally remembered spend total
   * for a mandate — what a dishonest agent would do to hide history. The
   * circuit must catch it against the on-chain commitment. */
  tamperPrivateSpend(id: Uint8Array, total: bigint): void {
    const rec = this.record(id);
    if (rec) this.privateState = withMandate(this.privateState, id, { ...rec, spentTotal: total });
  }

  /** Reads public ledger state. Ancestor-aware: a delegated mandate whose
   * parent is revoked or paused reports `revoked` / `paused` even though its
   * own ledger flags are untouched. "expired" is reported only when this
   * session holds the mandate's context locally (expiry is checked against
   * block time in-circuit, not stored on-chain). */
  async status(id: Uint8Array): Promise<MandateSummary> {
    const net = await this.network;
    const ledger = await net.getLedger();
    const registered = ledger.registered.member(id);
    const record = this.record(id);
    const expired = record !== undefined && BigInt(Math.floor(Date.now() / 1000)) > record.context.policy.expiry;

    const isChild = registered && ledger.delegatedFrom.member(id);
    const parentIdBytes = isChild ? ledger.delegatedFrom.lookup(id) : undefined;
    const parentRevoked = parentIdBytes ? ledger.revoked.member(parentIdBytes) : false;
    const parentPaused = parentIdBytes ? ledger.paused.member(parentIdBytes) : false;
    const ownRevoked = registered && ledger.revoked.member(id);
    const ownPaused = registered && ledger.paused.member(id);

    const status = !registered
      ? "unknown"
      : ownRevoked || parentRevoked
        ? "revoked"
        : ownPaused || parentPaused
          ? "paused"
          : expired
            ? "expired"
            : "active";

    const actionsAuthorized = registered ? Number(ledger.actionCount.lookup(id).read()) : 0;
    const attested = registered && ledger.attestedCeiling.member(id);
    const attestedAt = attested ? Number(ledger.attestedAtCount.lookup(id)) : 0;

    return {
      id: idHex(id),
      status,
      actionsAuthorized,
      spentCommitment: registered ? toHex(ledger.spentCommitment.lookup(id)) : undefined,
      kind: isChild ? "delegated" : "root",
      parentId: parentIdBytes ? toHex(parentIdBytes) : undefined,
      paused: ownPaused || undefined,
      blockedByParent: ownRevoked ? undefined : parentRevoked ? "revoked" : parentPaused ? "paused" : undefined,
      attestation: attested
        ? {
            ceiling: ledger.attestedCeiling.lookup(id).toString(),
            atCount: attestedAt,
            stale: actionsAuthorized > attestedAt
          }
        : undefined
    };
  }

  /** Public delegation tree: ids of every mandate delegated directly from
   * `parentId`, in ledger order. Derived from `delegatedFrom`, which is public. */
  async children(parentId: Uint8Array): Promise<string[]> {
    const net = await this.network;
    const ledger = await net.getLedger();
    const target = toHex(parentId);
    const out: string[] = [];
    for (const [child, parent] of ledger.delegatedFrom) {
      if (toHex(parent) === target) out.push(toHex(child));
    }
    return out;
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
