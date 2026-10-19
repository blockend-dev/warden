"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { animate } from "animejs";
import { useToast } from "@/components/ui/toast";
import { prefersReducedMotion } from "@/lib/motion";
import type { SwarmEvent, SwarmResult } from "@warden/sdk";

// A seeded run of autonomous agents hammering their delegated mandates —
// some misbehaving on purpose — then a pause, a resume and finally a root
// revocation. The server runs every step against the real circuits; this
// component replays the recorded outcomes on a timer so you can watch them.

const NODE_POS: Record<string, { x: number; y: number }> = {
  principal: { x: 70, y: 150 },
  root: { x: 270, y: 150 },
  "agent-1": { x: 520, y: 52 },
  "agent-2": { x: 520, y: 150 },
  "agent-3": { x: 520, y: 248 }
};

export function Swarm() {
  const toast = useToast();
  const svg = useRef<SVGSVGElement>(null);
  const feed = useRef<HTMLUListElement>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [seed, setSeed] = useState("7");
  const [loading, setLoading] = useState(false);
  const [run, setRun] = useState<SwarmResult | null>(null);
  const [cursor, setCursor] = useState(0); // number of events replayed so far
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [rootState, setRootState] = useState<"active" | "paused" | "revoked">("active");

  const shown = run ? run.events.slice(0, cursor) : [];
  const allowed = shown.filter((e) => e.outcome === "allowed").length;
  const refused = shown.length - allowed;
  const rogue = shown.filter((e) => e.rogue && e.rogue !== "none");
  const rogueBlocked = rogue.filter((e) => e.outcome === "refused").length;

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPlaying(false);
  }, []);

  useEffect(() => stop, [stop]);

  async function launch() {
    stop();
    setLoading(true);
    setRun(null);
    setCursor(0);
    setRootState("active");
    try {
      const res = await fetch("/api/swarm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seed: Number(seed) || 7, steps: 24 }) });
      const data = (await res.json()) as SwarmResult;
      setRun(data);
      setPlaying(true);
    } catch (e) {
      toast({ tone: "error", title: "Swarm failed to launch", body: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  // Replay loop.
  useEffect(() => {
    if (!run || !playing) return;
    timer.current = setInterval(() => {
      setCursor((c) => {
        if (c >= run.events.length) {
          stop();
          return c;
        }
        return c + 1;
      });
    }, 620 / speed);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [run, playing, speed, stop]);

  // React to each newly replayed event.
  useEffect(() => {
    if (!run || cursor === 0) return;
    const e = run.events[cursor - 1];
    if (e.action === "pause") setRootState("paused");
    if (e.action === "resume") setRootState("active");
    if (e.action === "revoke" && e.outcome === "allowed") setRootState("revoked");

    if (feed.current) feed.current.scrollTo({ top: 0 });
    if (prefersReducedMotion() || !svg.current) return;
    const target = svg.current.querySelector(`[data-node="${e.action === "spend" ? e.actor : "root"}"]`);
    if (target) {
      if (e.outcome === "allowed") animate(target, { scale: [1, 1.14, 1], duration: 520, ease: "outBack" });
      else animate(target, { translateX: [0, -8, 8, -5, 5, 0], duration: 460, ease: "outQuad" });
    }
    if (e.action === "spend") {
      const pulse = svg.current.querySelector(`[data-pulse="${e.actor}"]`);
      if (pulse) animate(pulse, { opacity: [1, 0], r: [4, 15], duration: 700, ease: "outQuad" });
      const dot = svg.current.querySelector("[data-packet]");
      const pos = NODE_POS[e.actor];
      if (dot && pos) {
        animate(dot, {
          cx: [NODE_POS.root.x + 70, pos.x - 70],
          cy: [NODE_POS.root.y, pos.y],
          opacity: e.outcome === "allowed" ? [1, 0] : [1, 1, 0],
          duration: 520,
          ease: "inOutQuad"
        });
      }
    }
  }, [cursor, run]);

  const done = run !== null && cursor >= run.events.length;

  return (
    <div>
      <div className="glass flex flex-wrap items-end justify-between gap-4 p-5">
        <div className="max-w-xl">
          <h2 className="font-display text-lg font-semibold text-slate-900">Autonomous agent swarm</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            One root mandate, three sub-agents with delegated caps (350 / 300 / 250), 24 autonomous steps. About a quarter of the spends are
            rogue — overspending or paying an unapproved destination. Midway the principal pauses, resumes, then revokes the root.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Seed</span>
            <input className="input !w-24" value={seed} onChange={(e) => setSeed(e.target.value)} inputMode="numeric" aria-label="Random seed" />
          </label>
          <button type="button" className="btn-accent" onClick={launch} disabled={loading}>
            {loading ? "Running circuits…" : run ? "↻ New run" : "▶ Launch swarm"}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.25fr,1fr]">
        <div className="glass-strong p-3">
          <svg ref={svg} viewBox="0 0 640 300" className="h-auto w-full" role="img" aria-label="Swarm: principal, root mandate and three sub-agents">
            <defs>
              <filter id="sw-shadow" x="-30%" y="-30%" width="160%" height="170%">
                <feDropShadow dx="0" dy="5" stdDeviation="6" floodColor="#1e295a" floodOpacity="0.14" />
              </filter>
            </defs>
            {(["agent-1", "agent-2", "agent-3"] as const).map((a) => (
              <path
                key={a}
                d={`M ${NODE_POS.root.x + 70} ${NODE_POS.root.y} C ${NODE_POS.root.x + 150} ${NODE_POS.root.y}, ${NODE_POS[a].x - 150} ${NODE_POS[a].y}, ${NODE_POS[a].x - 70} ${NODE_POS[a].y}`}
                fill="none"
                stroke={rootState === "revoked" ? "#f43f5e" : rootState === "paused" ? "#f59e0b" : "#10b981"}
                strokeOpacity={rootState === "active" ? 0.65 : 0.4}
                strokeWidth="1.6"
                className={rootState === "active" ? "flow-line" : undefined}
              />
            ))}
            <path d={`M ${NODE_POS.principal.x + 34} ${NODE_POS.principal.y} L ${NODE_POS.root.x - 70} ${NODE_POS.root.y}`} stroke="#94a3b8" strokeWidth="1.6" fill="none" className="flow-line" />

            <g transform={`translate(${NODE_POS.principal.x}, ${NODE_POS.principal.y})`}>
              <g data-node="principal" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
                <circle r="30" fill="#fff" stroke="#7c3aed" strokeWidth="2" filter="url(#sw-shadow)" />
                <text textAnchor="middle" y="4" fontSize="11" fontWeight="700" fill="#5b21b6">Principal</text>
              </g>
            </g>

            <g transform={`translate(${NODE_POS.root.x - 70}, ${NODE_POS.root.y - 26})`}>
            <g data-node="root" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
              <rect width="140" height="52" rx="16" fill={rootState === "revoked" ? "#fff1f2" : rootState === "paused" ? "#fffbeb" : "#ecfdf5"} stroke={rootState === "revoked" ? "#f43f5e" : rootState === "paused" ? "#f59e0b" : "#10b981"} strokeWidth="2" filter="url(#sw-shadow)" />
              <text x="70" y="22" textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#0f172a">Root mandate</text>
              <text x="70" y="40" textAnchor="middle" fontSize="11" fontWeight="600" fill={rootState === "revoked" ? "#be123c" : rootState === "paused" ? "#b45309" : "#047857"}>
                {rootState === "revoked" ? "REVOKED" : rootState === "paused" ? "PAUSED" : "ACTIVE · cap 1000"}
              </text>
            </g>
            </g>

            {run?.agents.map((a) => {
              const last = [...shown].reverse().find((e) => e.actor === a.name && e.action === "spend");
              const blocked = rootState !== "active";
              const edge = blocked ? (rootState === "revoked" ? "#f43f5e" : "#f59e0b") : last?.outcome === "refused" ? "#f59e0b" : "#10b981";
              const p = NODE_POS[a.name];
              const my = shown.filter((e) => e.actor === a.name && e.action === "spend");
              return (
                <g key={a.name}>
                  <circle data-pulse={a.name} cx={p.x} cy={p.y} r="0" fill="none" stroke={edge} strokeWidth="2" opacity="0" />
                  <g transform={`translate(${p.x - 70}, ${p.y - 26})`}>
                  <g data-node={a.name} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
                    <rect width="140" height="52" rx="16" fill="#fff" stroke={edge} strokeWidth="2" filter="url(#sw-shadow)" />
                    <text x="70" y="22" textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#0f172a">{a.name}</text>
                    <text x="70" y="40" textAnchor="middle" fontSize="10.5" fill="#64748b">
                      cap {a.cap} · {my.filter((e) => e.outcome === "allowed").length} ok · {my.filter((e) => e.outcome === "refused").length} refused
                    </text>
                  </g>
                  </g>
                </g>
              );
            })}
            <circle data-packet cx="-20" cy="-20" r="5" fill="#0284c7" opacity="0" />
            {!run && (
              <text x="320" y="156" textAnchor="middle" fontSize="13" fill="#94a3b8">
                Launch the swarm to watch autonomous agents meet real circuits.
              </text>
            )}
          </svg>

          {run && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 px-2 pb-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-ghost !px-3 !py-1.5 text-xs"
                  onClick={() => {
                    if (done) setCursor(0);
                    setPlaying((p) => !p);
                  }}
                >
                  {done ? "↻ Replay" : playing ? "⏸ Pause" : "▶ Play"}
                </button>
                {[1, 2, 4].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeed(s)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${speed === s ? "bg-slate-900 text-white" : "bg-white/70 text-slate-600"}`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-slate-900/10">
                <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-violet-500 transition-all" style={{ width: `${(cursor / run.events.length) * 100}%` }} />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Allowed" value={allowed} tone="text-emerald-600" />
            <Stat label="Refused" value={refused} tone="text-rose-600" />
            <Stat label="Rogue blocked" value={`${rogueBlocked}/${rogue.length}`} tone="text-violet-600" />
          </div>
          <div className="glass overflow-hidden">
            <div className="border-b border-slate-900/[0.06] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Circuit feed</div>
            <ul ref={feed} className="max-h-[320px] overflow-y-auto" aria-live="polite">
              {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">Waiting for the first step…</li>}
              {[...shown].reverse().map((e) => (
                <FeedRow key={e.step} e={e} />
              ))}
            </ul>
          </div>
          {done && run && (
            <p className="rounded-2xl border border-emerald-500/25 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-800">
              Finished: <strong>{rogueBlocked}</strong> of <strong>{rogue.length}</strong> rogue attempts were blocked, and every step after the
              root revocation was refused. Reproduce it exactly with seed <span className="font-mono">{run.seed}</span>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className="glass-inset px-3 py-2.5">
      <div className={`font-display text-xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function FeedRow({ e }: { e: SwarmEvent }) {
  const ok = e.outcome === "allowed";
  const title =
    e.action === "spend"
      ? `${e.actor} · ${e.amount} DEMO${e.rogue === "wrong-destination" ? " → unapproved vendor" : ""}`
      : `${e.actor} · ${e.action}`;
  return (
    <li className="flex items-start gap-3 border-b border-slate-900/[0.05] px-4 py-2.5 last:border-0">
      <span className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-bold ${ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
        {ok ? "✓" : "✕"}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
          {title}
          {e.rogue && e.rogue !== "none" && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-700">rogue</span>}
        </div>
        {e.message && <div className="mt-0.5 break-words font-mono text-[11px] text-rose-700">{e.message}</div>}
        {ok && e.action === "spend" && <div className="mt-0.5 font-mono text-[11px] text-slate-400">commitment → {e.commitment.slice(0, 12)}…</div>}
      </div>
    </li>
  );
}
