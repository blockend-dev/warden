// Warden's private state and witness implementations.
//
// Everything in this file lives off-chain, in whichever process (browser tab,
// CLI, agent runtime) is acting as a principal or an agent for one or more
// mandates. None of it is transmitted to the network as-is; circuits in
// warden.compact read it through the witness calls below, re-derive the
// public mandate id from it, and reject the call if it does not match — so
// nothing here is a trust boundary, it is just local storage. See
// docs/THREAT-MODEL.md, "witness output is untrusted".

import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { Ledger } from "./managed/contract/index.js";
import type { MandateContext } from "./types.js";

/**
 * Everything one local session knows about one mandate. A session holds
 * `principalSecret` if it created the mandate, `agentSecret` if it was handed
 * the mandate to act under, both if it is testing/demoing both roles at once,
 * and always the shared `context` (policy + both key-commitments) — the
 * out-of-band "capability handoff" described in docs/ARCHITECTURE.md.
 */
export type MandateRecord = {
  readonly context: MandateContext;
  readonly principalSecret?: Uint8Array;
  readonly agentSecret?: Uint8Array;
  /** Cumulative amount authorized so far, as last confirmed on-chain. */
  readonly spentTotal: bigint;
  /** The nonce behind the *currently on-chain* spend commitment. */
  readonly spentNonce: Uint8Array;
  /**
   * Set by the `freshNonce` witness while an `authorize` call is in flight,
   * cleared once the SDK confirms the call landed. Never read by any circuit
   * assertion directly — it exists only so the SDK can learn, after the
   * fact, which nonce the circuit actually used, and fold it into
   * `spentNonce`. See `packages/sdk/src/mandate.ts`, `finalizeAuthorize`.
   */
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

/**
 * The witnesses object passed to `new Contract(witnesses)`. Every function
 * here is untrusted by the circuit that calls it — each return value is
 * re-checked against public commitments inside warden.compact before it is
 * relied on for anything. A malicious or buggy implementation of this object
 * can only ever fail a proof, never forge an unauthorized action: that
 * guarantee lives in the circuit, not here.
 */
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

  // Fresh randomness for the next spend-commitment nonce (see
  // `spendCommitment` in warden.compact — chaining a fresh nonce into every
  // update is what keeps consecutive on-chain commitments unlinkable).
  // Stashes the value it generated onto the record as `pendingNonce` so the
  // SDK can pick it up once it knows the call actually succeeded; see
  // `finalizeAuthorize` in the SDK for the other half of this handshake.
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
