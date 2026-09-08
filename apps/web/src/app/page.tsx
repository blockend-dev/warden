"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { MandateCard } from "@/components/mandate/mandate-card";
import { timeAgo } from "@/lib/format";
import { useSession } from "@/store/session-store";

const AuthorizationGraph = dynamic(
  () => import("@/components/graph/authorization-graph").then((m) => m.AuthorizationGraph),
  { ssr: false, loading: () => <div className="h-[320px] w-full rounded-2xl skeleton sm:h-[380px]" /> }
);

const KIND_LABEL: Record<string, string> = { created: "Created", authorized: "Authorized", blocked: "Blocked", revoked: "Revoked", error: "Error" };
const KIND_DOT: Record<string, string> = { created: "bg-sky-400", authorized: "bg-emerald-400", blocked: "bg-amber-400", revoked: "bg-rose-400", error: "bg-slate-500" };

export default function DashboardPage() {
  const { mandates, hydrated, resetAll } = useSession();
  const [resetting, setResetting] = useState(false);

  const counts = useMemo(
    () => ({
      active: mandates.filter((m) => m.status === "active").length,
      revoked: mandates.filter((m) => m.status === "revoked").length,
      expired: mandates.filter((m) => m.status === "expired").length
    }),
    [mandates]
  );

  const activity = useMemo(
    () =>
      mandates
        .flatMap((m) => m.activity.map((a) => ({ ...a, mandateId: m.id, mandateLabel: m.label })))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 8),
    [mandates]
  );

  async function resetSession() {
    setResetting(true);
    try {
      await fetch("/api/mandate", { method: "DELETE" });
      resetAll();
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <section className="grid gap-8 lg:grid-cols-[1fr,1.1fr] lg:items-center">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <span className="eyebrow">Verifiable constrained autonomy</span>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl">
            Give AI agents real authority — without giving them unrestricted power.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-400">
            A principal grants an agent a private, cryptographically enforceable mandate. The agent can act on-chain
            only when the action satisfies that mandate — proven in zero knowledge, never disclosed to make the proof
            work.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/mandates/new" className="btn-primary">
              Create a mandate
            </Link>
            {hydrated && mandates.length > 0 && (
              <button type="button" onClick={resetSession} disabled={resetting} className="btn-ghost">
                {resetting ? "Resetting…" : "Reset session"}
              </button>
            )}
          </div>
          <div className="mt-8 grid max-w-sm grid-cols-3 gap-3 text-sm">
            <Stat label="Active" value={counts.active} tone="text-emerald-300" />
            <Stat label="Revoked" value={counts.revoked} tone="text-rose-300" />
            <Stat label="Expired" value={counts.expired} tone="text-amber-300" />
          </div>
        </motion.div>

        <div className="panel p-2">
          <AuthorizationGraph mandates={mandates} />
        </div>
      </section>

      <section className="mt-16">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="eyebrow">Mandates in this session</h2>
          <Link href="/mandates/new" className="text-xs font-medium text-sky-400 hover:text-sky-300">
            + New mandate
          </Link>
        </div>
        {!hydrated ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 rounded-xl skeleton" />
            ))}
          </div>
        ) : mandates.length === 0 ? (
          <div className="panel flex flex-col items-center gap-3 px-6 py-16 text-center">
            <p className="text-sm text-slate-400">No mandates yet. Create one to see the authorization graph come alive.</p>
            <Link href="/mandates/new" className="btn-primary">
              Create your first mandate
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mandates.map((m) => (
              <MandateCard key={m.id} mandate={m} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-16">
        <h2 className="eyebrow mb-4">Recent activity</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing has happened yet.</p>
        ) : (
          <ul className="panel divide-y divide-white/5">
            {activity.map((entry) => (
              <li key={`${entry.mandateId}-${entry.seq}`} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className={`h-2 w-2 flex-none rounded-full ${KIND_DOT[entry.kind]}`} />
                <span className="font-medium text-slate-200">{KIND_LABEL[entry.kind]}</span>
                <Link href={`/mandates/${entry.mandateId}`} className="text-slate-500 hover:text-sky-400">
                  {entry.mandateLabel}
                </Link>
                {entry.detail && <span className="hidden truncate text-slate-600 sm:inline">— {entry.detail}</span>}
                <span className="ml-auto flex-none text-xs text-slate-600">{timeAgo(entry.ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className={`font-display text-xl font-semibold ${tone}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
