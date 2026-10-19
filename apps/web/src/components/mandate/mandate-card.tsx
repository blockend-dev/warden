"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { HexChip } from "@/components/ui/hex-chip";
import { timeLeft } from "@/lib/format";
import type { LocalMandate } from "@/store/session-store";

export function MandateCard({ mandate, childCount = 0 }: { mandate: LocalMandate; childCount?: number }) {
  return (
    <Link
      href={`/mandates/${mandate.id}`}
      data-reveal
      className="glass group block p-4 transition duration-300 hover:-translate-y-0.5 hover:shadow-lift"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{mandate.label}</span>
            {mandate.kind === "delegated" && (
              <span className="rounded-full border border-violet-500/25 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                delegated
              </span>
            )}
          </div>
          <div className="mt-1.5">
            <HexChip value={mandate.id} label="mandate id" />
          </div>
        </div>
        <StatusBadge status={mandate.status} />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">Actions</dt>
          <dd className="mt-0.5 font-mono text-slate-800">
            {mandate.actionsAuthorized}
            <span className="text-slate-400">/{mandate.policy.actionCountLimit}</span>
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Expiry</dt>
          <dd className="mt-0.5 font-mono text-slate-800">{timeLeft(mandate.policy.expiryUnix)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{mandate.kind === "root" ? "Sub-agents" : "Commitment"}</dt>
          <dd className="mt-0.5 font-mono text-slate-800">
            {mandate.kind === "root" ? childCount : mandate.spentCommitment ? mandate.spentCommitment.slice(0, 6) : "—"}
          </dd>
        </div>
      </dl>
      {mandate.blockedByParent && (
        <p className="mt-3 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-700">
          Cut off by its parent ({mandate.blockedByParent}) — its own flag is untouched.
        </p>
      )}
      <div className="mt-3 text-right text-xs font-semibold text-slate-400 transition group-hover:text-sky-700">Inspect →</div>
    </Link>
  );
}
