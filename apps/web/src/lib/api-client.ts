"use client";

// Typed fetch wrappers over the app's own API routes. Each returns the route's
// JSON verbatim — callers decide what to show. Nothing here invents state.

import type { MandateSummary } from "@warden/shared";
import type { LiveEvidence } from "@warden/sdk";

export type ApiError = { kind: string; message: string };

export type PolicyForm = {
  maxAmount: number;
  asset: string;
  actionType: string;
  destinationCategory: string;
  expiresInSeconds: number;
  actionCountLimit: number;
};

export const DEFAULT_POLICY: PolicyForm = {
  maxAmount: 1000,
  asset: "DEMO",
  actionType: "payment",
  destinationCategory: "vendor:approved",
  expiresInSeconds: 3600,
  actionCountLimit: 10
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}

export const api = {
  identity: async () =>
    (await (await fetch("/api/identity")).json()) as { principalPk: string; agentPk: string; subPk: string },

  createMandate: (policy: PolicyForm) =>
    post<{ id?: string; status?: MandateSummary; evidence?: LiveEvidence; error?: ApiError }>("/api/mandate", policy),

  delegate: (input: { parentId: string; maxAmount: number; actionCountLimit: number; expiresInSeconds?: number }) =>
    post<{ id?: string; status?: MandateSummary; parentStatus?: MandateSummary; evidence?: LiveEvidence; error?: ApiError }>(
      "/api/delegate",
      input
    ),

  authorize: (input: { id: string; amount: number; asset: string; actionType: string; destinationCategory: string }) =>
    post<{ authorized: boolean; status?: MandateSummary; evidence?: LiveEvidence; error?: ApiError }>("/api/authorize", input),

  revoke: (id: string) => post<{ revoked: boolean; status?: MandateSummary; evidence?: LiveEvidence; error?: ApiError }>("/api/revoke", { id }),

  pause: (id: string, paused: boolean) =>
    post<{ ok: boolean; status?: MandateSummary; evidence?: LiveEvidence; error?: ApiError }>("/api/pause", { id, paused }),

  attest: (id: string, ceiling: number) =>
    post<{ ok: boolean; status?: MandateSummary; evidence?: LiveEvidence; error?: ApiError }>("/api/attest", { id, ceiling }),

  resetSession: async () => {
    await fetch("/api/mandate", { method: "DELETE" });
  }
};
