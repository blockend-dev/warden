export { createWarden, WardenClient, type DelegateParams, type CreateMandateParams, type CreateWardenOptions, type MandateHandoff, type WardenRole } from "./client.js";
export { createIdentity, identityFromSecret, type Identity } from "./identity.js";
export { LocalSimulatorNetwork, type LiveEvidence, type WardenBackend, type CircuitName, type CallResult } from "./network.js";
export {
  WardenError,
  MandateNotFoundError,
  MandateAlreadyExistsError,
  MandateRevokedError,
  MandateExpiredError,
  PolicyViolationError,
  NotAuthorizedError,
  StaleStateError,
  DelegationError,
  MandatePausedError,
  AttestationError,
  NetworkUnavailableError,
  ProofGenerationError,
  InsufficientBalanceError,
  TransactionTimeoutError,
  TransactionFailedError,
  classifyCircuitError,
  classifyNetworkError,
  classifyLiveError
} from "./errors.js";
export type { PolicyInput, ActionRequest, MandateSummary, MandateStatus, SpendAttestation } from "@warden/shared";
export { runAttackSuite, runSwarm, SCENARIO_COUNT, type ScenarioResult, type SwarmEvent, type SwarmResult } from "./lab.js";
