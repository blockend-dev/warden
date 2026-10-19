"use client";

import { useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { pop, shake } from "@/lib/motion";
import { useSession, type LocalMandate } from "@/store/session-store";

/** The root mandate's agent carves a bounded slice out of its own authority
 * for a sub-agent. The circuit reserves that budget against the parent
 * immediately, so siblings can never jointly exceed the parent's cap. */
export function DelegatePanel({ mandate }: { mandate: LocalMandate }) {
  const { mandates, addMandate, updateStatus, appendActivity, refresh } = useSession();
  const toast = useToast();
  const card = useRef<HTMLDivElement>(null);
  const [cap, setCap] = useState("300");
  const [limit, setLimit] = useState("4");
  const [shorter, setShorter] = useState("");
  const [busy, setBusy] = useState(false);

  const children = useMemo(() => mandates.filter((m) => m.parentId === mandate.id), [mandates, mandate.id]);
  const reserved = children.reduce((sum, c) => sum + c.policy.maxAmount, 0);
  const remaining = Math.max(0, mandate.policy.maxAmount - mandate.spentKnown - reserved);

  const capNum = Number(cap);
  const limitNum = Number(limit);
  const invalid = !Number.isInteger(capNum) || capNum < 1 || !Number.isInteger(limitNum) || limitNum < 1;
  const disabled = mandate.status !== "active" || busy || invalid;

  async function delegate(over = false) {
    setBusy(true);
    try {
      const body = {
        parentId: mandate.id,
        maxAmount: over ? mandate.policy.maxAmount * 10 : capNum,
        actionCountLimit: limitNum,
        expiresInSeconds: shorter ? Number(shorter) : undefined
      };
      const data = await api.delegate(body);
      if (data.id && data.status) {
        const expiryUnix = shorter ? Math.floor(Date.now() / 1000) + Number(shorter) : mandate.policy.expiryUnix;
        addMandate({
          id: data.id,
          parentId: mandate.id,
          status: data.status.status,
          spentCommitment: data.status.spentCommitment,
          policy: {
            ...mandate.policy,
            maxAmount: capNum,
            actionCountLimit: limitNum,
            expiryUnix,
            expiresInSeconds: Math.max(0, expiryUnix - Math.floor(Date.now() / 1000))
          }
        });
        if (data.parentStatus) updateStatus(mandate.id, data.parentStatus);
        appendActivity(data.id, {
          kind: "delegated",
          text: "DELEGATED",
          detail: `carved ${capNum} ${mandate.policy.asset} out of ${mandate.label}`,
          spentCommitment: data.status.spentCommitment,
          txId: data.evidence?.txId,
          blockHeight: data.evidence?.blockHeight
        });
        appendActivity(mandate.id, { kind: "delegated", text: "DELEGATED", detail: `reserved ${capNum} ${mandate.policy.asset} for a sub-agent`, txId: data.evidence?.txId, blockHeight: data.evidence?.blockHeight });
        pop(card.current);
        toast({ tone: "success", title: "Sub-agent mandate created", body: `${capNum} ${mandate.policy.asset} reserved against the parent, proven in zero knowledge.` });
      } else {
        shake(card.current);
        appendActivity(mandate.id, { kind: "blocked", text: "REFUSED", detail: `delegation: ${data.error?.message?.replace(/^.*failed assert:\s*/i, "")}` });
        toast({ tone: "error", title: "Delegation refused by the circuit", body: data.error?.message?.replace(/^.*failed assert:\s*/i, "") });
      }
    } catch (e) {
      toast({ tone: "error", title: "Request failed", body: (e as Error).message });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return (
    <div ref={card} className="glass p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="eyebrow">Delegate to a sub-agent</h3>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">New</span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-600">
        Carve a bounded slice out of this mandate. Asset, action type and destination are inherited; the child can be narrower, never wider, and
        cannot outlive its parent.
      </p>

      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <Mini label="Cap" value={mandate.policy.maxAmount} />
        <Mini label="Reserved" value={reserved} />
        <Mini label="Left to carve" value={remaining} tone="text-violet-700" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Child cap</span>
          <input className="input" type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Max actions</span>
          <input className="input" type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Expires in (seconds) — optional, earlier than parent</span>
          <input className="input" type="number" min={1} placeholder="inherit parent expiry" value={shorter} onChange={(e) => setShorter(e.target.value)} />
        </label>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className="btn-accent" disabled={disabled} onClick={() => delegate(false)}>
          {busy ? "Proving…" : "Delegate"}
        </button>
        <button type="button" className="btn-ghost !text-rose-700" disabled={mandate.status !== "active" || busy} onClick={() => delegate(true)}>
          Over-delegate attack
        </button>
      </div>
      {mandate.status !== "active" && <p className="mt-3 text-xs font-medium text-amber-700">Only an active mandate can delegate.</p>}
    </div>
  );
}

function Mini({ label, value, tone = "text-slate-900" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="glass-inset px-2 py-2">
      <div className={`font-display text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
