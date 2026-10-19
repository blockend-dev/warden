"use client";

// Two distinct, truthful claims live here, and this badge must not blur
// them — nor claim the first one when it isn't actually true right now:
//
// 1. Protocol claim — Warden has a verified live deployment on the real
//    Midnight Preprod network (Wave 1 contract): real ZK proofs, real
//    on-chain transactions. See docs/DEPLOYMENT.md.
// 2. This deployment's *actual current execution path* — read live from
//    `/api/network-status` (backed by `apps/web/src/server/network.ts`),
//    never hardcoded. If this server is configured for Preprod but hasn't
//    finished connecting yet, or failed, this shows that honestly instead of
//    claiming LIVE. It never silently substitutes the simulator while still
//    showing LIVE.

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
          // unavailable" — leave the last-known status in place.
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
  "Warden has a verified live deployment on Midnight Preprod: real ZK proofs and real on-chain transactions — see docs/DEPLOYMENT.md.";
const SESSION_DETAIL =
  "This session executes the real compiled circuits in-process via @midnight-ntwrk/compact-runtime — no proof server, no live network, for instant funding-free interaction.";

type Tone = "live" | "pending" | "down" | "muted";

const STYLES: Record<Tone, string> = {
  live: "border-emerald-500/30 bg-emerald-50 text-emerald-700",
  pending: "border-amber-500/30 bg-amber-50 text-amber-700",
  down: "border-rose-500/30 bg-rose-50 text-rose-700",
  muted: "border-slate-900/10 bg-white/70 text-slate-600"
};
const DOT: Record<Tone, string> = {
  live: "bg-emerald-500",
  pending: "bg-amber-500",
  down: "bg-rose-500",
  muted: "bg-sky-500"
};

function Pill({ tone, title, children }: { tone: Tone; title: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] sm:text-[11px] ${STYLES[tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]} ${tone === "live" ? "proof-pulse" : ""}`} />
      {children}
    </span>
  );
}

export function EnvironmentBadge() {
  const status = useNetworkStatus();

  if (!status) {
    return <span className="inline-flex items-center rounded-full border border-slate-900/10 bg-white/70 px-3 py-1 text-[11px] text-slate-400">···</span>;
  }

  if (status.mode === "simulator") {
    return (
      <Pill tone="muted" title={SESSION_DETAIL}>
        Demo · Simulator
      </Pill>
    );
  }

  if (status.phase === "ready") {
    return (
      <Pill tone="live" title={`${DEPLOYMENT_DETAIL} Contract: ${status.contractAddress}`}>
        Live · Midnight Preprod
      </Pill>
    );
  }
  if (status.phase === "error") {
    return (
      <Pill tone="down" title={`Preprod connection unavailable: ${status.detail}`}>
        Preprod · Unavailable
      </Pill>
    );
  }
  return (
    <Pill tone="pending" title={status.phase === "syncing" ? `Connecting to Preprod: ${status.detail}` : "Starting the Preprod connection…"}>
      Preprod · Initializing
    </Pill>
  );
}
