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

// The errors below are specific to a real network-backed `WardenBackend`
// (`apps/web/src/server/preprod-network.ts`) — the simulator has no proof
// server, node, indexer, or wallet to fail independently of the circuit
// logic itself, so `classifyCircuitError` never needs to produce these.

/** Wallet/provider construction, node, or indexer unreachable — includes
 * "still syncing, not ready yet", which surfaces this rather than hanging
 * a request for however long the underlying sync takes. */
export class NetworkUnavailableError extends WardenError {
  constructor(message: string) {
    super(message, "NetworkUnavailableError");
  }
}
/** The proof server rejected or failed to produce a proof for a real
 * circuit call. */
export class ProofGenerationError extends WardenError {
  constructor(message: string) {
    super(message, "ProofGenerationError");
  }
}
/** The server-side wallet doesn't have enough tNight/DUST to pay for this
 * transaction. Judge-facing translation: the demo wallet needs refunding,
 * not a user-facing "try again". */
export class InsufficientBalanceError extends WardenError {
  constructor(message: string) {
    super(message, "InsufficientBalanceError");
  }
}
/** Transaction was submitted but did not finalize within a reasonable
 * window — may still land; the caller should not assume it didn't. */
export class TransactionTimeoutError extends WardenError {
  constructor(message: string) {
    super(message, "TransactionTimeoutError");
  }
}
/** Fee balancing, proving, or submission failed for a reason not covered
 * above — a real transport/infra failure, not a policy rejection. */
export class TransactionFailedError extends WardenError {
  constructor(message: string) {
    super(message, "TransactionFailedError");
  }
}

const NETWORK_PATTERNS: Array<[RegExp, new (message: string) => WardenError]> = [
  [/still (initializing|syncing)/i, NetworkUnavailableError],
  [/not (yet )?ready/i, NetworkUnavailableError],
  [/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network request failed/i, NetworkUnavailableError],
  [/proof server/i, ProofGenerationError],
  [/failed to generate proof|proving failed/i, ProofGenerationError],
  [/insufficient (balance|funds|dust)/i, InsufficientBalanceError],
  [/timed? ?out/i, TransactionTimeoutError]
];

/** Classifies a real network/infra failure — proof server, node, indexer,
 * wallet, fee balancing, submission — into a typed error. Tried *after*
 * `classifyCircuitError`'s assert-message patterns, since those are more
 * specific; this is the catch-all for everything else a live backend can
 * throw that the simulator never could. */
export function classifyNetworkError(cause: unknown): WardenError {
  if (cause instanceof WardenError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  for (const [pattern, ErrorType] of NETWORK_PATTERNS) {
    if (pattern.test(message)) return new ErrorType(message);
  }
  return new TransactionFailedError(message);
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
  // Already classified (e.g. thrown by a WardenBackend that did its own,
  // more specific classification before this ever saw it) — pass it
  // through as-is rather than re-deriving a generic WardenError from its
  // message, which would silently discard the specific type.
  if (cause instanceof WardenError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  for (const [pattern, ErrorType] of PATTERNS) {
    if (pattern.test(message)) return new ErrorType(message);
  }
  return new WardenError(message);
}

/** Classifies an error thrown by a real network-backed `WardenBackend`.
 * Real Preprod calls still fail with the same `failed assert: ...` messages
 * the simulator does (same compiled contract logic) — sometimes wrapped in
 * "Unexpected error executing scoped transaction '<unnamed>': ..." by
 * midnight-js, which these patterns still match as a substring — so circuit
 * assert failures are tried first and get the same specific error types
 * (`PolicyViolationError`, `MandateRevokedError`, ...) either backend
 * throws. Only once none of those match does this fall through to
 * `classifyNetworkError` for genuine infra failures (proof server, node,
 * indexer, wallet, fee balancing) the simulator can never produce. */
export function classifyLiveError(cause: unknown): WardenError {
  if (cause instanceof WardenError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  for (const [pattern, ErrorType] of PATTERNS) {
    if (pattern.test(message)) return new ErrorType(message);
  }
  return classifyNetworkError(cause);
}
