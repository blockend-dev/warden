// Turns a raw circuit `assert` failure (a thrown Error whose message is one
// of the fixed string literals in warden.compact) into a typed error the
// rest of the SDK, the agent adapter, and the UI can branch on without
// regexing strings themselves. See docs/THREAT-MODEL.md, attack #10: every
// message here is one of the fixed literals from the contract — never a
// private value, by construction of the contract itself.

export class WardenError extends Error {
  constructor(message: string, name: string = "WardenError") {
    super(message);
    // Deliberately NOT `new.target.name`: a production bundler (verified
    // against a real `next build` — see docs/IMPLEMENTATION-NOTES.md) is
    // free to rename classes for size, which silently turned every error's
    // `.name` into a single mangled letter and broke any `error.name`-based
    // branching downstream. Each subclass below passes its own fixed
    // string, which minification cannot touch.
    this.name = name;
  }
}

export class MandateNotFoundError extends WardenError {
  constructor(message: string) {
    super(message, "MandateNotFoundError");
  }
}
export class MandateAlreadyExistsError extends WardenError {
  constructor(message: string) {
    super(message, "MandateAlreadyExistsError");
  }
}
export class MandateRevokedError extends WardenError {
  constructor(message: string) {
    super(message, "MandateRevokedError");
  }
}
export class MandateExpiredError extends WardenError {
  constructor(message: string) {
    super(message, "MandateExpiredError");
  }
}
/** The requested action failed one or more mandate clauses (cap, asset,
 * action type, destination category, or action-count limit). Deliberately
 * one error type for all of these — see docs/PRIVACY.md on why Warden does
 * not report *which* private headroom was exceeded. */
export class PolicyViolationError extends WardenError {
  constructor(message: string) {
    super(message, "PolicyViolationError");
  }
}
/** The caller could not prove the role (principal/agent) it claimed for this
 * mandate, or the supplied context does not match the mandate's public id. */
export class NotAuthorizedError extends WardenError {
  constructor(message: string) {
    super(message, "NotAuthorizedError");
  }
}
export class StaleStateError extends WardenError {
  constructor(message: string) {
    super(message, "StaleStateError");
  }
}

const PATTERNS: Array<[RegExp, new (message: string) => WardenError]> = [
  // Thrown by a witness (see packages/contracts/src/witnesses.ts), before
  // the circuit even runs, when this session was never handed a mandate's
  // private context at all. Same bucket as a wrong-secret rejection from the
  // caller's point of view: "you cannot prove you're authorized here."
  [/no local record for mandate/, NotAuthorizedError],
  [/already exists/, MandateAlreadyExistsError],
  [/unknown mandate/, MandateNotFoundError],
  [/already revoked/, MandateRevokedError],
  [/mandate revoked/, MandateRevokedError],
  [/expired/, MandateExpiredError],
  [/stale or forged spend state/, StaleStateError],
  [/exceeds mandate cap/, PolicyViolationError],
  [/not permitted by mandate/, PolicyViolationError],
  [/action count limit reached/, PolicyViolationError],
  [/action count limit must be positive/, PolicyViolationError],
  [/does not match its public id/, NotAuthorizedError],
  [/principal secret/, NotAuthorizedError],
  [/agent secret/, NotAuthorizedError],
  [/authorized agent/, NotAuthorizedError],
  [/caller is not/, NotAuthorizedError]
];

export function classifyCircuitError(cause: unknown): WardenError {
  const message = cause instanceof Error ? cause.message : String(cause);
  for (const [pattern, ErrorType] of PATTERNS) {
    if (pattern.test(message)) return new ErrorType(message);
  }
  return new WardenError(message);
}
