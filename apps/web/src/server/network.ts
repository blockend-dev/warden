// Selects which WardenBackend the whole server process uses — set once, at
// boot, from an environment variable, never per-request and never silently:
// see docs/DEPLOY-RAILWAY.md, "Live Preprod backend" for why a per-visitor
// or per-request toggle isn't the right shape here.
//
// `WARDEN_NETWORK=preprod` (the hosted Railway default) uses the real
// Midnight Preprod network via PreprodNetwork — see ./preprod/preprod-network.ts.
// Anything else (the default for local dev) uses LocalSimulatorNetwork,
// unchanged from before this module existed.
//
// This file, and everything it imports, is server-only — see
// ./preprod/preprod-network.ts's own comment for why.

import { LocalSimulatorNetwork, type WardenBackend } from "@warden/sdk";
import { PreprodNetwork, ensurePreprodInit, readPreprodConfig, getPreprodStatus, type PreprodStatus } from "./preprod/preprod-network";

export type NetworkMode = "simulator" | "preprod";

export const NETWORK_MODE: NetworkMode = process.env.WARDEN_NETWORK === "preprod" ? "preprod" : "simulator";

let configError: string | undefined;
if (NETWORK_MODE === "preprod") {
  try {
    const cfg = readPreprodConfig();
    if (cfg) {
      // Kick off wallet build + sync now, at server boot, not on the first
      // request — a visitor's first API call shouldn't be what starts an
      // hours-long sync. `.catch` here only prevents an unhandled rejection
      // warning; the failure itself is recorded in getPreprodStatus() and
      // re-thrown to every caller of ensurePreprodInit (i.e. every live
      // network call) for as long as the process runs.
      ensurePreprodInit(cfg).catch(() => {});
    }
  } catch (e) {
    configError = e instanceof Error ? e.message : String(e);
  }
}

export type NetworkStatus =
  | { mode: "simulator" }
  | ({ mode: "preprod" } & PreprodStatus);

/** What the environment badge and any other status UI should show — never
 * fabricated, always a direct read of the real state. */
export function getNetworkStatus(): NetworkStatus {
  if (NETWORK_MODE === "simulator") return { mode: "simulator" };
  if (configError) return { mode: "preprod", phase: "error", detail: configError };
  return { mode: "preprod", ...getPreprodStatus() };
}

let simulatorSingleton: Promise<LocalSimulatorNetwork> | undefined;
let preprodSingleton: WardenBackend | undefined;

/** The one `WardenBackend` every demo session's `WardenClient`s call
 * through. A `PreprodNetwork` call throws `NetworkUnavailableError` on its
 * own if the connection isn't ready yet — this function never blocks
 * waiting for that, and never falls back to the simulator: see this file's
 * top comment. */
export function getNetwork(): Promise<WardenBackend> {
  if (NETWORK_MODE === "simulator") {
    if (!simulatorSingleton) simulatorSingleton = LocalSimulatorNetwork.create();
    return simulatorSingleton;
  }
  if (!preprodSingleton) preprodSingleton = new PreprodNetwork();
  return Promise.resolve(preprodSingleton);
}
