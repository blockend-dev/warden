// Application-level shapes shared between the SDK, agent adapter, and demo UI.

export type PolicyInput = {
  /** Cumulative spending cap over the mandate's lifetime, in the asset's smallest unit. */
  maxAmount: bigint;
  asset: string;
  actionType: string;
  destinationCategory: string;
  /** Unix seconds after which the mandate can no longer authorize anything. */
  expiry: bigint;
  actionCountLimit: bigint;
};

export type ActionRequest = {
  amount: bigint;
  asset: string;
  actionType: string;
  destinationCategory: string;
};

export type MandateStatus = "active" | "paused" | "revoked" | "expired" | "unknown";

/** A selective-disclosure attestation published by the agent: "spend <= ceiling
 * as of action number `atCount`". The real total is never revealed. */
export type SpendAttestation = {
  ceiling: string; // decimal string — bigint-safe over JSON
  atCount: number;
  /** True once more actions have been authorized since the attestation. */
  stale: boolean;
};

/** Safe to display — never the policy itself unless the viewer is the principal. */
export type MandateSummary = {
  id: string; // hex
  status: MandateStatus;
  actionsAuthorized: number;
  /** Current opaque `spentCommitment[id]` value, hex. Real public ledger
   * state — re-randomized on every `authorize`, reveals no amount. Absent
   * for an unregistered id. */
  spentCommitment?: string;
  kind?: "root" | "delegated";
  /** Present on a delegated mandate (the tree shape is public by design). */
  parentId?: string;
  /** This mandate's own flags, before ancestors are considered. */
  paused?: boolean;
  /** Set when the mandate is unusable only because its parent is
   * revoked / paused — its own ledger flags are untouched. */
  blockedByParent?: "revoked" | "paused";
  attestation?: SpendAttestation;
};
