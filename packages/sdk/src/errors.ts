// Classifies a raw circuit assert failure into a typed error callers can
// branch on instead of regexing messages themselves.

export class WardenError extends Error {
  constructor(message: string, name: string = "WardenError") {
    super(message);
    // Not `new.target.name`: bundler minification renames classes and
    // silently breaks name-based branching downstream.
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
/** Cap, asset, action type, destination, or action-count violation. */
export class PolicyViolationError extends WardenError {
  constructor(message: string) {
    super(message, "PolicyViolationError");
  }
}
/** Caller couldn't prove the claimed role, or its context doesn't match the id. */
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
  [/no local record for mandate/, NotAuthorizedError],
  [/already exists/, MandateAlreadyExistsError],
  [/unknown mandate/, MandateNotFoundError],
  [/already revoked/, MandateRevokedError],
  [/mandate revoked/, MandateRevokedError],
  [/mandate expired/, MandateExpiredError],
  [/expiry must be in the future/, MandateExpiredError],
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
