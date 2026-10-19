"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { HexChip } from "@/components/ui/hex-chip";
import { PrivacyBoundary, type BoundaryField } from "@/components/ui/privacy-boundary";
import { useToast } from "@/components/ui/toast";
import { DelegationGraph } from "@/components/graph/delegation-graph";
import { CommitmentTimeline } from "@/components/mandate/commitment-timeline";
import { AuthorizationConsole } from "@/components/mandate/authorization-console";
import { DelegatePanel } from "@/components/mandate/delegate-panel";
import { AttestPanel } from "@/components/mandate/attest-panel";
import { RevokeDialog } from "@/components/mandate/revoke-dialog";
import { api } from "@/lib/api-client";
import { timeLeft } from "@/lib/format";
import { pop, useReveal } from "@/lib/motion";
import { useMandate, useSession } from "@/store/session-store";

export default function MandateDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const mandate = useMandate(id);
  const { mandates, hydrated, updateStatus, appendActivity, refresh, serverLost } = useSession();
  const toast = useToast();
  const page = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [pausing, setPausing] = useState(false);

  useEffect(() => {
    if (hydrated) void refresh();
  }, [hydrated, id, refresh]);

  const children = useMemo(() => mandates.filter((m) => m.parentId === id), [mandates, id]);
  const parent = useMemo(() => mandates.find((m) => m.id === mandate?.parentId), [mandates, mandate?.parentId]);
  const graphScope = useMemo(
    () => mandates.filter((m) => m.id === (mandate?.kind === "delegated" ? mandate.parentId : id) || m.parentId === (mandate?.kind === "delegated" ? mandate?.parentId : id)),
    [mandates, mandate, id]
  );

  useReveal(page, [hydrated, mandate?.id, children.length]);

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-14">
        <div className="h-8 w-64 rounded skeleton" />
        <div className="mt-4 h-40 w-full rounded-3xl skeleton" />
      </div>
    );
  }

  if (!mandate) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <p className="text-slate-600">No mandate with this id in your local session.</p>
        <p className="mt-1 text-xs text-slate-400">For someone else&rsquo;s mandate, use the public verifier.</p>
        <div className="mt-5 flex justify-center gap-3">
          <Link href="/" className="btn-ghost">
            ← Dashboard
          </Link>
          <Link href={`/verify?id=${id}`} className="btn-primary">
            Verify publicly
          </Link>
        </div>
      </div>
    );
  }

  const delegated = mandate.kind === "delegated";
  const reserved = children.reduce((sum, c) => sum + c.policy.maxAmount, 0);
  const isPaused = mandate.status === "paused" && !mandate.blockedByParent;

  async function togglePause() {
    if (!mandate) return;
    setPausing(true);
    try {
      const next = !isPaused;
      const data = await api.pause(mandate.id, next);
      if (data.ok && data.status) {
        updateStatus(mandate.id, data.status);
        appendActivity(mandate.id, {
          kind: next ? "paused" : "resumed",
          text: next ? "PAUSED" : "RESUMED",
          detail: next ? "reversible freeze — the subtree is suspended" : "spend state intact; authority restored",
          txId: data.evidence?.txId,
          blockHeight: data.evidence?.blockHeight
        });
        toast({ tone: next ? "warn" : "success", title: next ? "Mandate paused" : "Mandate resumed", body: next ? "The mandate and every sub-agent are suspended until you resume." : "Authority restored; nothing was lost." });
        pop(page.current?.querySelector("[data-status-bar]") ?? null);
      } else {
        toast({ tone: "error", title: "Could not change pause state", body: data.error?.message?.replace(/^.*failed assert:\s*/i, "") });
      }
    } finally {
      setPausing(false);
      void refresh();
    }
  }

  function exportPacket() {
    if (!mandate) return;
    const packet = {
      kind: "warden.audit-packet/v1",
      generatedAt: new Date().toISOString(),
      note: "Public ledger data only. The policy, the agent secret and the real spend total are not included.",
      mandate: {
        id: mandate.id,
        type: mandate.kind,
        parentId: mandate.parentId ?? null,
        status: mandate.status,
        actionsAuthorized: mandate.actionsAuthorized,
        spentCommitment: mandate.spentCommitment ?? null,
        expiryUnix: mandate.policy.expiryUnix,
        attestation: mandate.attestation ?? null,
        children: children.map((c) => c.id)
      },
      history: [...mandate.activity].reverse().map((a) => ({
        at: new Date(a.ts).toISOString(),
        event: a.text,
        actionsAuthorized: a.actionsAuthorized ?? null,
        spentCommitment: a.spentCommitment ?? null,
        txId: a.txId ?? null,
        blockHeight: a.blockHeight ?? null
      }))
    };
    const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `warden-audit-${mandate.id.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ tone: "info", title: "Audit packet downloaded", body: "Public data only — safe to hand to an auditor." });
  }

  const privateFields: BoundaryField[] = revealed
    ? [
        { key: "amount", label: "Spending cap", value: `${mandate.policy.maxAmount} ${mandate.policy.asset}`, note: "Known here only because this browser typed it in as principal — never returned by any API." },
        { key: "spent", label: "Running spend", value: `${mandate.spentKnown + reserved} ${mandate.policy.asset}`, note: "Direct spend plus budget reserved for sub-agents. Lives only in the agent's private state; the ledger holds an opaque, re-randomized commitment to it." },
        { key: "type", label: "Action type", value: mandate.policy.actionType, note: "Checked inside the circuit on every call, never stored in plaintext." },
        { key: "dest", label: "Destination category", value: mandate.policy.destinationCategory, note: "Same — a private policy clause." },
        { key: "count", label: "Action count limit", value: String(mandate.policy.actionCountLimit), note: "The limit is private; only the running count is public." }
      ]
    : ["Spending cap", "Running spend", "Action type", "Destination category", "Action count limit"].map((label) => ({
        key: label,
        label,
        note: "Hidden — click “Reveal private policy” above."
      }));

  const publicFields: BoundaryField[] = [
    { key: "expiry", label: "Expiry", value: timeLeft(mandate.policy.expiryUnix), note: "Checked with blockTimeLte against the ledger's real block time — the one policy field the circuit discloses." },
    { key: "state", label: "Authorization state", value: mandate.status, note: "registered / revoked / paused set membership on the public ledger." },
    { key: "count-pub", label: "Action count", value: String(mandate.actionsAuthorized), note: "A public counter — how many times, never for what. The limit it is checked against stays private." },
    { key: "commit", label: "Spend commitment", value: mandate.spentCommitment ? `${mandate.spentCommitment.slice(0, 10)}…` : "—", note: "Opaque hash, re-randomized on every call. A change is visible; the amount behind it is not." },
    ...(delegated
      ? [{ key: "parent", label: "Parent id", value: `${mandate.parentId?.slice(0, 10)}…`, note: "Public by design: revoking a parent must visibly and verifiably cut its children. This reveals the tree's shape, not any policy." }]
      : []),
    ...(mandate.attestation
      ? [{ key: "att", label: "Attested ceiling", value: `≤ ${mandate.attestation.ceiling}`, note: "The only spend-related number the ledger holds — a ceiling the agent proved, not the total." }]
      : [])
  ];

  const derivedFields: BoundaryField[] = [
    { key: "id", label: "Mandate id", value: `${mandate.id.slice(0, 10)}…`, note: delegated ? "hash(parentId, principalPk, agentPk, policyHash) under a distinct domain prefix — a delegated id can never validate as a root id." : "hash(principalPk, agentPk, policyHash) — the one-way commitment everything above is addressed by." }
  ];

  const notProven = [
    "That a real-world identity controls the principal or agent key — only that someone controls the matching secret.",
    "That a requested action's off-chain effect actually happened — Warden authorizes on-chain actions, it does not witness the real world.",
    "That the principal and agent are distinct people — nothing stops one party from holding both secrets."
  ];

  return (
    <div ref={page} className="mx-auto max-w-6xl px-4 pb-6 pt-10 sm:px-6 sm:pt-14">
      {serverLost && (
        <div data-reveal className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          The server no longer recognises this mandate (it restarted — demo sessions live in memory). Showing the last known state from this browser.
        </div>
      )}

      <div data-reveal data-status-bar className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="eyebrow">{mandate.label}</span>
            {delegated && (
              <span className="rounded-full border border-violet-500/25 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">delegated</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <HexChip value={mandate.id} label="mandate id" />
            <StatusBadge status={mandate.status} />
            {parent && (
              <Link href={`/mandates/${parent.id}`} className="text-xs font-semibold text-sky-700 hover:underline">
                ↑ from {parent.label}
              </Link>
            )}
            <Link href={`/verify?id=${mandate.id}`} className="text-xs font-semibold text-slate-500 hover:text-sky-700 hover:underline">
              Public view ↗
            </Link>
          </div>
          {mandate.blockedByParent && (
            <p className="mt-3 inline-block rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700">
              Cut off by its parent ({mandate.blockedByParent}). This mandate&rsquo;s own ledger flag is untouched — the circuit checks the parent live.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportPacket} className="btn-ghost">
            ⬇ Audit packet
          </button>
          {!delegated && (
            <button
              type="button"
              onClick={togglePause}
              disabled={pausing || mandate.status === "revoked" || mandate.status === "expired" || mandate.status === "unknown"}
              className="btn-amber"
            >
              {pausing ? "…" : isPaused ? "▶ Resume" : "⏸ Pause"}
            </button>
          )}
          <button type="button" onClick={() => setRevokeOpen(true)} disabled={mandate.status === "revoked"} className="btn-danger">
            Revoke{!delegated && children.length > 0 ? ` (+${children.length} sub-agents)` : ""}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr,1fr]">
        <div className="flex flex-col gap-6">
          {graphScope.length > 1 && (
            <section data-reveal className="glass p-4">
              <h2 className="eyebrow mb-1 px-1">Delegation tree</h2>
              <DelegationGraph mandates={graphScope} highlightId={mandate.id} />
            </section>
          )}

          <section data-reveal className="glass p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="eyebrow">Privacy boundary</h2>
              <button type="button" onClick={() => setRevealed((v) => !v)} className="btn-ghost !px-3 !py-1.5 text-xs">
                {revealed ? "Hide private policy" : "Reveal private policy"}
              </button>
            </div>
            <PrivacyBoundary privateFields={privateFields} publicFields={publicFields} derivedFields={derivedFields} notProven={notProven} />
          </section>

          <section data-reveal className="glass p-5">
            <h2 className="eyebrow mb-4">Commitment history</h2>
            <CommitmentTimeline activity={mandate.activity} />
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <div data-reveal>
            <AuthorizationConsole mandate={mandate} />
          </div>
          {!delegated && (
            <div data-reveal>
              <DelegatePanel mandate={mandate} />
            </div>
          )}
          {!delegated && (
            <div data-reveal>
              <AttestPanel mandate={mandate} />
            </div>
          )}
        </div>
      </div>

      <RevokeDialog
        open={revokeOpen}
        mandateId={mandate.id}
        childCount={children.length}
        delegated={delegated}
        onCancel={() => setRevokeOpen(false)}
        onConfirm={async () => {
          try {
            const data = await api.revoke(mandate.id);
            if (data.revoked && data.status) {
              updateStatus(mandate.id, data.status);
              appendActivity(mandate.id, { kind: "revoked", text: "REVOKED", detail: "future calls are rejected by the circuit", txId: data.evidence?.txId, blockHeight: data.evidence?.blockHeight });
              toast({ tone: "warn", title: "Mandate revoked", body: children.length ? `${children.length} sub-agent${children.length === 1 ? " is" : "s are"} now cut off too.` : "Permanent and publicly verifiable." });
            } else {
              toast({ tone: "error", title: "Revocation failed", body: data.error?.message?.replace(/^.*failed assert:\s*/i, "") });
            }
          } finally {
            setRevokeOpen(false);
            void refresh();
          }
        }}
      />
    </div>
  );
}
