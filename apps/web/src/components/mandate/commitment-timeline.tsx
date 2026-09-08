"use client";

import { motion } from "framer-motion";
import { timeAgo } from "@/lib/format";
import type { ActivityEntry } from "@/store/session-store";

const DOT: Record<ActivityEntry["kind"], string> = {
  created: "bg-sky-400",
  authorized: "bg-emerald-400",
  blocked: "bg-amber-400",
  revoked: "bg-rose-400",
  error: "bg-slate-500"
};

const LABEL: Record<ActivityEntry["kind"], string> = {
  created: "Genesis commitment",
  authorized: "Authorization",
  blocked: "Rejected",
  revoked: "Revocation",
  error: "Error"
};

/** Chronological, most-recent-first list of every real state transition this
 * mandate has gone through in this browser session — not fetched history
 * (the ledger keeps no log), but a verbatim record of each real API result. */
export function CommitmentTimeline({ activity }: { activity: ActivityEntry[] }) {
  if (activity.length === 0) {
    return <p className="text-sm text-slate-500">No activity recorded yet in this session.</p>;
  }

  return (
    <ol className="relative flex flex-col gap-0">
      {activity.map((entry, i) => (
        <motion.li
          key={entry.seq}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.22 }}
          className="relative flex gap-3 pb-5 pl-1 last:pb-0"
        >
          {i < activity.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-white/10" />}
          <span className={`relative z-10 mt-1 h-3.5 w-3.5 flex-none rounded-full border-2 border-ink ${DOT[entry.kind]}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-slate-200">{LABEL[entry.kind]}</span>
              <span className="flex-none text-[11px] text-slate-600">{timeAgo(entry.ts)}</span>
            </div>
            {entry.detail && <p className="mt-0.5 truncate text-xs text-slate-500">{entry.detail}</p>}
            {entry.spentCommitment && (
              <p className="mt-1 font-mono text-[11px] text-slate-600">
                spentCommitment → {entry.spentCommitment.slice(0, 10)}…{entry.spentCommitment.slice(-6)}
              </p>
            )}
          </div>
        </motion.li>
      ))}
    </ol>
  );
}
