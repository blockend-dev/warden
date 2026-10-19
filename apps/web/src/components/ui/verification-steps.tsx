"use client";

import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";
import { prefersReducedMotion } from "@/lib/motion";
import type { Step } from "@/lib/verification-steps";

const ICON: Record<Step["state"], string> = { pass: "✓", fail: "✕", pending: "·" };
const COLOR: Record<Step["state"], string> = {
  pass: "border-emerald-500/40 bg-emerald-50 text-emerald-700",
  fail: "border-rose-500/40 bg-rose-50 text-rose-700",
  pending: "border-slate-900/10 bg-white/60 text-slate-400"
};

export function VerificationSteps({ steps, failureDetail }: { steps: Step[]; failureDetail?: string }) {
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const items = list.current?.querySelectorAll("li");
    if (!items || prefersReducedMotion()) return;
    const anim = animate(items, { opacity: [0, 1], translateX: [-10, 0], delay: stagger(75), duration: 380, ease: "outCubic" });
    return () => {
      anim.pause();
    };
  }, [steps]);

  return (
    <ol ref={list} className="flex flex-col gap-1.5">
      {steps.map((step) => (
        <li key={step.label} className="flex items-center gap-2.5">
          <span className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border text-[11px] font-bold ${COLOR[step.state]}`}>
            {ICON[step.state]}
          </span>
          <span className={`text-sm ${step.state === "pending" ? "text-slate-400" : "text-slate-800"}`}>{step.label}</span>
          {step.state === "fail" && failureDetail && <span className="text-xs text-rose-600">— {failureDetail}</span>}
        </li>
      ))}
    </ol>
  );
}
