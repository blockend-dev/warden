// Named TypeScript equivalents of warden.compact's `Policy` and
// `MandateContext` structs.
//
// Compact does not export a struct as a standalone named type in the
// compiler's generated `.d.ts` — every place a struct is used (a witness
// signature, a pure-circuit signature) gets its own structurally-identical
// anonymous object-literal type instead (verified against the real compiler
// output). These two types exist purely
// so the rest of the TypeScript codebase has one name to import instead of
// repeating the inline shape everywhere — they are structurally, not
// nominally, checked against the generated types, so if `warden.compact`'s
// structs ever change, a mismatch here surfaces as a type error at the call
// sites in `witnesses.ts`, not a silent drift.

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
