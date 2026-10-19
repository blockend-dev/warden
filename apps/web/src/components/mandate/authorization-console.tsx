"use client";

import { useRef, useState } from "react";
import { VerificationSteps } from "@/components/ui/verification-steps";
import { LiveEvidencePanel } from "@/components/ui/live-evidence";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { pop, shake } from "@/lib/motion";
import { stepsForOutcome, isNetworkErrorKind, type Step } from "@/lib/verification-steps";
import { useSession, type LocalMandate } from "@/store/session-store";
// Type-only — erased at compile time, does not pull @warden/sdk's runtime
// (or its server-only live-network dependencies) into the client bundle.
import type { LiveEvidence } from "@warden/sdk";

type Outcome = { authorized: true } | { authorized: false; kind: string; message: string };

export function AuthorizationConsole({ mandate }: { mandate: LocalMandate }) {
  const { updateStatus, appendActivity, addSpent, refresh } = useSession();
  const toast = useToast();
  const card = useRef<HTMLDivElement>(null);
  const [amount, setAmount] = useState(String(Math.max(1, Math.round(mandate.policy.maxAmount * 0.24))));
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [failureDetail, setFailureDetail] = useState<string | undefined>();
  const [networkIssue, setNetworkIssue] = useState<string | undefined>();
  const [evidence, setEvidence] = useState<LiveEvidence | undefined>();

  const delegated = mandate.kind === "delegated";
  const actor = delegated ? "Sub-agent" : "Agent";
  const disabled = mandate.status !== "active" || running;
  const amountNum = Number(amount);
  const amountInvalid = !Number.isFinite(amountNum) || amountNum < 1 || !Number.isInteger(amountNum);

  async function submit(amountValue: number, destination = mandate.policy.destinationCategory, label = "action") {
    setRunning(true);
    setSteps(null);
    setNetworkIssue(undefined);
    setEvidence(undefined);
    try {
      const data = await api.authorize({
        id: mandate.id,
        amount: amountValue,
        asset: mandate.policy.asset,
        actionType: mandate.policy.actionType,
        destinationCategory: destination
      });
      const outcome: Outcome = data.authorized
        ? { authorized: true }
        : { authorized: false, kind: data.error?.kind ?? "WardenError", message: data.error?.message ?? "Rejected" };

      // A dead proof server or node isn't a circuit check that failed — it's
      // not a check at all, so the step checklist would misattribute it.
      if (!outcome.authorized && isNetworkErrorKind(outcome.kind)) {
        setNetworkIssue(outcome.message);
        toast({ tone: "warn", title: "Network issue, not a policy refusal", body: outcome.message });
      } else {
        setSteps(stepsForOutcome(outcome, mandate.kind));
      }
      setFailureDetail(outcome.authorized ? undefined : outcome.message);
      if (data.evidence) setEvidence(data.evidence);

      if (data.status) updateStatus(mandate.id, data.status);
      if (outcome.authorized) {
        addSpent(mandate.id, amountValue);
        pop(card.current);
        toast({ tone: "success", title: `Authorized — ${label}`, body: `${amountValue} ${mandate.policy.asset} proven in zero knowledge.` });
      } else if (!isNetworkErrorKind(outcome.kind)) {
        shake(card.current);
        toast({ tone: "error", title: `Refused by the circuit — ${label}`, body: outcome.message.replace(/^.*failed assert:\s*/i, "") });
      }
      appendActivity(mandate.id, {
        kind: outcome.authorized ? "authorized" : "blocked",
        text: outcome.authorized ? "AUTHORIZED" : "REFUSED",
        detail: outcome.authorized ? `requested ${amountValue} ${mandate.policy.asset}` : outcome.message.replace(/^.*failed assert:\s*/i, ""),
        spentCommitment: data.status?.spentCommitment,
        actionsAuthorized: data.status?.actionsAuthorized,
        txId: data.evidence?.txId,
        blockHeight: data.evidence?.blockHeight
      });
    } catch (e) {
      toast({ tone: "error", title: "Request failed", body: (e as Error).message });
      appendActivity(mandate.id, { kind: "error", text: "Request failed", detail: (e as Error).message });
    } finally {
      setRunning(false);
      void refresh();
    }
  }

  return (
    <div ref={card} className="glass p-5">
      <h3 className="eyebrow mb-4">{actor} — request an action</h3>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Amount ({mandate.policy.asset})</span>
          <input
            className="input"
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={amountInvalid}
          />
          {amountInvalid && <span className="text-[11px] text-rose-600">Enter a whole number of at least 1.</span>}
        </label>
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
          <div>
            Action type <span className="mono-chip ml-1">{mandate.policy.actionType}</span>
          </div>
          <div>
            Destination <span className="mono-chip ml-1">{mandate.policy.destinationCategory}</span>
          </div>
        </div>

        <button type="button" className="btn-primary mt-1" disabled={disabled || amountInvalid} onClick={() => submit(amountNum)}>
          {running ? "Proving…" : "Submit action"}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn-ghost !text-rose-700"
            disabled={disabled}
            onClick={() => submit(mandate.policy.maxAmount * 200 + 10000, undefined, "over-cap attack")}
          >
            Over-cap attack
          </button>
          <button
            type="button"
            className="btn-ghost !text-rose-700"
            disabled={disabled}
            onClick={() => submit(1, "vendor:unknown", "wrong-destination attack")}
          >
            Wrong destination
          </button>
        </div>
      </div>

      {(running || steps || networkIssue) && (
        <div className="mt-5 border-t border-slate-900/[0.07] pt-4">
          {running && !steps && !networkIssue && <p className="text-sm text-slate-500">Running the real circuit call…</p>}
          {networkIssue && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-50 p-3 text-xs text-amber-800">
              Live network issue, not a policy rejection: {networkIssue}
            </p>
          )}
          {steps && (
            <>
              <VerificationSteps steps={steps} failureDetail={failureDetail?.replace(/^.*failed assert:\s*/i, "")} />
              <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                Reconstructed from the check order inside <code className="mono-chip">{delegated ? "authorizeDelegated" : "authorize"}</code>{" "}
                in <code className="mono-chip">warden.compact</code>, against the real pass/fail the circuit returned — the circuit reports one
                outcome per call, not a step trace.
              </p>
            </>
          )}
          {evidence && <LiveEvidencePanel evidence={evidence} />}
        </div>
      )}

      {mandate.status !== "active" && (
        <p className="mt-4 text-xs font-medium text-amber-700">
          {mandate.blockedByParent
            ? `Its parent is ${mandate.blockedByParent} — this sub-agent cannot act until that changes.`
            : `This mandate is ${mandate.status} — no further action can be authorized.`}
        </p>
      )}
    </div>
  );
}
