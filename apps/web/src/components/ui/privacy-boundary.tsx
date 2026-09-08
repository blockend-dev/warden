"use client";

// Warden's central UX idea: what a party knows versus what the ledger can
// see are never the same list, and the gap between them is the product.
// This component renders that gap. Every field passed in must be real —
// see callers for where each value actually comes from.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export type BoundaryField = {
  key: string;
  label: string;
  value?: string;
  note: string;
};

type Column = {
  title: string;
  caption: string;
  accent: "private" | "public" | "derived" | "off";
  fields: BoundaryField[];
};

const ACCENT: Record<Column["accent"], { text: string; ring: string; dot: string }> = {
  private: { text: "text-private", ring: "border-private/30 bg-private/[0.06]", dot: "bg-private" },
  public: { text: "text-public", ring: "border-public/30 bg-public/[0.06]", dot: "bg-public" },
  derived: { text: "text-slate-300", ring: "border-white/15 bg-white/[0.03]", dot: "bg-slate-400" },
  off: { text: "text-slate-500", ring: "border-white/10 bg-transparent", dot: "bg-slate-600" }
};

function FieldRow({ field, accent }: { field: BoundaryField; accent: Column["accent"] }) {
  const [open, setOpen] = useState(false);
  const style = ACCENT[accent];
  return (
    <li className="rounded-lg">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-white/[0.04]"
      >
        <span className="flex items-center gap-2 text-sm text-slate-300">
          <span className={`h-1.5 w-1.5 flex-none rounded-full ${style.dot}`} />
          {field.label}
        </span>
        <span className="flex items-center gap-2">
          {field.value && <span className="font-mono text-xs text-slate-500">{field.value}</span>}
          <span className="text-slate-600">{open ? "–" : "+"}</span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <p className="px-2.5 pb-2 pt-0.5 text-xs leading-relaxed text-slate-500">{field.note}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function PrivacyBoundary({
  privateFields,
  publicFields,
  derivedFields,
  notProven
}: {
  privateFields: BoundaryField[];
  publicFields: BoundaryField[];
  derivedFields: BoundaryField[];
  notProven: string[];
}) {
  const columns: Column[] = [
    { title: "Private", caption: "Never leaves the party that holds it", accent: "private", fields: privateFields },
    { title: "Public", caption: "Written to the ledger, readable by anyone", accent: "public", fields: publicFields },
    { title: "Derived", caption: "Computed from private data, then disclosed", accent: "derived", fields: derivedFields }
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {columns.map((col) => (
          <div key={col.title} className={`rounded-xl border p-3 ${ACCENT[col.accent].ring}`}>
            <div className={`mb-0.5 text-xs font-semibold uppercase tracking-wide ${ACCENT[col.accent].text}`}>{col.title}</div>
            <div className="mb-2 text-[11px] text-slate-500">{col.caption}</div>
            {col.fields.length === 0 ? (
              <p className="px-2.5 py-1 text-xs text-slate-600">None</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {col.fields.map((f) => (
                  <FieldRow key={f.key} field={f} accent={col.accent} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {notProven.length > 0 && (
        <div className={`rounded-xl border p-3 ${ACCENT.off.ring}`}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Not proven</div>
          <ul className="flex flex-col gap-1">
            {notProven.map((claim) => (
              <li key={claim} className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
                <span className="mt-0.5 text-slate-600">–</span>
                {claim}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
