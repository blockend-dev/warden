"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { animate, stagger } from "animejs";
import { useToast } from "@/components/ui/toast";
import { prefersReducedMotion, useCountUp } from "@/lib/motion";
import type { ScenarioResult } from "@warden/sdk";

const GROUPS: ScenarioResult["group"][] = ["Wave 1", "Delegation", "Pause & audit"];

export function AttackSuite() {
  const toast = useToast();
  const list = useRef<HTMLDivElement>(null);
  const [results, setResults] = useState<ScenarioResult[] | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const passed = results?.filter((r) => r.passed).length ?? 0;
  const refused = results?.filter((r) => r.outcome === "refused").length ?? 0;
  const total = results?.length ?? 0;
  const passedShown = useCountUp(passed, 700);
  const refusedShown = useCountUp(refused, 700);

  async function run(only?: string[]) {
    setRunning(only?.[0] ?? "all");
    const started = Date.now();
    try {
      const res = await fetch("/api/lab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ only }) });
      const data = (await res.json()) as { results: ScenarioResult[] };
      setElapsed(Date.now() - started);
      setResults((prev) => {
        if (!only || !prev) return data.results;
        const byId = new Map(data.results.map((r) => [r.id, r]));
        return prev.map((r) => byId.get(r.id) ?? r);
      });
      const bad = data.results.filter((r) => !r.passed);
      if (bad.length) toast({ tone: "error", title: `${bad.length} scenario(s) deviated from the protocol`, body: bad.map((b) => b.id).join(", ") });
      else toast({ tone: "success", title: only ? "Scenario behaved as promised" : `All ${data.results.length} scenarios behaved exactly as promised`, body: "Every refusal is a real circuit assert." });
    } catch (e) {
      toast({ tone: "error", title: "Lab failed to run", body: (e as Error).message });
    } finally {
      setRunning(null);
    }
  }

  // Stagger the result cards in when a full run lands.
  useEffect(() => {
    if (!results || !list.current || prefersReducedMotion()) return;
    const cards = list.current.querySelectorAll("[data-result]");
    const anim = animate(cards, { opacity: [0, 1], translateY: [14, 0], delay: stagger(45), duration: 520, ease: "outCubic" });
    return () => {
      anim.pause();
      cards.forEach((c) => ((c as HTMLElement).style.opacity = "1"));
    };
    // Re-run only when the set of scenarios changes, not on every single-scenario refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  const grouped = useMemo(() => GROUPS.map((g) => ({ group: g, items: (results ?? []).filter((r) => r.group === g) })), [results]);

  return (
    <div>
      <div className="glass flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Adversarial scenarios</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-600">
            Each scenario is an attacker (or an honest control) running against the real compiled circuits on a private simulator. A
            &ldquo;refused&rdquo; here is a failing circuit <code className="mono-chip">assert</code> — there is no application check standing in for it.
          </p>
        </div>
        <button type="button" className="btn-accent" disabled={running !== null} onClick={() => run()}>
          {running === "all" ? "Attacking…" : results ? "↻ Run again" : "▶ Run all scenarios"}
        </button>
      </div>

      {results && (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          <Tally label="Behaved as promised" value={`${passedShown}/${total}`} tone={passed === total ? "text-emerald-600" : "text-rose-600"} />
          <Tally label="Attacks refused" value={String(refusedShown)} tone="text-rose-600" />
          <Tally label="Honest paths allowed" value={String(total - refused)} tone="text-emerald-600" />
          <Tally label="Total time" value={`${(elapsed / 1000).toFixed(1)}s`} tone="text-slate-700" />
        </div>
      )}

      <div ref={list} className="mt-6 flex flex-col gap-8">
        {!results && running === null && (
          <div className="glass-inset p-8 text-center text-sm text-slate-500">Nothing has run yet. Hit “Run all scenarios” — it takes a few seconds.</div>
        )}
        {!results && running !== null && <div className="h-40 rounded-3xl skeleton" />}
        {grouped.map(
          ({ group, items }) =>
            items.length > 0 && (
              <section key={group}>
                <h3 className="eyebrow mb-3">{group}</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {items.map((r) => (
                    <ResultCard key={r.id} r={r} busy={running === r.id} disabled={running !== null} onRun={() => run([r.id])} />
                  ))}
                </div>
              </section>
            )
        )}
      </div>
    </div>
  );
}

function Tally({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="glass-inset px-4 py-3">
      <div className={`font-display text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function ResultCard({ r, busy, disabled, onRun }: { r: ScenarioResult; busy: boolean; disabled: boolean; onRun: () => void }) {
  const refused = r.outcome === "refused";
  return (
    <article
      data-result
      className={`glass p-4 ${!r.passed ? "!border-rose-500/50" : ""}`}
      aria-label={`${r.title}: ${refused ? "refused" : "allowed"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold leading-snug text-slate-900">{r.title}</h4>
        <span
          className={`flex-none rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            refused ? "border-rose-500/30 bg-rose-50 text-rose-700" : "border-emerald-500/30 bg-emerald-50 text-emerald-700"
          }`}
        >
          {refused ? "Refused" : "Allowed"}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-600">{r.story}</p>
      {r.message && (
        <div className="mt-3 rounded-xl bg-slate-900 px-3 py-2 font-mono text-[11px] leading-relaxed text-emerald-300">
          <span className="text-slate-500">assert ✕ </span>
          {r.message}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
        <span>
          {r.errorKind && <span className="mono-chip mr-2">{r.errorKind}</span>}
          expected: <strong className={r.expect === "refuse" ? "text-rose-600" : "text-emerald-600"}>{r.expect}</strong>
          {r.passed ? " ✓" : " ✕ MISMATCH"}
        </span>
        <button type="button" onClick={onRun} disabled={disabled} className="font-semibold text-sky-700 hover:underline disabled:opacity-40">
          {busy ? "…" : "re-run"}
        </button>
      </div>
    </article>
  );
}
