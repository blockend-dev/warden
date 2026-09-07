// Wraps an agent framework's tool/effect function so it only runs once
// Warden authorizes the requested action. Framework-agnostic by design.

import type { ActionRequest, WardenClient } from "@warden/sdk";

export type { ActionRequest } from "@warden/sdk";

export type WardenGuardedEffect<TResult> = (action: ActionRequest) => Promise<TResult>;

/** Runs `effect` only after `warden.authorize` succeeds. */
export function guard<TResult>(
  warden: WardenClient,
  mandateId: Uint8Array,
  effect: WardenGuardedEffect<TResult>
): WardenGuardedEffect<TResult> {
  return async (action: ActionRequest): Promise<TResult> => {
    await warden.authorize(mandateId, action);
    return effect(action);
  };
}

export type WardenTool<TResult> = {
  readonly name: string;
  readonly description: string;
  run: WardenGuardedEffect<TResult>;
};

export function createWardenTool<TResult>(params: {
  name: string;
  description: string;
  warden: WardenClient;
  mandateId: Uint8Array;
  effect: WardenGuardedEffect<TResult>;
}): WardenTool<TResult> {
  return {
    name: params.name,
    description: params.description,
    run: guard(params.warden, params.mandateId, params.effect)
  };
}
