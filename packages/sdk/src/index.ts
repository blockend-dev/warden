export { createWarden, WardenClient, type CreateMandateParams, type CreateWardenOptions, type MandateHandoff, type WardenRole } from "./client.js";
export { createIdentity, identityFromSecret, type Identity } from "./identity.js";
export { LocalSimulatorNetwork, type LiveEvidence, type WardenBackend } from "./network.js";
export {
  WardenError,
  MandateNotFoundError,
  MandateAlreadyExistsError,
  MandateRevokedError,
  MandateExpiredError,
  PolicyViolationError,
  NotAuthorizedError,
  StaleStateError,
  NetworkUnavailableError,
  ProofGenerationError,
  InsufficientBalanceError,
  TransactionTimeoutError,
  TransactionFailedError,
  classifyCircuitError,
  classifyNetworkError,
  classifyLiveError
} from "./errors.js";
export type { PolicyInput, ActionRequest, MandateSummary, MandateStatus } from "@warden/shared";
