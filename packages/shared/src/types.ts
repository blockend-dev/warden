// Types shared between the SDK, the agent adapter, and the demo UI. These
// describe *application-level* shapes (human-readable policy input, mandate
// summaries for display) — the contract's own generated types
// (`packages/contracts/src/managed/warden/contract/index.d.ts`) remain the
// source of truth for what actually crosses into a circuit call.

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

export type MandateStatus = "active" | "revoked" | "expired" | "unknown";

/** What's safe to show in a UI: never the policy itself unless the viewer is
 * the mandate's own principal (see docs/PRIVACY.md). */
export type MandateSummary = {
  id: string; // hex
  status: MandateStatus;
  actionsAuthorized: number;
};
