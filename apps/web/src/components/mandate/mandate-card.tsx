"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { StatusBadge } from "@/components/ui/status-badge";
import { HexChip } from "@/components/ui/hex-chip";
import { timeLeft } from "@/lib/format";
import type { LocalMandate } from "@/store/session-store";

export function MandateCard({ mandate }: { mandate: LocalMandate }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Link
        href={`/mandates/${mandate.id}`}
        className="group block rounded-xl border border-white/10 bg-white/[0.025] p-4 transition hover:border-white/20 hover:bg-white/[0.045]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">{mandate.label}</div>
            <div className="mt-1">
              <HexChip value={mandate.id} label="mandate id" />
            </div>
          </div>
          <StatusBadge status={mandate.status} />
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-slate-500">Actions</dt>
            <dd className="mt-0.5 font-mono text-slate-300">
              {mandate.actionsAuthorized}
              <span className="text-slate-600">/{mandate.policy.actionCountLimit}</span>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Expiry</dt>
            <dd className="mt-0.5 font-mono text-slate-300">{timeLeft(mandate.policy.expiryUnix)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Commitment</dt>
            <dd className="mt-0.5 font-mono text-slate-300">{mandate.spentCommitment ? mandate.spentCommitment.slice(0, 6) : "—"}</dd>
          </div>
        </dl>
        <div className="mt-3 text-right text-xs font-medium text-slate-500 transition group-hover:text-sky-400">
          Inspect →
        </div>
      </Link>
    </motion.div>
  );
}
