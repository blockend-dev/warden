// Maps an `authorize` / `authorizeDelegated` outcome onto the exact assertion
// order inside those circuits in warden.compact. When a call fails, the
// failing step is derived from the circuit's own assert message (surfaced
// through the SDK's typed error) — a display of the real check order, not an
// invented animation. The circuit reports one outcome per call, not a trace.

export type StepState = "pass" | "fail" | "pending";
export type Step = { label: string; state: StepState };
export type MandateKind = "root" | "delegated";

// Errors a real network-backed WardenBackend can throw that never come from
// the circuit's own check order — a dead proof server or node has nothing
// to do with "was the mandate found" / "is it within cap". Showing the
// step checklist for one of these would misattribute an infra failure to a
// specific (wrong) circuit assertion, so callers should check
// `isNetworkErrorKind` first and render a distinct notice instead.
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

/** Order of the asserts in `authorize`. */
export const ROOT_STEPS = [
  "Mandate located",
  "Not revoked",
  "Not paused",
  "Agent identity verified",
  "Not expired",
  "Action matches policy",
  "Within spend cap & action limit",
  "Commitment advanced"
] as const;

/** Order of the asserts in `authorizeDelegated`. */
export const DELEGATED_STEPS = [
  "Mandate located",
  "Is a delegated mandate",
  "Itself not revoked or paused",
  "Sub-agent identity verified",
  "Parent not revoked or paused (live check)",
  "Not expired",
  "Action matches inherited policy",
  "Within child cap & action limit",
  "Commitment advanced"
] as const;

export const AUTHORIZE_STEPS = ROOT_STEPS;

/** Index (0-based) of the step a given circuit refusal corresponds to. */
export function failingStepIndex(kind: MandateKind, errorKind: string, message: string): number {
  const m = message.toLowerCase();
  if (kind === "root") {
    if (/unknown mandate/.test(m)) return 0;
    if (/mandate revoked/.test(m)) return 1;
    if (/paused/.test(m)) return 2;
    if (/public id|authorized agent|agent secret|no local record/.test(m)) return 3;
    if (/expired/.test(m)) return 4;
    if (/not permitted/.test(m)) return 5;
    return 6; // cap, action count, stale/forged spend state
  }
  if (/unknown mandate/.test(m)) return 0;
  if (/not a delegated/.test(m)) return 1;
  if (/parent mandate (revoked|paused)/.test(m)) return 4;
  if (/mandate revoked|paused/.test(m)) return 2;
  if (/public id|sub-agent|agent secret|no local record/.test(m)) return 3;
  if (/expired/.test(m)) return 5;
  if (/not permitted/.test(m)) return 6;
  void errorKind;
  return 7;
}

export function stepsForOutcome(
  outcome: { authorized: true } | { authorized: false; kind: string; message: string },
  kind: MandateKind = "root"
): Step[] {
  const labels = kind === "root" ? ROOT_STEPS : DELEGATED_STEPS;
  if (outcome.authorized) {
    return labels.map((label) => ({ label, state: "pass" as const }));
  }
  const failAt = failingStepIndex(kind, outcome.kind, outcome.message);
  return labels.map((label, i) => ({
    label,
    state: i < failAt ? "pass" : i === failAt ? "fail" : "pending"
  }));
}
