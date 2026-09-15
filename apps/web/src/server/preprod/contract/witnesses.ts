// Copy of `infra/devnet/deploy-script-legacy/contract/src/witnesses.ts`,
// itself structurally identical to `packages/contracts/src/witnesses.ts`
// (same warden.compact source, same hand-written witness shape).
// Duplicated, not imported across directories, so `apps/web`'s server
// bundle stays self-contained — see `managed/` in this directory.
//
// Everything in this file lives off-chain, in whichever process is acting
// as a principal or an agent for one or more mandates. None of it is
// transmitted to the network as-is; circuits in warden.compact read it
// through the witness calls below and reject the call if the re-derived
// public commitment does not match — nothing here is a trust boundary, it
// is just local storage. See docs/THREAT-MODEL.md, "witness output is
// untrusted".

import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { Ledger } from "./managed/contract/index.js";
import type { MandateContext } from "./types";

export type MandateRecord = {
  readonly context: MandateContext;
  readonly principalSecret?: Uint8Array;
  readonly agentSecret?: Uint8Array;
  /** Cumulative amount authorized so far, as last confirmed on-chain. */
  readonly spentTotal: bigint;
  /** The nonce behind the *currently on-chain* spend commitment. */
  readonly spentNonce: Uint8Array;
  /** Set by the `freshNonce` witness while an `authorize` call is in
   * flight, cleared once the caller confirms the call landed. */
  readonly pendingNonce?: Uint8Array;
};

export type WardenPrivateState = {
  readonly mandates: Readonly<Record<string, MandateRecord>>;
};

export const emptyWardenPrivateState = (): WardenPrivateState => ({ mandates: {} });

export const idHex = (id: Uint8Array): string => Buffer.from(id).toString("hex");

export const withMandate = (state: WardenPrivateState, id: Uint8Array, record: MandateRecord): WardenPrivateState => ({
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
  principalSecret: ({ privateState }: WitnessContext<Ledger, WardenPrivateState>, id: Uint8Array): [WardenPrivateState, Uint8Array] => {
    const rec = requireRecord(privateState, id);
    if (!rec.principalSecret) throw new Error("Warden: this session does not hold the principal secret for this mandate.");
    return [privateState, rec.principalSecret];
  },

  agentSecret: ({ privateState }: WitnessContext<Ledger, WardenPrivateState>, id: Uint8Array): [WardenPrivateState, Uint8Array] => {
    const rec = requireRecord(privateState, id);
    if (!rec.agentSecret) throw new Error("Warden: this session does not hold the agent secret for this mandate.");
    return [privateState, rec.agentSecret];
  },

  mandateContextOf: ({ privateState }: WitnessContext<Ledger, WardenPrivateState>, id: Uint8Array): [WardenPrivateState, MandateContext] => {
    const rec = requireRecord(privateState, id);
    return [privateState, rec.context];
  },

  spentSoFar: ({ privateState }: WitnessContext<Ledger, WardenPrivateState>, id: Uint8Array): [WardenPrivateState, bigint] => {
    const rec = requireRecord(privateState, id);
    return [privateState, rec.spentTotal];
  },

  spentNonce: ({ privateState }: WitnessContext<Ledger, WardenPrivateState>, id: Uint8Array): [WardenPrivateState, Uint8Array] => {
    const rec = requireRecord(privateState, id);
    return [privateState, rec.spentNonce];
  },

  freshNonce: ({ privateState }: WitnessContext<Ledger, WardenPrivateState>, id: Uint8Array): [WardenPrivateState, Uint8Array] => {
    const rec = requireRecord(privateState, id);
    const nonce = randomBytes32();
    const nextState = withMandate(privateState, id, { ...rec, pendingNonce: nonce });
    return [nextState, nonce];
  }
};
