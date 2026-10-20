"use client";

// The Wave 2 pitch deck, served by the app itself so it can never drift from
// the product. ←/→ to navigate, "P" to print every slide to PDF.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { animate, stagger } from "animejs";
import { WardenMark } from "@/components/layout/app-shell";
import { prefersReducedMotion } from "@/lib/motion";

type Slide = { kicker: string; title: React.ReactNode; body: React.ReactNode };

const Pill = ({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "violet" | "sky" | "emerald" | "rose" }) => {
  const t = {
    slate: "bg-white/80 text-slate-700 border-slate-900/10",
    violet: "bg-violet-100 text-violet-700 border-violet-500/20",
    sky: "bg-sky-100 text-sky-700 border-sky-500/20",
    emerald: "bg-emerald-100 text-emerald-700 border-emerald-500/20",
    rose: "bg-rose-100 text-rose-700 border-rose-500/20"
  }[tone];
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${t}`}>{children}</span>;
};

const Card = ({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) => (
  <div data-pop className="glass p-5">
    <div className={`mb-1.5 font-display text-lg font-semibold ${accent ?? "text-slate-900"}`}>{title}</div>
    <div className="text-sm leading-relaxed text-slate-600">{children}</div>
  </div>
);

const Big = ({ n, label, tone = "text-slate-900" }: { n: string; label: string; tone?: string }) => (
  <div data-pop className="glass-strong px-5 py-5 text-center">
    <div className={`font-display text-5xl font-semibold tabular-nums ${tone}`}>{n}</div>
    <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
  </div>
);

function DelegationDiagram() {
  const box = "glass-strong !rounded-2xl px-5 py-4 text-center";
  return (
    <div className="flex flex-col items-center gap-3 md:flex-row md:justify-center md:gap-4">
      <div data-pop className={box}>
        <div className="eyebrow">Principal</div>
        <div className="mt-1 font-display text-lg font-semibold">Root mandate</div>
        <div className="font-mono text-xs text-violet-700">cap 1000 · private</div>
      </div>
      <span className="text-2xl text-slate-400">→</span>
      <div data-pop className={box}>
        <div className="eyebrow">Agent</div>
        <div className="mt-1 font-display text-lg font-semibold">delegate()</div>
        <div className="font-mono text-xs text-violet-700">reserves 400 + 300</div>
      </div>
      <span className="text-2xl text-slate-400">→</span>
      <div className="flex flex-col gap-2">
        <div data-pop className={box}>
          <div className="font-display text-base font-semibold">Sub-agent A</div>
          <div className="font-mono text-xs text-emerald-700">cap 400 ≤ remaining</div>
        </div>
        <div data-pop className={box}>
          <div className="font-display text-base font-semibold">Sub-agent B</div>
          <div className="font-mono text-xs text-emerald-700">cap 300 ≤ remaining</div>
        </div>
        <div data-pop className={`${box} !border-rose-500/30`}>
          <div className="font-display text-base font-semibold text-rose-700">Sub-agent C · 500</div>
          <div className="font-mono text-xs text-rose-700">✕ exceeds parent&rsquo;s remaining budget</div>
        </div>
      </div>
    </div>
  );
}

const SLIDES: Slide[] = [
  {
    kicker: "Warden · Midnight Buildathon · Wave 2",
    title: (
      <>
        Give AI agents real authority — <span className="gradient-text">without unrestricted power.</span>
      </>
    ),
    body: (
      <div className="flex flex-col items-start gap-6">
        <p className="max-w-2xl text-xl leading-relaxed text-slate-600">
          Private mandates, nested delegation and selective disclosure for autonomous agents — enforced by zero-knowledge circuits on Midnight, not by
          anyone&rsquo;s application code.
        </p>
        <div className="flex flex-wrap gap-2">
          <Pill tone="violet">9 Compact circuits</Pill>
          <Pill tone="sky">Live on Midnight Preprod</Pill>
          <Pill tone="emerald">Apache-2.0</Pill>
        </div>
      </div>
    )
  },
  {
    kicker: "The problem",
    title: <>Agents are starting to move value. Today you can only trust, or babysit.</>,
    body: (
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Trust the app" accent="text-rose-700">
          A spending limit in the agent&rsquo;s own code is only as good as that code. A prompt injection, a bug or a compromised key bypasses it.
        </Card>
        <Card title="Human in the loop" accent="text-amber-700">
          Approving every action deletes the autonomy the agent exists for — and does not scale to swarms of sub-agents.
        </Card>
        <Card title="Publish the policy" accent="text-slate-900">
          Putting the budget and approved counterparties on a public ledger leaks exactly what a business must keep private.
        </Card>
      </div>
    )
  },
  {
    kicker: "The idea",
    title: <>A private mandate. A public, verifiable proof of compliance.</>,
    body: (
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Private" accent="text-private">
          Spend cap, asset, action type, destination, action limit, both parties&rsquo; secrets and the running total never touch the ledger.
        </Card>
        <Card title="Public" accent="text-public">
          That the mandate exists, whether it is live, how often it acted — and a ZK proof that every action stayed inside it. Revocation is permanent and
          visible.
        </Card>
        <Card title="No admin, no oracle">
          Access control is a hash commitment checked in-circuit. There is no role registry, no operator key and no off-chain judge.
        </Card>
        <Card title="Midnight-native">
          Compact&rsquo;s private-by-default types, witnesses and <span className="mono-chip">blockTimeLte</span> do the work — exactly the dual-ledger model it was built for.
        </Card>
      </div>
    )
  },
  {
    kicker: "What shipped in Wave 1",
    title: <>A frozen, audited primitive — now nine circuits, live on Preprod.</>,
    body: (
      <div className="grid gap-4 sm:grid-cols-3">
        <Big n="3" label="circuits: create · authorize · revoke" />
        <Big n="36" label="contract tests, every attack named" tone="text-emerald-600" />
        <Big n="1" label="verified Preprod lifecycle, real ZK proofs" tone="text-sky-600" />
      </div>
    )
  },
  {
    kicker: "What changed in Wave 2",
    title: (
      <>
        From one hop to a <span className="gradient-text">trust tree.</span>
      </>
    ),
    body: (
      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="Nested delegation" accent="text-violet-700">
          <span className="mono-chip">delegate</span> <span className="mono-chip">authorizeDelegated</span> <span className="mono-chip">revokeDelegated</span> — a sub-agent can never hold more than its parent has left.
        </Card>
        <Card title="Pause / resume" accent="text-amber-700">
          <span className="mono-chip">pause</span> <span className="mono-chip">resume</span> — a reversible kill-switch that freezes the whole subtree.
        </Card>
        <Card title="Selective disclosure" accent="text-sky-700">
          <span className="mono-chip">attestSpend</span> — prove &ldquo;spent at most X&rdquo; to an auditor; the ledger never learns the total.
        </Card>
        <Card title="Attack Lab + verifier" accent="text-emerald-700">
          19 adversarial scenarios, a seeded agent swarm and a public verifier — all run against the real circuits.
        </Card>
      </div>
    )
  },
  {
    kicker: "How delegation works",
    title: <>Delegation spends the parent&rsquo;s budget — so siblings can&rsquo;t double-allocate.</>,
    body: (
      <div className="flex flex-col gap-6">
        <DelegationDiagram />
        <p className="mx-auto max-w-3xl text-center text-sm leading-relaxed text-slate-600">
          <span className="mono-chip">delegate</span> debits the parent&rsquo;s own spend commitment atomically, in one proof. Child expiry ≤ parent expiry; asset, type and destination are inherited.
          Revoke the root and <span className="mono-chip">authorizeDelegated</span> fails on its live parent check — the child&rsquo;s own flag is never touched.
        </p>
      </div>
    )
  },
  {
    kicker: "Privacy model",
    title: <>What the ledger sees — and what it never will.</>,
    body: (
      <div className="grid gap-4 md:grid-cols-2">
        <div data-pop className="rounded-3xl border border-violet-500/25 bg-violet-50/70 p-5">
          <div className="eyebrow text-private">Private</div>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
            <li>Spend caps (root and child)</li>
            <li>Asset, action type, destination</li>
            <li>Action-count limits</li>
            <li>Principal, agent, sub-agent secrets</li>
            <li>The running spend total</li>
          </ul>
        </div>
        <div data-pop className="rounded-3xl border border-sky-500/25 bg-sky-50/70 p-5">
          <div className="eyebrow text-public">Public</div>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
            <li>Mandate ids &amp; expiry</li>
            <li>Registered / paused / revoked</li>
            <li>Action counter, opaque spend commitment</li>
            <li>Parent → child edges (tree shape, no policy)</li>
            <li>Optional attested ceiling</li>
          </ul>
        </div>
      </div>
    )
  },
  {
    kicker: "Engineering & QA",
    title: <>Every claim has a named test.</>,
    body: (
      <div className="grid gap-4 sm:grid-cols-4">
        <Big n="9" label="state-changing circuits" tone="text-violet-600" />
        <Big n="96" label="contract tests" tone="text-emerald-600" />
        <Big n="19" label="live attack scenarios" tone="text-rose-600" />
        <Big n="15/15" label="live Preprod lifecycle steps, 9 real txs" tone="text-sky-600" />
      </div>
    )
  },
  {
    kicker: "Market & adoption",
    title: <>Every team shipping agents needs a spending boundary.</>,
    body: (
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Who">Agent platforms, fintech &amp; treasury ops, DAOs and any enterprise letting software spend or sign on its behalf.</Card>
        <Card title="How they adopt">
          <span className="mono-chip">@warden/sdk</span> and a framework-agnostic <span className="mono-chip">agent-adapter</span> wrap any tool call in one line.
        </Card>
        <Card title="How it sustains">
          Hosted prover &amp; indexer-as-a-service, enterprise audit tooling over the attestation circuit, and protocol fees on delegated-mandate issuance.
        </Card>
      </div>
    )
  },
  {
    kicker: "Roadmap",
    title: <>Wave 3: depth, composition, reputation.</>,
    body: (
      <ul className="max-w-3xl space-y-3 text-lg text-slate-700">
        <li data-pop>• Deeper delegation chains and reservation reclaim on revoke</li>
        <li data-pop>• Allow-list policies (richer than single-value categories)</li>
        <li data-pop>• Encrypted principal → agent handoff channel</li>
        <li data-pop>• Cross-contract composition once Compact supports it</li>
        <li data-pop>• Privacy-preserving agent reputation layer</li>
      </ul>
    )
  },
  {
    kicker: "Try it",
    title: <>Break it. We dare you.</>,
    body: (
      <div className="flex flex-col items-start gap-5">
        <p className="max-w-xl text-lg text-slate-600">Load the live demo, delegate to a sub-agent, revoke the root — then open the Attack Lab and try to get anything through.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/" className="btn-accent">Open the app</Link>
          <Link href="/lab" className="btn-primary">Attack Lab</Link>
          <Link href="/verify" className="btn-ghost">Public verifier</Link>
        </div>
      </div>
    )
  }
];

export default function DeckPage() {
  const [i, setI] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  const go = useCallback((n: number) => setI(Math.min(SLIDES.length - 1, Math.max(0, n))), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") setI((c) => Math.min(SLIDES.length - 1, c + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setI((c) => Math.max(0, c - 1));
      if (e.key === "Home") setI(0);
      if (e.key === "End") setI(SLIDES.length - 1);
      if (e.key.toLowerCase() === "p") window.print();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!el || prefersReducedMotion()) return;
    const items = el.querySelectorAll("[data-pop]");
    const a1 = animate(el.querySelectorAll("[data-head]"), { opacity: [0, 1], translateY: [26, 0], duration: first.current ? 900 : 650, delay: stagger(110), ease: "outExpo" });
    const a2 = animate(items, { opacity: [0, 1], translateY: [22, 0], scale: [0.96, 1], duration: 700, delay: stagger(90, { start: 260 }), ease: "outExpo" });
    first.current = false;
    return () => {
      a1.pause();
      a2.pause();
    };
  }, [i]);

  const slide = SLIDES[i];

  return (
    <div className="deck relative flex min-h-screen flex-col px-4 py-6 sm:px-10">
      <style>{`
        @media print {
          .deck { display: block !important; padding: 0 !important; }
          .deck-chrome { display: none !important; }
          .deck-slide { page-break-after: always; min-height: 100vh; padding: 36px; }
          [data-pop], [data-head] { opacity: 1 !important; transform: none !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <header className="deck-chrome flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <WardenMark />
          <span className="font-display text-base font-semibold tracking-tight">Warden</span>
        </Link>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="hidden sm:inline">← → to navigate · P to print</span>
          <Link href="/" className="font-semibold text-sky-700 hover:underline">Exit deck</Link>
        </div>
      </header>

      <div ref={stage} key={i} className="deck-slide mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-8 py-10 print:hidden">
        <div data-head style={{ opacity: 0 }}>
          <span className="eyebrow">{slide.kicker}</span>
          <h1 className="mt-3 font-display text-3xl font-semibold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">{slide.title}</h1>
        </div>
        <div data-head style={{ opacity: 0 }}>{slide.body}</div>
      </div>

      {/* Print layout: every slide, statically. */}
      <div className="hidden print:block">
        {SLIDES.map((s, idx) => (
          <section key={idx} className="deck-slide mx-auto flex max-w-5xl flex-col justify-center gap-8">
            <div>
              <span className="eyebrow">{s.kicker}</span>
              <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-slate-900">{s.title}</h1>
            </div>
            <div>{s.body}</div>
          </section>
        ))}
      </div>

      <footer className="deck-chrome flex items-center justify-between gap-4">
        <button type="button" className="btn-ghost" onClick={() => go(i - 1)} disabled={i === 0}>← Prev</button>
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Slides">
          {SLIDES.map((_, idx) => (
            <button
              key={idx}
              type="button"
              role="tab"
              aria-selected={idx === i}
              aria-label={`Slide ${idx + 1}`}
              onClick={() => go(idx)}
              className={`h-2 rounded-full transition-all ${idx === i ? "w-7 bg-slate-900" : "w-2 bg-slate-900/20 hover:bg-slate-900/40"}`}
            />
          ))}
        </div>
        <button type="button" className="btn-primary" onClick={() => go(i + 1)} disabled={i === SLIDES.length - 1}>Next →</button>
      </footer>
    </div>
  );
}
