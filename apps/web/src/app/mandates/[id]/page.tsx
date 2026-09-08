"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { HexChip } from "@/components/ui/hex-chip";
import { PrivacyBoundary, type BoundaryField } from "@/components/ui/privacy-boundary";
import { CommitmentTimeline } from "@/components/mandate/commitment-timeline";
import { AuthorizationConsole } from "@/components/mandate/authorization-console";
import { RevokeDialog } from "@/components/mandate/revoke-dialog";
import { timeLeft } from "@/lib/format";
import { useMandate, useSession } from "@/store/session-store";

export default function MandateDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const mandate = useMandate(id);
  const { hydrated, updateStatus, appendActivity } = useSession();
  const [revealed, setRevealed] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch("/api/mandate")
      .then((r) => r.json())
      .then((data: { mandates: Array<{ id: string; status: "active" | "revoked" | "expired" | "unknown"; actionsAuthorized: number; spentCommitment?: string }> }) => {
        const found = data.mandates.find((m) => m.id === id);
        if (found) {
          updateStatus(id, { status: found.status, actionsAuthorized: found.actionsAuthorized, spentCommitment: found.spentCommitment });
        } else {
          setStale(true);
        }
      })
      .catch(() => {});
    // Refresh once on mount — this session's own actions already update the
    // store directly; this covers opening a detail link on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-14">
        <div className="h-8 w-64 rounded skeleton" />
        <div className="mt-4 h-40 w-full rounded-2xl skeleton" />
      </div>
    );
  }

  if (!mandate) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <p className="text-slate-400">No mandate with this id in your local session.</p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-sky-400 hover:text-sky-300">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  const privateFields: BoundaryField[] = revealed
    ? [
        { key: "amount", label: "Spending cap", value: `${mandate.policy.maxAmount} ${mandate.policy.asset}`, note: "Known here only because this browser typed it in as principal — never returned by any API." },
        { key: "type", label: "Action type", value: mandate.policy.actionType, note: "Checked inside the circuit on every authorize call, never stored in plaintext." },
        { key: "dest", label: "Destination category", value: mandate.policy.destinationCategory, note: "Same — a private policy clause." },
        { key: "count", label: "Action count limit", value: String(mandate.policy.actionCountLimit), note: "The limit is private; only the running count is public." }
      ]
    : [
        { key: "amount", label: "Spending cap", note: "Hidden — click “Reveal” above." },
        { key: "type", label: "Action type", note: "Hidden — click “Reveal” above." },
        { key: "dest", label: "Destination category", note: "Hidden — click “Reveal” above." },
        { key: "count", label: "Action count limit", note: "Hidden — click “Reveal” above." }
      ];

  const publicFields: BoundaryField[] = [
    { key: "expiry", label: "Expiry", value: timeLeft(mandate.policy.expiryUnix), note: "Checked with blockTimeLte against the ledger's real block time — the one policy field the circuit discloses." },
    { key: "state", label: "Authorization state", value: mandate.status, note: "registered / revoked set membership on the public ledger." },
    { key: "count-pub", label: "Action count", value: String(mandate.actionsAuthorized), note: "A public counter — how many times this mandate has authorized something. The limit it's checked against stays private." },
    { key: "commit", label: "Spend commitment", value: mandate.spentCommitment ? `${mandate.spentCommitment.slice(0, 10)}…` : "—", note: "Opaque hash, re-randomized on every authorize. A change is visible; the amount behind it is not." }
  ];

  const derivedFields: BoundaryField[] = [{ key: "id", label: "Mandate id", value: `${mandate.id.slice(0, 10)}…`, note: "hash(principalPk, agentPk, policyHash) — the one-way commitment everything above is addressed by." }];

  const notProven = [
    "That a real-world identity controls the principal or agent key — only that someone controls the matching secret.",
    "That a requested action's off-chain effect actually happened — Warden authorizes on-chain actions, it does not witness the real world.",
    "That the principal and agent are distinct people — nothing stops one party from holding both secrets."
  ];

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      {stale && (
        <div className="mb-6 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
          This mandate isn&rsquo;t in the current server session (it likely restarted) — showing the last known state from
          this browser.
        </div>
      )}

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="eyebrow">{mandate.label}</span>
          <div className="mt-2 flex items-center gap-3">
            <HexChip value={mandate.id} label="mandate id" />
            <StatusBadge status={mandate.status} />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRevokeOpen(true)}
          disabled={mandate.status === "revoked"}
          className="btn-danger"
        >
          Revoke mandate
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr,1fr]">
        <div className="flex flex-col gap-6">
          <section className="panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="eyebrow">Privacy boundary</h2>
              <button type="button" onClick={() => setRevealed((v) => !v)} className="btn-ghost !px-3 !py-1.5 text-xs">
                {revealed ? "Hide private policy" : "Reveal private policy"}
              </button>
            </div>
            <PrivacyBoundary privateFields={privateFields} publicFields={publicFields} derivedFields={derivedFields} notProven={notProven} />
          </section>

          <section className="panel p-5">
            <h2 className="eyebrow mb-4">Commitment history</h2>
            <CommitmentTimeline activity={mandate.activity} />
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <AuthorizationConsole mandate={mandate} />
        </div>
      </div>

      <RevokeDialog
        open={revokeOpen}
        mandateId={mandate.id}
        onCancel={() => setRevokeOpen(false)}
        onConfirm={async () => {
          try {
            const res = await fetch("/api/revoke", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id: mandate.id })
            });
            const data = await res.json();
            if (data.revoked) {
              updateStatus(mandate.id, {
                status: data.status.status,
                actionsAuthorized: data.status.actionsAuthorized,
                spentCommitment: data.status.spentCommitment
              });
              appendActivity(mandate.id, { kind: "revoked", text: "REVOKED", detail: "future authorize calls will be rejected by the circuit" });
            }
          } finally {
            setRevokeOpen(false);
          }
        }}
      />
    </div>
  );
}
