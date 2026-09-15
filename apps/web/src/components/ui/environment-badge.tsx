"use client";

// Two distinct, truthful claims live here, and this badge must not blur
// them — nor claim the first one when it isn't actually true right now:
//
// 1. Protocol claim — Warden has a verified live deployment on the real
//    Midnight Preprod network: real ZK proofs, real on-chain transactions,
//    full mandate lifecycle exercised end-to-end. See
//    docs/DEPLOYMENT.md for the contract address, transaction
//    hashes, and block numbers from that run.
// 2. This deployment's *actual current execution path* — read live from
//    `/api/network-status` (backed by `apps/web/src/server/network.ts`),
//    never hardcoded. If this server is configured for Preprod but hasn't
//    finished connecting yet (a fresh wallet's first sync takes hours — see
//    docs/DEPLOY-RAILWAY.md), or failed to connect, this shows that
//    honestly instead of claiming LIVE. It never silently substitutes the
//    simulator while still showing LIVE — an "unavailable" state is exactly
//    the situation where the previous badge's local-only origin would have
//    misrepresented a broken live deployment as a working demo.

import { useEffect, useState } from "react";

type NetworkStatus =
  | { mode: "simulator" }
  | { mode: "preprod"; phase: "starting" }
  | { mode: "preprod"; phase: "syncing"; detail: string }
  | { mode: "preprod"; phase: "ready"; contractAddress: string; network: string }
  | { mode: "preprod"; phase: "error"; detail: string };

const POLL_MS = 15_000;

function useNetworkStatus(): NetworkStatus | undefined {
  const [status, setStatus] = useState<NetworkStatus | undefined>();
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetch("/api/network-status")
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) setStatus(data);
        })
        .catch(() => {
          // A failed status fetch is not the same claim as "Preprod is
          // unavailable" — it might just be this tab losing connectivity.
          // Leave the last-known status in place rather than guessing.
        });
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return status;
}

const DEPLOYMENT_DETAIL =
  "Warden has a verified live deployment on Midnight Preprod: real ZK proofs, real on-chain transactions, full mandate lifecycle (createMandate, authorize, revoke) exercised end-to-end — see docs/DEPLOYMENT.md.";
const SESSION_DETAIL =
  "This session executes real compiled circuits in-process via @midnight-ntwrk/compact-runtime — no proof server, no live network, for instant funding-free interaction.";

function Pill({ tone, title, children }: { tone: "live" | "pending" | "down" | "muted"; title: string; children: React.ReactNode }) {
  const styles: Record<typeof tone, string> = {
    live: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    pending: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    down: "border-rose-500/25 bg-rose-500/10 text-rose-300",
    muted: "border-white/10 bg-white/[0.03] text-slate-500"
  };
  const dot: Record<typeof tone, string> = {
    live: "bg-emerald-400",
    pending: "bg-amber-400",
    down: "bg-rose-400",
    muted: "bg-slate-500"
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] ${styles[tone]}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {tone === "live" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dot[tone]} ${tone === "live" ? "proof-pulse" : ""}`} />
      </span>
      {children}
    </span>
  );
}

export function EnvironmentBadge() {
  const status = useNetworkStatus();

  if (!status) {
    // First render, before the status fetch resolves — say nothing rather
    // than guess. Same visual slot, no layout shift once it resolves.
    return <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-slate-600">···</span>;
  }

  if (status.mode === "simulator") {
    return (
      <Pill tone="muted" title={SESSION_DETAIL}>
        DEMO · SIMULATOR
      </Pill>
    );
  }

  // mode === "preprod" from here — this deployment is configured to run
  // live; show its real connection state, not a fallback claim.
  if (status.phase === "ready") {
    return (
      <Pill tone="live" title={`${DEPLOYMENT_DETAIL} Contract: ${status.contractAddress}`}>
        LIVE · MIDNIGHT PREPROD
      </Pill>
    );
  }
  if (status.phase === "error") {
    return (
      <Pill tone="down" title={`Preprod connection unavailable: ${status.detail}`}>
        PREPROD · UNAVAILABLE
      </Pill>
    );
  }
  return (
    <Pill tone="pending" title={status.phase === "syncing" ? `Connecting to Preprod: ${status.detail}` : "Starting the Preprod connection…"}>
      PREPROD · INITIALIZING
    </Pill>
  );
}
