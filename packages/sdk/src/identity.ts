import { pureCircuits } from "@warden/contracts";
import { randomBytes32 } from "@warden/shared";

/**
 * A local key-commitment identity: `secret` never leaves the process that
 * generated it (it is passed to circuits only as witness data — see
 * `packages/contracts/src/witnesses.ts`); `publicKey = pkOf(secret)` is safe
 * to hand to a counterparty, exactly the way `principalPk`/`agentPk` are
 * used in `warden.compact`.
 */
export type Identity = {
  readonly secret: Uint8Array;
  readonly publicKey: Uint8Array;
};

export function createIdentity(): Identity {
  const secret = randomBytes32();
  const publicKey = pureCircuits.pkOf(secret);
  return { secret, publicKey };
}

/** Rehydrates an identity from a previously generated secret — e.g. one
 * persisted (by the caller, not this SDK) across sessions. */
export function identityFromSecret(secret: Uint8Array): Identity {
  return { secret, publicKey: pureCircuits.pkOf(secret) };
}
