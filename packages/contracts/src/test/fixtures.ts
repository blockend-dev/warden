// Deterministic mandate-building helpers for warden.test.ts.

import { pureCircuits } from "../managed/warden/contract/index.js";
import type { MandateRecord, WardenPrivateState } from "../witnesses.js";

/** Left-pads a UTF-8 string into a fixed 32-byte category tag. */
export const category = (s: string): Uint8Array => {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length > 32) throw new Error(`category "${s}" is longer than 32 bytes`);
  const out = new Uint8Array(32);
  out.set(bytes);
  return out;
};

export const randomBytes32 = (fill?: number): Uint8Array => {
  const b = new Uint8Array(32);
  if (fill !== undefined) {
    b.fill(fill);
  } else {
    globalThis.crypto.getRandomValues(b);
  }
  return b;
};

export type PolicyInput = {
  maxAmount: bigint;
  asset: string;
  actionType: string;
  destinationCategory: string;
  expiry: bigint;
  actionCountLimit: bigint;
  salt?: Uint8Array;
};

export const buildMandate = (
  principalSecretSeed: number,
  agentSecretSeed: number,
  policyInput: PolicyInput
) => {
  const principalSecret = randomBytes32(principalSecretSeed);
  const agentSecret = randomBytes32(agentSecretSeed);
  const principalPk = pureCircuits.pkOf(principalSecret);
  const agentPk = pureCircuits.pkOf(agentSecret);

  const policy = {
    maxAmount: policyInput.maxAmount,
    asset: category(policyInput.asset),
    actionType: category(policyInput.actionType),
    destinationCategory: category(policyInput.destinationCategory),
    expiry: policyInput.expiry,
    actionCountLimit: policyInput.actionCountLimit,
    salt: policyInput.salt ?? randomBytes32()
  };

  const context = { principalPk, agentPk, policy };
  const id = pureCircuits.mandateId(context);

  // spentNonce is a placeholder; createMandate's freshNonce call sets the
  // real one, and WardenSimulator overwrites it after that call succeeds.
  const record: MandateRecord = {
    context,
    principalSecret,
    agentSecret,
    spentTotal: 0n,
    spentNonce: new Uint8Array(32)
  };

  return { id, context, record, principalSecret, agentSecret };
};

export const seedPrivateState = (record: MandateRecord, id: Uint8Array): WardenPrivateState => ({
  mandates: { [Buffer.from(id).toString("hex")]: record }
});

/** Builds a delegated (child) mandate carved out of `parent`. The delegating
 * agent is the parent's agent, so the child's principal secret is the
 * parent's agent secret; `subAgentSeed` seeds the new sub-agent. */
export const buildDelegated = (
  parent: ReturnType<typeof buildMandate>,
  subAgentSeed: number,
  policyInput: Partial<PolicyInput> & { maxAmount: bigint },
  overrides: { parentId?: Uint8Array } = {}
) => {
  const subAgentSecret = randomBytes32(subAgentSeed);
  const parentId = overrides.parentId ?? parent.id;
  const principalPk = parent.context.agentPk;
  const agentPk = pureCircuits.pkOf(subAgentSecret);

  const policy = {
    maxAmount: policyInput.maxAmount,
    asset: policyInput.asset !== undefined ? category(policyInput.asset) : parent.context.policy.asset,
    actionType: policyInput.actionType !== undefined ? category(policyInput.actionType) : parent.context.policy.actionType,
    destinationCategory:
      policyInput.destinationCategory !== undefined
        ? category(policyInput.destinationCategory)
        : parent.context.policy.destinationCategory,
    expiry: policyInput.expiry ?? parent.context.policy.expiry,
    actionCountLimit: policyInput.actionCountLimit ?? 3n,
    salt: policyInput.salt ?? randomBytes32()
  };

  const childCtx = { parentId, principalPk, agentPk, policy };
  const id = pureCircuits.delegatedMandateId(childCtx);

  const record: MandateRecord = {
    context: { principalPk, agentPk, policy },
    parentId,
    principalSecret: parent.agentSecret,
    agentSecret: subAgentSecret,
    spentTotal: 0n,
    spentNonce: new Uint8Array(32)
  };
  return { id, record, subAgentSecret, parentId };
};
