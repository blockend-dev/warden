"use client";

import { useRef, useState } from "react";
import { AttackSuite } from "@/components/lab/attack-suite";
import { Swarm } from "@/components/lab/swarm";
import { useReveal } from "@/lib/motion";

const TABS = [
  { key: "suite", label: "Attack suite" },
  { key: "swarm", label: "Agent swarm" }
] as const;

export default function LabPage() {
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("suite");
  useReveal(root, []);

  return (
    <div ref={root} className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="mb-8">
        <span data-reveal className="eyebrow">Attack Lab</span>
        <h1 data-reveal className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Try to break it. <span className="gradient-text">The circuits say no.</span>
        </h1>
        <p data-reveal className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">
          The product is the refusals. Everything below runs on a private in-process simulator against the same compiled{" "}
          <code className="mono-chip">warden.compact</code> the live deployment uses — your attacks never touch anyone else&rsquo;s mandates.
        </p>
      </div>

      <div data-reveal role="tablist" aria-label="Lab mode" className="mb-6 inline-flex rounded-full border border-slate-900/[0.07] bg-white/60 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${tab === t.key ? "bg-slate-900 text-white shadow" : "text-slate-600 hover:text-slate-900"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div data-reveal>{tab === "suite" ? <AttackSuite /> : <Swarm />}</div>
    </div>
  );
}
