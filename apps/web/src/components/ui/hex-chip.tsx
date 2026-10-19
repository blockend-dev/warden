"use client";

import { useState } from "react";

function shorten(hex: string, head = 8, tail = 6): string {
  return hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** A truncated, monospace, click-to-copy hex value. Never do this for a
 * value that should stay private — this component assumes what it's given
 * is already meant to be shown. */
export function HexChip({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard API unavailable (permissions, non-secure context) — no-op.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      aria-label={label ? `Copy ${label}` : "Copy value"}
      className="group inline-flex items-center gap-1.5 rounded-lg border border-slate-900/10 bg-white/80 px-2 py-1 font-mono text-xs text-slate-700 transition hover:border-sky-500/40 hover:bg-white hover:text-slate-900"
    >
      <span>{shorten(value)}</span>
      <span className={`transition ${copied ? "text-emerald-600" : "text-slate-400 group-hover:text-sky-600"}`}>{copied ? "✓" : "⧉"}</span>
    </button>
  );
}
