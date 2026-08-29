// Test fixtures: small, deterministic helpers for building mandate contexts
// so `warden.test.ts` stays focused on behavior rather than byte-encoding.
// `packages/shared` exposes the equivalent encoders for real SDK/UI use.

import { pureCircuits } from "../managed/warden/contract/index.js";
import type { MandateRecord, WardenPrivateState } from "../witnesses.js";

/** Left-pads a UTF-8 string into a fixed 32-byte identifier. Deterministic,
 * not a hash — good enough for an opaque category tag whose only requirement
 * is "the same string always encodes to the same bytes". */
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

  // `spentNonce` here is a placeholder: `createMandate`'s own `freshNonce`
  // witness call determines the mandate's *real* initial spend-commitment
  // nonce when the contract call actually runs. `WardenSimulator.createMandate`
  // overwrites this field with the real one once that call succeeds — see
  // its implementation for why.
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
