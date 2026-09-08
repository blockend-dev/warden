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

  async function copy() {
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
      className="group inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-xs text-slate-300 transition hover:border-white/25 hover:text-slate-100"
    >
      <span>{shorten(value)}</span>
      <span className="text-slate-600 transition group-hover:text-slate-400">{copied ? "✓" : "⧉"}</span>
    </button>
  );
}
