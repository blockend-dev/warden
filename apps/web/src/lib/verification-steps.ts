// Maps an `authorize` outcome onto the exact assertion order inside
// `authorize` in warden.compact. When a call fails, the failing step is
// determined from the SDK's typed error (see @warden/sdk `errors.ts`),
// itself derived from which circuit `assert` actually rejected the proof —
// this is a display of the real check order, not an invented animation.

export type StepState = "pass" | "fail" | "pending";
export type Step = { label: string; state: StepState };

// Errors a real network-backed WardenBackend can throw that never come from
// the circuit's own check order — a dead proof server or node has nothing
// to do with "was the mandate found" / "is it within cap". Showing the
// step checklist for one of these would misattribute an infra failure to a
// specific (wrong) circuit assertion, so callers should check
// `isNetworkErrorKind` first and render a distinct notice instead of
// `stepsForOutcome`.
const NETWORK_ERROR_KINDS = new Set([
  "NetworkUnavailableError",
  "ProofGenerationError",
  "InsufficientBalanceError",
  "TransactionTimeoutError",
  "TransactionFailedError"
]);

export function isNetworkErrorKind(kind: string): boolean {
  return NETWORK_ERROR_KINDS.has(kind);
}

export const AUTHORIZE_STEPS = [
  "Mandate located",
  "Not revoked",
  "Agent identity verified",
  "Not expired",
  "Action matches policy",
  "Within spend cap & action limit",
  "Commitment advanced"
] as const;

/** Index (0-based) of the step a given SDK error kind/message corresponds to. */
export function failingStepIndex(kind: string, message: string): number {
  switch (kind) {
    case "MandateNotFoundError":
      return 0;
    case "MandateRevokedError":
      return 1;
    case "NotAuthorizedError":
      return 2;
    case "MandateExpiredError":
      return 3;
    case "PolicyViolationError":
      if (/not permitted by mandate/.test(message)) return 4;
      return 5; // action count limit, or cap
    case "StaleStateError":
      return 5;
    default:
      return 0;
  }
}

export function stepsForOutcome(outcome: { authorized: true } | { authorized: false; kind: string; message: string }): Step[] {
  if (outcome.authorized) {
    return AUTHORIZE_STEPS.map((label) => ({ label, state: "pass" as const }));
  }
  const failAt = failingStepIndex(outcome.kind, outcome.message);
  return AUTHORIZE_STEPS.map((label, i) => ({
    label,
    state: i < failAt ? "pass" : i === failAt ? "fail" : "pending"
  }));
}
