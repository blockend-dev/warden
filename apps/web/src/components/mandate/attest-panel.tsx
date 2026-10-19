"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { pop, shake } from "@/lib/motion";
import { useSession, type LocalMandate } from "@/store/session-store";

/** Selective disclosure: the agent proves "I have spent at most X" against the
 * on-chain commitment. The ledger learns X and the action number it was true
 * at — never the real total. A false ceiling has no valid proof. */
export function AttestPanel({ mandate }: { mandate: LocalMandate }) {
  const { mandates, updateStatus, appendActivity, refresh } = useSession();
  const toast = useToast();
  const card = useRef<HTMLDivElement>(null);
  // The committed total includes budget reserved for sub-agents: delegation
  // debits the parent exactly like a payment does.
  const reserved = mandates.filter((m) => m.parentId === mandate.id).reduce((sum, c) => sum + c.policy.maxAmount, 0);
  const committed = mandate.spentKnown + reserved;
  const [ceiling, setCeiling] = useState(String(Math.max(1, committed + 100)));
  const [busy, setBusy] = useState(false);

  const num = Number(ceiling);
  const invalid = !Number.isInteger(num) || num < 1;

  async function attest(value: number, label: string) {
    setBusy(true);
    try {
      const data = await api.attest(mandate.id, value);
      if (data.status) updateStatus(mandate.id, data.status);
      if (data.ok) {
        pop(card.current);
        appendActivity(mandate.id, {
          kind: "attested",
          text: "ATTESTED",
          detail: `proved: spent ≤ ${value} ${mandate.policy.asset} (the real total stayed private)`,
          txId: data.evidence?.txId,
          blockHeight: data.evidence?.blockHeight
        });
        toast({ tone: "success", title: `Attestation published — ${label}`, body: `The ledger now shows “spent ≤ ${value}”. Nothing else.` });
      } else {
        shake(card.current);
        const msg = data.error?.message?.replace(/^.*failed assert:\s*/i, "") ?? "Rejected";
        appendActivity(mandate.id, { kind: "blocked", text: "REFUSED", detail: `attestation: ${msg}` });
        toast({ tone: "error", title: `Attestation refused — ${label}`, body: msg });
      }
    } catch (e) {
      toast({ tone: "error", title: "Request failed", body: (e as Error).message });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  const a = mandate.attestation;

  return (
    <div ref={card} className="glass p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="eyebrow">Auditor attestation</h3>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">New</span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-600">
        Prove a spend ceiling to an auditor without revealing the total. Your private running total here is{" "}
        <strong className="font-mono text-violet-700">{committed}</strong> {mandate.policy.asset} ({mandate.spentKnown} spent + {reserved} reserved for sub-agents) — it never reaches the ledger.
      </p>

      {a ? (
        <div className={`mb-4 rounded-xl border p-3 ${a.stale ? "border-amber-500/30 bg-amber-50" : "border-emerald-500/25 bg-emerald-50"}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-800">
              Public: spent ≤ <span className="font-mono">{a.ceiling}</span>
            </span>
            <span className={`text-[10px] font-bold uppercase tracking-wide ${a.stale ? "text-amber-700" : "text-emerald-700"}`}>
              {a.stale ? "stale" : "current"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            True as of action #{a.atCount}. {a.stale ? "More actions have been authorized since — re-attest for a fresh statement." : "No actions since."}
          </p>
        </div>
      ) : (
        <p className="mb-4 rounded-xl border border-slate-900/[0.07] bg-white/50 p-3 text-xs text-slate-500">No attestation published yet.</p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Ceiling to prove</span>
        <input className="input" type="number" min={1} value={ceiling} onChange={(e) => setCeiling(e.target.value)} aria-invalid={invalid} />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="btn-primary" disabled={busy || invalid || mandate.status === "unknown"} onClick={() => attest(num, "honest")}>
          {busy ? "Proving…" : "Attest"}
        </button>
        <button
          type="button"
          className="btn-ghost !text-rose-700"
          disabled={busy || mandate.status === "unknown" || committed < 1}
          onClick={() => attest(Math.max(1, committed - 1), "false claim")}
          title="Claims a ceiling one below the real spend"
        >
          Attest a lie
        </button>
      </div>
    </div>
  );
}
