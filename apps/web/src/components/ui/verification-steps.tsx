"use client";

import { motion } from "framer-motion";
import type { Step } from "@/lib/verification-steps";

const ICON: Record<Step["state"], string> = { pass: "✓", fail: "✕", pending: "·" };
const COLOR: Record<Step["state"], string> = {
  pass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  fail: "border-rose-500/40 bg-rose-500/15 text-rose-300",
  pending: "border-white/10 bg-white/[0.02] text-slate-600"
};

export function VerificationSteps({ steps, failureDetail }: { steps: Step[]; failureDetail?: string }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((step, i) => (
        <motion.li
          key={step.label}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.07, duration: 0.22 }}
          className="flex items-center gap-2.5"
        >
          <span
            className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border text-[11px] font-bold ${COLOR[step.state]}`}
          >
            {ICON[step.state]}
          </span>
          <span className={`text-sm ${step.state === "pending" ? "text-slate-600" : "text-slate-300"}`}>{step.label}</span>
          {step.state === "fail" && failureDetail && <span className="text-xs text-rose-400/80">— {failureDetail}</span>}
        </motion.li>
      ))}
    </ol>
  );
}
