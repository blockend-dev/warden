"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { VerificationSteps } from "@/components/ui/verification-steps";
import { stepsForOutcome, type Step } from "@/lib/verification-steps";
import { useSession, type LocalMandate } from "@/store/session-store";

type Outcome = { authorized: true } | { authorized: false; kind: string; message: string };

const PRESETS = [
  { key: "authorized", label: "Authorized action", tone: "primary" as const, amountFactor: 0.24 },
  { key: "attack", label: "Over-cap attempt", tone: "danger" as const, amountFactor: 200 }
];

export function AuthorizationConsole({ mandate }: { mandate: LocalMandate }) {
  const { updateStatus, appendActivity } = useSession();
  const [amount, setAmount] = useState(String(Math.max(1, Math.round(mandate.policy.maxAmount * 0.24))));
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [failureDetail, setFailureDetail] = useState<string | undefined>();

  const disabled = mandate.status !== "active" || running;

  async function submit(amountValue: number) {
    setRunning(true);
    setSteps(null);
    try {
      const res = await fetch("/api/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: mandate.id,
          amount: amountValue,
          asset: mandate.policy.asset,
          actionType: mandate.policy.actionType,
          destinationCategory: mandate.policy.destinationCategory
        })
      });
      const data = await res.json();
      const outcome: Outcome = data.authorized
        ? { authorized: true }
        : { authorized: false, kind: data.error?.kind ?? "WardenError", message: data.error?.message ?? "Rejected" };

      setSteps(stepsForOutcome(outcome));
      setFailureDetail(outcome.authorized ? undefined : outcome.message);

      if (data.status) {
        updateStatus(mandate.id, {
          status: data.status.status,
          actionsAuthorized: data.status.actionsAuthorized,
          spentCommitment: data.status.spentCommitment
        });
      }
      appendActivity(mandate.id, {
        kind: outcome.authorized ? "authorized" : outcome.kind === "MandateRevokedError" ? "revoked" : "blocked",
        text: outcome.authorized ? "AUTHORIZED" : outcome.kind === "MandateRevokedError" ? "REVOKED" : "BLOCKED",
        detail: outcome.authorized ? `requested ${amountValue} ${mandate.policy.asset}` : outcome.message,
        spentCommitment: data.status?.spentCommitment,
        actionsAuthorized: data.status?.actionsAuthorized
      });
    } catch (e) {
      appendActivity(mandate.id, { kind: "error", text: "Request failed", detail: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="panel p-5">
      <h3 className="eyebrow mb-4">Agent — request an action</h3>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Amount ({mandate.policy.asset})</span>
          <input className="input" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
          <div>
            Action type <span className="mono-chip ml-1">{mandate.policy.actionType}</span>
          </div>
          <div>
            Destination <span className="mono-chip ml-1">{mandate.policy.destinationCategory}</span>
          </div>
        </div>

        <div className="mt-1 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={disabled}
            onClick={() => submit(Number(amount))}
          >
            Submit action
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={disabled}
            onClick={() => submit(Math.round(mandate.policy.maxAmount * 200 + 10000))}
          >
            Try over-cap attack
          </button>
        </div>
      </div>

      {(running || steps) && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-5 border-t border-white/10 pt-4">
          {running && !steps && <p className="text-sm text-slate-500">Running the real circuit call…</p>}
          {steps && (
            <>
              <VerificationSteps steps={steps} failureDetail={failureDetail} />
              <p className="mt-3 text-[11px] text-slate-600">
                Reconstructed from the check order inside <code className="mono-chip">authorize</code> in{" "}
                <code className="mono-chip">warden.compact</code>, against the real pass/fail the circuit returned for this
                call — the circuit itself reports one outcome per call, not a step trace.
              </p>
            </>
          )}
        </motion.div>
      )}

      {mandate.status !== "active" && (
        <p className="mt-4 text-xs text-amber-400/80">This mandate is {mandate.status} — no further action can be authorized.</p>
      )}
    </div>
  );
}
