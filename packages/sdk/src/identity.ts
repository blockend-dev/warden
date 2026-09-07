import { pureCircuits } from "@warden/contracts";
import { randomBytes32 } from "@warden/shared";

/** `secret` never leaves this process; `publicKey = pkOf(secret)` is safe to
 * share with a counterparty. */
export type Identity = {
  readonly secret: Uint8Array;
  readonly publicKey: Uint8Array;
};

export function createIdentity(): Identity {
  const secret = randomBytes32();
  const publicKey = pureCircuits.pkOf(secret);
  return { secret, publicKey };
}

/** Rehydrates an identity from a previously generated secret. */
export function identityFromSecret(secret: Uint8Array): Identity {
  return { secret, publicKey: pureCircuits.pkOf(secret) };
}
