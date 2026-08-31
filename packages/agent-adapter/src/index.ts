// A minimal, framework-agnostic middleware: wraps an agent framework's own
// "tool" or "effect" function so that it only ever runs once Warden has
// proven the requested action satisfies the agent's mandate.
//
//   Agent → Warden authorization middleware → action request → policy proof → Midnight transaction
//
// Deliberately not coupled to any specific agent SDK (LangChain, an MCP tool
// server, a hand-rolled loop) — every one of those ultimately reduces to
// "call this function with these arguments," which is all `guard` assumes.
// This is also the seam Wave 2/3 integrations (real agent frameworks,
// multi-agent hierarchies) attach to — see docs/ARCHITECTURE.md §8.

import type { ActionRequest, WardenClient } from "@warden/sdk";

export type { ActionRequest } from "@warden/sdk";

export type WardenGuardedEffect<TResult> = (action: ActionRequest) => Promise<TResult>;

/**
 * Wraps `effect` so it only runs after `warden.authorize(mandateId, action)`
 * resolves. If authorization fails, `effect` is never called — the
 * rejection propagates as whatever typed `WardenError` the SDK produced
 * (see `@warden/sdk`'s `errors.ts`), and the caller decides what "BLOCKED"
 * means for its own UI/logging.
 */
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

/**
 * A named, describable version of `guard` shaped like a typical agent
 * framework "tool" definition (a `name`, a `description`, and a `run`
 * function) — pass the result straight into whatever tool registry an
 * agent runtime expects, once Wave 2/3 wires up a real one.
 */
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
