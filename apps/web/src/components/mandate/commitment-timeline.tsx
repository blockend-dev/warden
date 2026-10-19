"use client";

import { useEffect, useRef } from "react";
import { animate } from "animejs";
import { prefersReducedMotion } from "@/lib/motion";
import { timeAgo } from "@/lib/format";
import type { ActivityEntry } from "@/store/session-store";

const DOT: Record<ActivityEntry["kind"], string> = {
  created: "bg-sky-500",
  delegated: "bg-violet-500",
  authorized: "bg-emerald-500",
  blocked: "bg-amber-500",
  revoked: "bg-rose-500",
  paused: "bg-amber-500",
  resumed: "bg-emerald-500",
  attested: "bg-indigo-500",
  error: "bg-slate-400"
};

const LABEL: Record<ActivityEntry["kind"], string> = {
  created: "Genesis commitment",
  delegated: "Delegation",
  authorized: "Authorization",
  blocked: "Refused by the circuit",
  revoked: "Revocation",
  paused: "Paused",
  resumed: "Resumed",
  attested: "Spend attestation",
  error: "Error"
};

/** Chronological, most-recent-first list of every real state transition this
 * mandate has gone through in this browser session — not fetched history
 * (the ledger keeps no log), but a verbatim record of each real API result. */
export function CommitmentTimeline({ activity }: { activity: ActivityEntry[] }) {
  const list = useRef<HTMLOListElement>(null);
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    const items = list.current ? Array.from(list.current.children) : [];
    const fresh = items.filter((el) => !seen.current.has(Number((el as HTMLElement).dataset.seq)));
    for (const el of items) seen.current.add(Number((el as HTMLElement).dataset.seq));
    if (fresh.length && !prefersReducedMotion()) {
      animate(fresh, { opacity: [0, 1], translateX: [-12, 0], duration: 420, ease: "outCubic" });
    }
  }, [activity]);

  if (activity.length === 0) {
    return <p className="text-sm text-slate-500">No activity recorded yet in this session.</p>;
  }

  return (
    <ol ref={list} className="relative flex flex-col gap-0">
      {activity.map((entry, i) => (
        <li key={entry.seq} data-seq={entry.seq} className="relative flex gap-3 pb-5 pl-1 last:pb-0">
          {i < activity.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-slate-900/10" />}
          <span className={`relative z-10 mt-1 h-3.5 w-3.5 flex-none rounded-full border-2 border-white shadow ${DOT[entry.kind]}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">{LABEL[entry.kind]}</span>
              <span className="flex-none text-[11px] text-slate-400">{timeAgo(entry.ts)}</span>
            </div>
            {entry.detail && <p className="mt-0.5 break-words text-xs text-slate-500">{entry.detail}</p>}
            {entry.spentCommitment && (
              <p className="mt-1 font-mono text-[11px] text-slate-400">
                spentCommitment → {entry.spentCommitment.slice(0, 10)}…{entry.spentCommitment.slice(-6)}
              </p>
            )}
            {entry.txId && (
              <p className="mt-0.5 font-mono text-[11px] text-emerald-700">
                tx {entry.txId.slice(0, 12)}…{entry.blockHeight ? ` · block ${entry.blockHeight.toLocaleString()}` : ""}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
