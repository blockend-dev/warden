"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { animate } from "animejs";
import { HexChip } from "@/components/ui/hex-chip";
import { StatusBadge } from "@/components/ui/status-badge";
import { PrivacyBoundary, type BoundaryField } from "@/components/ui/privacy-boundary";
import { LiveEvidencePanel } from "@/components/ui/live-evidence";
import { useToast } from "@/components/ui/toast";
import { api, DEFAULT_POLICY, type PolicyForm } from "@/lib/api-client";
import { prefersReducedMotion } from "@/lib/motion";
import { useSession } from "@/store/session-store";
import type { MandateStatus } from "@warden/shared";
// Type-only — erased at compile time, no runtime/client-bundle impact.
import type { LiveEvidence } from "@warden/sdk";

const STEPS = ["Principal", "Agent", "Policy", "Privacy preview", "Confirm"] as const;

function validate(p: PolicyForm): string | null {
  if (!Number.isInteger(p.maxAmount) || p.maxAmount < 1) return "Max amount must be a whole number of at least 1.";
  if (!p.asset.trim() || !p.actionType.trim() || !p.destinationCategory.trim()) return "Asset, action type and destination are required.";
  for (const v of [p.asset, p.actionType, p.destinationCategory]) {
    if (new TextEncoder().encode(v).length > 32) return `"${v}" is longer than 32 bytes once encoded.`;
  }
  if (!Number.isInteger(p.expiresInSeconds) || p.expiresInSeconds < 5) return "Expiry must be at least 5 seconds from now.";
  if (!Number.isInteger(p.actionCountLimit) || p.actionCountLimit < 1 || p.actionCountLimit > 65535) return "Max actions must be between 1 and 65,535.";
  return null;
}

export function CreateMandateWizard() {
  const router = useRouter();
  const toast = useToast();
  const { addMandate, appendActivity } = useSession();
  const body = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState(0);
  const [identity, setIdentity] = useState<{ principalPk: string; agentPk: string } | null>(null);
  const [policy, setPolicy] = useState<PolicyForm>({ ...DEFAULT_POLICY, maxAmount: 500, actionCountLimit: 5 });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; status: MandateStatus; evidence?: LiveEvidence } | null>(null);

  const problem = validate(policy);

  useEffect(() => {
    api.identity().then(setIdentity).catch(() => setIdentity(null));
  }, []);

  useEffect(() => {
    if (body.current && !prefersReducedMotion()) {
      animate(body.current, { opacity: [0, 1], translateX: [18, 0], duration: 420, ease: "outCubic" });
    }
  }, [step]);

  async function create() {
    setCreating(true);
    setCreateError(null);
    try {
      const data = await api.createMandate(policy);
      if (!data.id || !data.status) throw new Error(data.error?.message ?? "Failed to create mandate.");

      const m = addMandate({
        id: data.id,
        status: data.status.status,
        spentCommitment: data.status.spentCommitment,
        policy: { ...policy, expiryUnix: Math.floor(Date.now() / 1000) + policy.expiresInSeconds }
      });
      appendActivity(m.id, {
        kind: "created",
        text: "CREATED",
        detail: "genesis spend commitment written",
        spentCommitment: data.status.spentCommitment,
        txId: data.evidence?.txId,
        blockHeight: data.evidence?.blockHeight
      });
      setResult({ id: data.id, status: data.status.status, evidence: data.evidence });
      toast({ tone: "success", title: "Mandate created", body: "Only its id, expiry and an opaque commitment are public." });
      setStep(4);
    } catch (e) {
      setCreateError((e as Error).message);
      toast({ tone: "error", title: "Could not create the mandate", body: (e as Error).message });
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
    { key: "state", label: "Authorization state", note: "active / paused / revoked — set membership on the public ledger." },
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

  const set = <K extends keyof PolicyForm>(key: K, value: PolicyForm[K]) => setPolicy((p) => ({ ...p, [key]: value }));

  return (
    <div className="mx-auto max-w-2xl">
      <ol className="mb-8 flex items-center gap-2" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={i === step ? "step" : undefined}>
            <div
              title={label}
              className={`flex h-8 w-8 flex-none items-center justify-center rounded-full border text-xs font-bold transition ${
                i < step
                  ? "border-emerald-500/40 bg-emerald-50 text-emerald-700"
                  : i === step
                    ? "border-slate-900 bg-slate-900 text-white shadow-lg"
                    : "border-slate-900/10 bg-white/60 text-slate-400"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </div>
            {i < STEPS.length - 1 && <div className={`h-px flex-1 ${i < step ? "bg-emerald-400/60" : "bg-slate-900/10"}`} />}
          </li>
        ))}
      </ol>

      <div ref={body} className="glass p-6">
        {step === 0 && (
          <StepBody title="Principal" caption="The party that will hold this mandate's secrets and can revoke or pause it.">
            <p className="text-sm leading-relaxed text-slate-600">
              This browser session has one persistent principal identity — a public-key commitment, not a wallet address. It's generated
              once per demo session and reused for every mandate you create here.
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
          <StepBody title="Agent" caption="The party this mandate authorizes to act — and, optionally, to delegate further.">
            <p className="text-sm leading-relaxed text-slate-600">
              The mandate is handed off to this session&rsquo;s agent identity out of band — the contract itself never transmits it. After
              creation the agent can carve bounded sub-mandates for sub-agents. In production each role runs in its own process.
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
                <input type="number" className="input" min={1} value={policy.maxAmount} onChange={(e) => set("maxAmount", Number(e.target.value))} />
              </Field>
              <Field label="Asset">
                <input className="input" value={policy.asset} onChange={(e) => set("asset", e.target.value)} />
              </Field>
              <Field label="Action type">
                <input className="input" value={policy.actionType} onChange={(e) => set("actionType", e.target.value)} />
              </Field>
              <Field label="Destination category">
                <input className="input" value={policy.destinationCategory} onChange={(e) => set("destinationCategory", e.target.value)} />
              </Field>
              <Field label="Expires in (seconds)">
                <input type="number" className="input" min={5} value={policy.expiresInSeconds} onChange={(e) => set("expiresInSeconds", Number(e.target.value))} />
              </Field>
              <Field label="Max actions">
                <input type="number" className="input" min={1} value={policy.actionCountLimit} onChange={(e) => set("actionCountLimit", Number(e.target.value))} />
              </Field>
            </div>
            {problem && <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{problem}</p>}
          </StepBody>
        )}

        {step === 3 && (
          <StepBody title="Privacy preview" caption="Exactly what becomes public versus what never leaves this policy.">
            <PrivacyBoundary privateFields={privateFields} publicFields={publicFields} derivedFields={derivedFields} notProven={notProven} />
            {createError && <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{createError}</p>}
          </StepBody>
        )}

        {step === 4 && result && (
          <StepBody title="Mandate created" caption="This is the whole public footprint — everything else stayed private.">
            <div className="flex flex-col gap-3">
              <div className="glass-inset flex items-center justify-between p-3">
                <span className="text-xs text-slate-500">Mandate id</span>
                <HexChip value={result.id} label="mandate id" />
              </div>
              <div className="glass-inset flex items-center justify-between p-3">
                <span className="text-xs text-slate-500">Status</span>
                <StatusBadge status={result.status} />
              </div>
            </div>
            {result.evidence && <LiveEvidencePanel evidence={result.evidence} />}
            <p className="mt-4 text-xs leading-relaxed text-slate-500">
              Next: open the mandate to make payments, delegate a slice to a sub-agent, pause it, or attest a spend ceiling.
            </p>
          </StepBody>
        )}
      </div>

      <div className="mt-5 flex justify-between">
        <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || step === 4} className="btn-ghost">
          Back
        </button>
        {step < 3 && (
          <button type="button" onClick={() => setStep((s) => s + 1)} disabled={step === 2 && problem !== null} className="btn-primary">
            Continue
          </button>
        )}
        {step === 3 && (
          <button type="button" onClick={create} disabled={creating || problem !== null} className="btn-accent">
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
      <h2 className="font-display text-xl font-semibold text-slate-900">{title}</h2>
      <p className="mb-5 mt-1 text-sm text-slate-500">{caption}</p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
