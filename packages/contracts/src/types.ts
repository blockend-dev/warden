// Named equivalents of warden.compact's `Policy`/`MandateContext` structs.
// The compiler emits these as anonymous structural types; naming them here
// gives the rest of the codebase one type to import.

export type Policy = {
  maxAmount: bigint;
  asset: Uint8Array;
  actionType: Uint8Array;
  destinationCategory: Uint8Array;
  expiry: bigint;
  actionCountLimit: bigint;
  salt: Uint8Array;
};

export type MandateContext = {
  principalPk: Uint8Array;
  agentPk: Uint8Array;
  policy: Policy;
};
