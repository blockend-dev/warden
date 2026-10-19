"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { HexChip } from "@/components/ui/hex-chip";
import { useReveal } from "@/lib/motion";
import { useSession } from "@/store/session-store";
import type { MandateSummary } from "@warden/shared";

type Verdict = { status: MandateSummary; children: MandateSummary[] };

const CANNOT_SEE = [
  ["Spending cap", "Compared inside the proof; never written anywhere."],
  ["Asset, action type, destination", "Private policy clauses, matched in-circuit."],
  ["Who the principal and agent are", "Only commitments to public keys; the secrets never leave their holders."],
  ["Any amount ever spent", "Only an opaque commitment that is re-randomized on every call."],
  ["The action-count limit", "Only the running count is public."]
] as const;

function VerifyInner() {
  const search = useSearchParams();
  const { mandates, hydrated } = useSession();
  const root = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState(search.get("id") ?? "");
  const [loading, setLoading] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = /^[0-9a-fA-F]{64}$/.test(input.trim());

  async function verify(id = input.trim()) {
    setLoading(true);
    setError(null);
    setVerdict(null);
    try {
      const res = await fetch(`/api/verify/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Could not verify that id.");
      setVerdict(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = search.get("id");
    if (id && /^[0-9a-fA-F]{64}$/.test(id)) void verify(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useReveal(root, [verdict?.status.id, error, hydrated]);

  const s = verdict?.status;

  return (
    <div ref={root} className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <span data-reveal className="eyebrow">Public verifier</span>
      <h1 data-reveal className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        What does the world see? <span className="gradient-text">Almost nothing — on purpose.</span>
      </h1>
      <p data-reveal className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">
        Paste any mandate id. This page reads only public ledger state through an anonymous observer — no session, no secrets. It proves a
        mandate exists, whether it is live, how many times it has acted and where it sits in a delegation tree. Nothing else.
      </p>

      <form
        data-reveal
        className="glass mt-8 flex flex-col gap-3 p-4 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void verify();
        }}
      >
        <input
          className="input font-mono text-xs"
          placeholder="64-character mandate id (hex)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Mandate id"
          aria-invalid={input.length > 0 && !valid}
          spellCheck={false}
        />
        <button type="submit" className="btn-primary sm:w-40" disabled={!valid || loading}>
          {loading ? "Reading ledger…" : "Verify"}
        </button>
      </form>
      {input.length > 0 && !valid && <p className="mt-2 px-1 text-xs text-rose-600">A mandate id is exactly 64 hex characters.</p>}

      {hydrated && mandates.length > 0 && !verdict && (
        <div data-reveal className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>Or try one of yours:</span>
          {mandates.slice(0, 5).map((m) => (
            <button
              key={m.id}
              type="button"
              className="rounded-full border border-slate-900/10 bg-white/70 px-3 py-1 font-semibold text-slate-700 hover:border-sky-500/40"
              onClick={() => {
                setInput(m.id);
                void verify(m.id);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-6 rounded-2xl border border-rose-500/25 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

      {s && (
        <div className="mt-8 grid gap-5 md:grid-cols-[1.2fr,1fr]">
          <section data-reveal className="glass-strong p-5">
            <div className="flex items-center justify-between">
              <h2 className="eyebrow text-public">The world sees</h2>
              <StatusBadge status={s.status} />
            </div>
            {s.status === "unknown" ? (
              <p className="mt-4 text-sm text-slate-600">
                No mandate with this id is registered on the ledger. Either it was never created, or the id is wrong — the ledger cannot tell which.
              </p>
            ) : (
              <dl className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 text-sm">
                <dt className="text-slate-500">Type</dt>
                <dd className="font-semibold text-slate-900">{s.kind === "delegated" ? "Delegated (sub-agent) mandate" : "Root mandate"}</dd>
                <dt className="text-slate-500">Actions authorized</dt>
                <dd className="font-mono text-slate-900">{s.actionsAuthorized}</dd>
                <dt className="text-slate-500">Spend commitment</dt>
                <dd>{s.spentCommitment && <HexChip value={s.spentCommitment} label="spend commitment" />}</dd>
                {s.parentId && (
                  <>
                    <dt className="text-slate-500">Parent</dt>
                    <dd>
                      <Link href={`/verify?id=${s.parentId}`} className="font-mono text-xs text-sky-700 hover:underline">
                        {s.parentId.slice(0, 10)}…{s.parentId.slice(-6)} ↗
                      </Link>
                    </dd>
                  </>
                )}
                {s.blockedByParent && (
                  <>
                    <dt className="text-slate-500">Effective state</dt>
                    <dd className="text-rose-700">Cut off — parent is {s.blockedByParent}</dd>
                  </>
                )}
                <dt className="text-slate-500">Spend attestation</dt>
                <dd>
                  {s.attestation ? (
                    <span className="text-slate-900">
                      spent ≤ <span className="font-mono font-semibold">{s.attestation.ceiling}</span>{" "}
                      <span className="text-xs text-slate-500">(as of action #{s.attestation.atCount}{s.attestation.stale ? ", stale" : ""})</span>
                    </span>
                  ) : (
                    <span className="text-slate-400">none published</span>
                  )}
                </dd>
              </dl>
            )}

            {verdict && verdict.children.length > 0 && (
              <div className="mt-5 border-t border-slate-900/[0.07] pt-4">
                <h3 className="eyebrow mb-2">Delegated sub-mandates ({verdict.children.length})</h3>
                <ul className="flex flex-col gap-1.5">
                  {verdict.children.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/60 px-3 py-2">
                      <Link href={`/verify?id=${c.id}`} className="font-mono text-xs text-sky-700 hover:underline">
                        {c.id.slice(0, 10)}…{c.id.slice(-6)}
                      </Link>
                      <span className="text-[11px] text-slate-500">{c.actionsAuthorized} actions</span>
                      <StatusBadge status={c.status} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section data-reveal className="glass p-5">
            <h2 className="eyebrow text-private">The world cannot see</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {CANNOT_SEE.map(([title, why]) => (
                <li key={title} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-violet-100 text-[9px] font-bold text-violet-700">●</span>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{title}</div>
                    <div className="text-xs leading-relaxed text-slate-500">{why}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl px-6 py-16"><div className="h-40 rounded-3xl skeleton" /></div>}>
      <VerifyInner />
    </Suspense>
  );
}
