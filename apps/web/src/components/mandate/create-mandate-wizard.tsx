"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { HexChip } from "@/components/ui/hex-chip";
import { StatusBadge } from "@/components/ui/status-badge";
import { PrivacyBoundary, type BoundaryField } from "@/components/ui/privacy-boundary";
import { useSession } from "@/store/session-store";
import type { MandateStatus } from "@warden/shared";

const STEPS = ["Principal", "Agent", "Policy", "Privacy preview", "Confirm"] as const;

type PolicyForm = {
  maxAmount: number;
  asset: string;
  actionType: string;
  destinationCategory: string;
  expiresInSeconds: number;
  actionCountLimit: number;
};

const DEFAULT_POLICY: PolicyForm = {
  maxAmount: 500,
  asset: "DEMO",
  actionType: "payment",
  destinationCategory: "vendor:approved",
  expiresInSeconds: 3600,
  actionCountLimit: 5
};

export function CreateMandateWizard() {
  const router = useRouter();
  const { addMandate } = useSession();

  const [step, setStep] = useState(0);
  const [identity, setIdentity] = useState<{ principalPk: string; agentPk: string } | null>(null);
  const [policy, setPolicy] = useState<PolicyForm>(DEFAULT_POLICY);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; status: MandateStatus } | null>(null);

  useEffect(() => {
    fetch("/api/identity")
      .then((r) => r.json())
      .then(setIdentity)
      .catch(() => setIdentity(null));
  }, []);

  async function create() {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/mandate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(policy)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Failed to create mandate.");

      addMandate({
        id: data.id,
        status: data.status.status,
        spentCommitment: data.status.spentCommitment,
        policy: { ...policy, expiryUnix: Math.floor(Date.now() / 1000) + policy.expiresInSeconds }
      });
      setResult({ id: data.id, status: data.status.status });
      setStep(4);
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const privateFields: BoundaryField[] = [
    { key: "amount", label: "Spending cap", value: `${policy.maxAmount} ${policy.asset}`, note: "Never written to the ledger; checked inside the proof and disclosed only if you reveal it yourself." },
    { key: "type", label: "Action type", value: policy.actionType, note: "Compared against each request inside the circuit, never stored in plaintext." },
    { key: "dest", label: "Destination category", value: policy.destinationCategory, note: "Same — a private policy clause, checked, never published." },
    { key: "count", label: "Action count limit", value: String(policy.actionCountLimit), note: "Enforced against a public counter, but the limit itself stays private." },
    { key: "salt", label: "Commitment salt", note: "32 random bytes generated client-side so identical policies don't collide on-chain." }
  ];
  const publicFields: BoundaryField[] = [
    { key: "expiry", label: "Expiry", value: new Date(Date.now() + policy.expiresInSeconds * 1000).toISOString().slice(0, 16).replace("T", " "), note: "The one policy field the circuit discloses — it's checked with blockTimeLte against the ledger's own real block time, which only works if the value being compared is public." },
    { key: "state", label: "Authorization state", note: "active / revoked / expired — set membership on the public ledger." },
    { key: "count-pub", label: "Action count", note: "A public counter keyed by mandate id — how many times, never for what." },
    { key: "commit", label: "Spend commitment", note: "An opaque hash, re-randomized on every authorize. Changes are visible; amounts are not." }
  ];
  const derivedFields: BoundaryField[] = [
    { key: "id", label: "Mandate id", note: "hash(principalPk, agentPk, policyHash) — a one-way commitment. Assigned once you create the mandate below." }
  ];
  const notProven = [
    "That a real-world identity controls the principal or agent key — only that someone controls the matching secret.",
    "That a requested action's off-chain effect actually happened — Warden authorizes on-chain actions, it does not witness the real world.",
    "That the principal and agent are distinct people — nothing stops one party from holding both secrets."
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <ol className="mb-8 flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border text-xs font-semibold transition ${
                i < step
                  ? "border-sky-500/50 bg-sky-500/20 text-sky-300"
                  : i === step
                    ? "border-sky-400 bg-sky-500 text-slate-950"
                    : "border-white/10 text-slate-600"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </div>
            {i < STEPS.length - 1 && <div className={`h-px flex-1 ${i < step ? "bg-sky-500/40" : "bg-white/10"}`} />}
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.2 }}
          className="panel p-6"
        >
          {step === 0 && (
            <StepBody title="Principal" caption="The party that will hold this mandate's secrets and can revoke it.">
              <p className="text-sm text-slate-400">
                This browser session has one persistent principal identity — a public-key commitment, not a wallet
                address. It's generated once per demo session and reused for every mandate you create here.
              </p>
              {identity ? (
                <div className="mt-4 flex items-center gap-2">
                  <span className="text-xs text-slate-500">principalPk</span>
                  <HexChip value={identity.principalPk} label="principal public key" />
                </div>
              ) : (
                <div className="mt-4 h-6 w-48 rounded skeleton" />
              )}
            </StepBody>
          )}

          {step === 1 && (
            <StepBody title="Agent" caption="The party this mandate authorizes to act, and no further.">
              <p className="text-sm text-slate-400">
                The mandate will be handed off to this session&rsquo;s agent identity out of band — the contract itself
                never transmits it. In production the agent runs in its own process; this demo runs both roles in one
                session (see docs/ARCHITECTURE.md §7).
              </p>
              {identity ? (
                <div className="mt-4 flex items-center gap-2">
                  <span className="text-xs text-slate-500">agentPk</span>
                  <HexChip value={identity.agentPk} label="agent public key" />
                </div>
              ) : (
                <div className="mt-4 h-6 w-48 rounded skeleton" />
              )}
            </StepBody>
          )}

          {step === 2 && (
            <StepBody title="Policy" caption="Every field here stays private — see the next step.">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Max amount">
                  <input
                    type="number"
                    className="input"
                    min={1}
                    value={policy.maxAmount}
                    onChange={(e) => setPolicy((p) => ({ ...p, maxAmount: Number(e.target.value) }))}
                  />
                </Field>
                <Field label="Asset">
                  <input className="input" value={policy.asset} onChange={(e) => setPolicy((p) => ({ ...p, asset: e.target.value }))} />
                </Field>
                <Field label="Action type">
                  <input
                    className="input"
                    value={policy.actionType}
                    onChange={(e) => setPolicy((p) => ({ ...p, actionType: e.target.value }))}
                  />
                </Field>
                <Field label="Destination category">
                  <input
                    className="input"
                    value={policy.destinationCategory}
                    onChange={(e) => setPolicy((p) => ({ ...p, destinationCategory: e.target.value }))}
                  />
                </Field>
                <Field label="Expires in (seconds)">
                  <input
                    type="number"
                    className="input"
                    min={1}
                    value={policy.expiresInSeconds}
                    onChange={(e) => setPolicy((p) => ({ ...p, expiresInSeconds: Number(e.target.value) }))}
                  />
                </Field>
                <Field label="Max actions">
                  <input
                    type="number"
                    className="input"
                    min={1}
                    value={policy.actionCountLimit}
                    onChange={(e) => setPolicy((p) => ({ ...p, actionCountLimit: Number(e.target.value) }))}
                  />
                </Field>
              </div>
            </StepBody>
          )}

          {step === 3 && (
            <StepBody title="Privacy preview" caption="Exactly what becomes public versus what never leaves this policy.">
              <PrivacyBoundary privateFields={privateFields} publicFields={publicFields} derivedFields={derivedFields} notProven={notProven} />
              {createError && <p className="mt-4 text-sm text-rose-400">{createError}</p>}
            </StepBody>
          )}

          {step === 4 && result && (
            <StepBody title="Mandate created" caption="This is the whole public footprint — everything else stayed private.">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 p-3">
                  <span className="text-xs text-slate-500">Mandate id</span>
                  <HexChip value={result.id} label="mandate id" />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 p-3">
                  <span className="text-xs text-slate-500">Status</span>
                  <StatusBadge status={result.status} />
                </div>
              </div>
            </StepBody>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="mt-5 flex justify-between">
        <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || step === 4} className="btn-ghost">
          Back
        </button>
        {step < 3 && (
          <button type="button" onClick={() => setStep((s) => s + 1)} className="btn-primary">
            Continue
          </button>
        )}
        {step === 3 && (
          <button type="button" onClick={create} disabled={creating} className="btn-primary">
            {creating ? "Creating mandate…" : "Create mandate"}
          </button>
        )}
        {step === 4 && result && (
          <button type="button" onClick={() => router.push(`/mandates/${result.id}`)} className="btn-primary">
            Open mandate →
          </button>
        )}
      </div>
    </div>
  );
}

function StepBody({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-lg font-semibold text-white">{title}</h2>
      <p className="mb-5 mt-1 text-sm text-slate-500">{caption}</p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}
