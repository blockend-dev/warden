"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DelegationGraph } from "@/components/graph/delegation-graph";
import { MandateCard } from "@/components/mandate/mandate-card";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { seedDemo } from "@/lib/demo-seed";
import { timeAgo } from "@/lib/format";
import { useCountUp, useReveal } from "@/lib/motion";
import { useSession } from "@/store/session-store";

const KIND_LABEL: Record<string, string> = {
  created: "Created",
  delegated: "Delegated",
  authorized: "Authorized",
  blocked: "Refused",
  revoked: "Revoked",
  paused: "Paused",
  resumed: "Resumed",
  attested: "Attested",
  error: "Error"
};
const KIND_DOT: Record<string, string> = {
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

const FEATURES = [
  { title: "Nested delegation", body: "Principal → Agent → Sub-agent. A child can never hold more authority than its parent has left — proven in-circuit.", tag: "New", href: "/mandates/new" },
  { title: "Cascade revocation", body: "Revoke the root and every sub-agent dies instantly, with their own flags untouched. The circuit checks the parent live.", tag: "New", href: "/lab" },
  { title: "Pause / resume", body: "A reversible kill-switch for the whole subtree. Spend state survives intact.", tag: "New", href: "/lab" },
  { title: "Selective disclosure", body: "Prove “spent at most X” to an auditor. The ledger learns the ceiling, never the real total.", tag: "New", href: "/lab" },
  { title: "Attack Lab", body: "19 adversarial scenarios plus an autonomous agent swarm, all run against the real compiled circuits.", tag: "New", href: "/lab" },
  { title: "Public verifier", body: "Paste any mandate id and see exactly what a third party can — and cannot — learn.", tag: "New", href: "/verify" }
];

export default function DashboardPage() {
  const store = useSession();
  const { mandates, hydrated, resetAll, refresh, serverLost } = store;
  const toast = useToast();
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated) void refresh();
  }, [hydrated, refresh]);

  const counts = useMemo(
    () => ({
      active: mandates.filter((m) => m.status === "active").length,
      paused: mandates.filter((m) => m.status === "paused").length,
      revoked: mandates.filter((m) => m.status === "revoked").length,
      delegated: mandates.filter((m) => m.kind === "delegated").length
    }),
    [mandates]
  );
  const active = useCountUp(counts.active);
  const paused = useCountUp(counts.paused);
  const revoked = useCountUp(counts.revoked);
  const delegated = useCountUp(counts.delegated);

  const roots = useMemo(() => mandates.filter((m) => m.kind === "root"), [mandates]);
  const childCount = (id: string) => mandates.filter((m) => m.parentId === id).length;

  const activity = useMemo(
    () =>
      mandates
        .flatMap((m) => m.activity.map((a) => ({ ...a, mandateId: m.id, mandateLabel: m.label })))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 8),
    [mandates]
  );

  useReveal(root, [hydrated, mandates.length, activity.length]);

  async function resetSession() {
    setBusy("reset");
    try {
      await api.resetSession();
      resetAll();
      toast({ tone: "info", title: "Session reset", body: "Fresh principal, agent and sub-agent identities." });
    } finally {
      setBusy(null);
    }
  }

  async function loadDemo() {
    setBusy("demo");
    try {
      const id = await seedDemo(store, (label) => setBusy(label));
      toast({ tone: "success", title: "Demo loaded", body: "A root mandate, two sub-agents and a payment — all real circuit calls." });
      router.push(`/mandates/${id}`);
    } catch (e) {
      toast({ tone: "error", title: "Demo failed to load", body: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={root} className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:px-6 sm:pt-14">
      {serverLost && (
        <div data-reveal className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          The server no longer recognises this browser&rsquo;s mandates (it restarted, and demo sessions live in memory). Reset the session to start fresh.
        </div>
      )}

      <section className="grid gap-8 lg:grid-cols-[1fr,1.15fr] lg:items-center">
        <div>
          <span data-reveal className="inline-flex items-center gap-2 rounded-full border border-slate-900/10 bg-white/70 px-3 py-1 text-[11px] font-semibold text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
            Wave 2 · delegation · pause · selective disclosure
          </span>
          <h1 data-reveal className="mt-4 font-display text-4xl font-semibold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl">
            Give AI agents real authority — <span className="gradient-text">without unrestricted power.</span>
          </h1>
          <p data-reveal className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">
            A principal grants an agent a private, cryptographically enforceable mandate. The agent can carve bounded
            slices to sub-agents, and every action is proven in zero knowledge — policy, spend and identities stay
            private, revocation stays public.
          </p>
          <div data-reveal className="mt-7 flex flex-wrap gap-3">
            <button type="button" onClick={loadDemo} disabled={busy !== null} className="btn-accent">
              {busy && busy !== "reset" && busy !== "demo" ? `${busy}…` : busy === "demo" ? "Loading demo…" : "▶ Load live demo"}
            </button>
            <Link href="/mandates/new" className="btn-primary">
              Create a mandate
            </Link>
            <Link href="/lab" className="btn-ghost">
              Open Attack Lab
            </Link>
          </div>
          <div data-reveal className="mt-8 grid max-w-md grid-cols-4 gap-2.5 text-sm">
            <Stat label="Active" value={active} tone="text-emerald-600" />
            <Stat label="Paused" value={paused} tone="text-amber-600" />
            <Stat label="Revoked" value={revoked} tone="text-rose-600" />
            <Stat label="Delegated" value={delegated} tone="text-violet-600" />
          </div>
        </div>

        <div data-reveal className="glass-strong p-3 sm:p-4">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="eyebrow">Delegation graph</span>
            <span className="text-[11px] text-slate-500">live from the ledger</span>
          </div>
          <DelegationGraph mandates={mandates} />
        </div>
      </section>

      <section className="mt-14">
        <div className="mb-4 flex items-center justify-between">
          <h2 data-reveal className="eyebrow">Mandates in this session</h2>
          <div className="flex items-center gap-3">
            {hydrated && mandates.length > 0 && (
              <button type="button" onClick={resetSession} disabled={busy !== null} className="text-xs font-semibold text-slate-500 hover:text-rose-600">
                {busy === "reset" ? "Resetting…" : "Reset session"}
              </button>
            )}
            <Link href="/mandates/new" className="text-xs font-semibold text-sky-700 hover:underline">
              + New mandate
            </Link>
          </div>
        </div>
        {!hydrated ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 rounded-3xl skeleton" />
            ))}
          </div>
        ) : mandates.length === 0 ? (
          <div data-reveal className="glass flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p className="max-w-md text-sm text-slate-600">
              No mandates yet. Load the live demo to see a root mandate with two delegated sub-agents, or create your own from scratch.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={loadDemo} disabled={busy !== null} className="btn-accent">
                ▶ Load live demo
              </button>
              <Link href="/mandates/new" className="btn-ghost">
                Create your first mandate
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...roots, ...mandates.filter((m) => m.kind === "delegated")].map((m) => (
              <MandateCard key={m.id} mandate={m} childCount={childCount(m.id)} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-14">
        <h2 data-reveal className="eyebrow mb-4">Recent activity</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing has happened yet.</p>
        ) : (
          <ul data-reveal className="glass divide-y divide-slate-900/[0.06] overflow-hidden">
            {activity.map((entry) => (
              <li key={`${entry.mandateId}-${entry.seq}`} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className={`h-2 w-2 flex-none rounded-full ${KIND_DOT[entry.kind]}`} />
                <span className="font-semibold text-slate-800">{KIND_LABEL[entry.kind]}</span>
                <Link href={`/mandates/${entry.mandateId}`} className="text-slate-500 hover:text-sky-700">
                  {entry.mandateLabel}
                </Link>
                {entry.detail && <span className="hidden truncate text-slate-400 sm:inline">— {entry.detail}</span>}
                <span className="ml-auto flex-none text-xs text-slate-400">{timeAgo(entry.ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-14">
        <h2 data-reveal className="eyebrow mb-4">New in Wave 2</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Link key={f.title} href={f.href} data-reveal className="glass group p-5 transition duration-300 hover:-translate-y-0.5 hover:shadow-lift">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-slate-900">{f.title}</h3>
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">{f.tag}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="glass-inset px-3 py-2">
      <div className={`font-display text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
