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

export type MandateStatus = "active" | "revoked" | "expired" | "unknown";

/** Safe to display — never the policy itself unless the viewer is the principal. */
export type MandateSummary = {
  id: string; // hex
  status: MandateStatus;
  actionsAuthorized: number;
};
