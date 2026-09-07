// Private state and witness implementations, run off-chain by whichever
// process acts as principal or agent. Witness output is untrusted — every
// value is re-verified against the mandate's public commitment in
// warden.compact.

import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { Ledger } from "./managed/warden/contract/index.js";
import type { MandateContext } from "./types.js";

export type MandateRecord = {
  readonly context: MandateContext;
  readonly principalSecret?: Uint8Array;
  readonly agentSecret?: Uint8Array;
  readonly spentTotal: bigint;
  readonly spentNonce: Uint8Array;
  // Set by `freshNonce` while a call is in flight, folded into `spentNonce`
  // once the caller confirms the call landed (see client.ts, finalizeAfterCall).
  readonly pendingNonce?: Uint8Array;
};

export type WardenPrivateState = {
  readonly mandates: Readonly<Record<string, MandateRecord>>;
};

export const emptyWardenPrivateState = (): WardenPrivateState => ({ mandates: {} });

export const idHex = (id: Uint8Array): string => Buffer.from(id).toString("hex");

export const withMandate = (
  state: WardenPrivateState,
  id: Uint8Array,
  record: MandateRecord
): WardenPrivateState => ({
  mandates: { ...state.mandates, [idHex(id)]: record }
});

const requireRecord = (state: WardenPrivateState, id: Uint8Array): MandateRecord => {
  const rec = state.mandates[idHex(id)];
  if (!rec) {
    throw new Error(
      `Warden: no local record for mandate ${idHex(id)} in this session's private state. ` +
        "Create it, or import the mandate context before calling authorize/revoke."
    );
  }
  return rec;
};

const randomBytes32 = (): Uint8Array => {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

export const witnesses = {
  principalSecret: (
    { privateState }: WitnessContext<Ledger, WardenPrivateState>,
    id: Uint8Array
  ): [WardenPrivateState, Uint8Array] => {
    const rec = requireRecord(privateState, id);
    if (!rec.principalSecret) {
      throw new Error("Warden: this session does not hold the principal secret for this mandate.");
    }
    return [privateState, rec.principalSecret];
  },

  agentSecret: (
    { privateState }: WitnessContext<Ledger, WardenPrivateState>,
    id: Uint8Array
  ): [WardenPrivateState, Uint8Array] => {
    const rec = requireRecord(privateState, id);
    if (!rec.agentSecret) {
      throw new Error("Warden: this session does not hold the agent secret for this mandate.");
    }
    return [privateState, rec.agentSecret];
  },

  mandateContextOf: (
    { privateState }: WitnessContext<Ledger, WardenPrivateState>,
    id: Uint8Array
  ): [WardenPrivateState, MandateContext] => {
    const rec = requireRecord(privateState, id);
    return [privateState, rec.context];
  },

  spentSoFar: (
    { privateState }: WitnessContext<Ledger, WardenPrivateState>,
    id: Uint8Array
  ): [WardenPrivateState, bigint] => {
    const rec = requireRecord(privateState, id);
    return [privateState, rec.spentTotal];
  },

  spentNonce: (
    { privateState }: WitnessContext<Ledger, WardenPrivateState>,
    id: Uint8Array
  ): [WardenPrivateState, Uint8Array] => {
    const rec = requireRecord(privateState, id);
    return [privateState, rec.spentNonce];
  },

  // Nonce for the next spend commitment; stashed as pendingNonce until the
  // caller confirms the call succeeded.
  freshNonce: (
    { privateState }: WitnessContext<Ledger, WardenPrivateState>,
    id: Uint8Array
  ): [WardenPrivateState, Uint8Array] => {
    const rec = requireRecord(privateState, id);
    const nonce = randomBytes32();
    const nextState = withMandate(privateState, id, { ...rec, pendingNonce: nonce });
    return [nextState, nonce];
  }
};
