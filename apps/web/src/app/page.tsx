"use client";

import { useCallback, useState } from "react";

type MandateStatus = { status: "active" | "revoked" | "expired" | "unknown"; actionsAuthorized: number };
type LogEntry = { id: number; kind: "created" | "authorized" | "blocked" | "revoked" | "error"; text: string; detail?: string };

const DEFAULT_POLICY = {
  maxAmount: 500,
  asset: "DEMO",
  actionType: "payment",
  destinationCategory: "vendor:approved",
  expiresInSeconds: 3600,
  actionCountLimit: 5
};

let logCounter = 0;

export default function Page() {
  const [mandateId, setMandateId] = useState<string | null>(null);
  const [status, setStatus] = useState<MandateStatus | null>(null);
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [policyRevealed, setPolicyRevealed] = useState(false);

  const pushLog = useCallback((entry: Omit<LogEntry, "id">) => {
    logCounter += 1;
    setLog((prev) => [{ id: logCounter, ...entry }, ...prev].slice(0, 8));
  }, []);

  const createMandate = useCallback(async () => {
    setBusy("create");
    setPolicyRevealed(false);
    try {
      const res = await fetch("/api/mandate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(policy)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "failed to create mandate");
      setMandateId(data.id);
      setStatus(data.status);
      pushLog({ kind: "created", text: "Mandate created", detail: `id ${shorten(data.id)}` });
    } catch (e) {
      pushLog({ kind: "error", text: "Could not create mandate", detail: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }, [policy, pushLog]);

  const runAction = useCallback(
    async (label: string, amount: number) => {
      if (!mandateId) return;
      setBusy(label);
      try {
        const res = await fetch("/api/authorize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            amount,
            asset: policy.asset,
            actionType: policy.actionType,
            destinationCategory: policy.destinationCategory
          })
        });
        const data = await res.json();
        if (data.authorized) {
          setStatus(data.status);
          pushLog({ kind: "authorized", text: "AUTHORIZED", detail: `action #${data.status.actionsAuthorized}` });
        } else {
          const kind = data.error?.kind === "MandateRevokedError" ? "revoked" : "blocked";
          pushLog({
            kind,
            text: kind === "revoked" ? "REVOKED" : "BLOCKED — POLICY VIOLATION",
            detail: data.error?.message
          });
        }
      } catch (e) {
        pushLog({ kind: "error", text: "Request failed", detail: (e as Error).message });
      } finally {
        setBusy(null);
      }
    },
    [mandateId, policy, pushLog]
  );

  const revoke = useCallback(async () => {
    if (!mandateId) return;
    setBusy("revoke");
    try {
      const res = await fetch("/api/revoke", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.revoked) throw new Error(data.error?.message ?? "revoke failed");
      setStatus(data.status);
      pushLog({ kind: "revoked", text: "Agent revoked", detail: "future actions will be rejected by the circuit" });
    } catch (e) {
      pushLog({ kind: "error", text: "Could not revoke", detail: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }, [mandateId, pushLog]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <span className="w-fit rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium uppercase tracking-widest text-sky-300">
          Midnight Buildathon · Wave 1
        </span>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">Warden</h1>
        <p className="max-w-2xl text-lg text-slate-400">
          Give AI agents real on-chain authority without giving them unrestricted power.
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.1fr,1fr]">
        {/* Mandate creation */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">1 · Principal — create mandate</h2>
          <p className="mb-5 text-sm text-slate-500">
            These values are the mandate&rsquo;s private policy. They are never sent anywhere they can be read back from
            once the mandate exists — see <code className="text-slate-300">docs/PRIVACY.md</code>.
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Max amount">
              <input
                type="number"
                className="input"
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
                value={policy.expiresInSeconds}
                onChange={(e) => setPolicy((p) => ({ ...p, expiresInSeconds: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Max actions">
              <input
                type="number"
                className="input"
                value={policy.actionCountLimit}
                onChange={(e) => setPolicy((p) => ({ ...p, actionCountLimit: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <button
            onClick={createMandate}
            disabled={busy === "create"}
            className="mt-5 w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
          >
            {busy === "create" ? "Generating mandate…" : mandateId ? "Create new mandate" : "Create mandate"}
          </button>
        </div>

        {/* Live authorization card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Authorization card</h2>
          {!mandateId ? (
            <p className="text-sm text-slate-500">No mandate yet — create one to begin.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <Row label="AGENT">Treasury Agent #01</Row>
              <Row label="MANDATE ID (public)">
                <span className="font-mono text-xs text-slate-300">{shorten(mandateId)}</span>
              </Row>
              <Row label="STATUS">
                <StatusBadge status={status?.status ?? "unknown"} />
              </Row>
              <Row label="PRIVATE POLICY">
                <button
                  onClick={() => setPolicyRevealed((v) => !v)}
                  className="rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-xs text-slate-400 hover:text-slate-200"
                  title="This only ever reveals what THIS browser's principal session already holds locally — never a network round-trip."
                >
                  {policyRevealed
                    ? `cap ${policy.maxAmount} · ${policy.asset} · ${policy.actionType} · ${policy.destinationCategory}`
                    : "████████████████"}
                </button>
              </Row>
              <Row label="ACTIONS AUTHORIZED">{status?.actionsAuthorized ?? 0}</Row>

              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  onClick={() => runAction("valid", 120)}
                  disabled={busy !== null}
                  className="rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  2 · Agent — authorized action (120)
                </button>
                <button
                  onClick={() => runAction("attack", 99999)}
                  disabled={busy !== null}
                  className="rounded-lg bg-amber-500/90 px-3 py-2 text-sm font-semibold text-amber-950 transition hover:bg-amber-400 disabled:opacity-50"
                >
                  3 · Agent — over-cap attempt
                </button>
                <button
                  onClick={revoke}
                  disabled={busy !== null}
                  className="rounded-lg bg-rose-500/90 px-3 py-2 text-sm font-semibold text-rose-950 transition hover:bg-rose-400 disabled:opacity-50"
                >
                  4 · Principal — revoke agent
                </button>
                <button
                  onClick={() => runAction("post-revoke", 120)}
                  disabled={busy !== null}
                  className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/20 disabled:opacity-50"
                >
                  5 · Agent — retry after revoke
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Activity log */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">What happened</h2>
        {log.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {log.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-sm">
                <OutcomeDot kind={entry.kind} />
                <span className="font-semibold text-slate-200">{entry.text}</span>
                {entry.detail && <span className="truncate text-slate-500">— {entry.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="text-xs text-slate-600">
        Every state above reflects a real call into the compiled <code>warden.compact</code> circuit via{" "}
        <code>@warden/sdk</code> — see <code>docs/DEMO.md</code> for the walkthrough this page follows and{" "}
        <code>docs/IMPLEMENTATION-NOTES.md</code> for what running against a live Midnight network still requires.
      </footer>
    </main>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 pb-2">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-sm text-slate-200">{children}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: MandateStatus["status"] }) {
  const styles: Record<MandateStatus["status"], string> = {
    active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    revoked: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    expired: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    unknown: "bg-white/10 text-slate-300 border-white/20"
  };
  return <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase ${styles[status]}`}>{status}</span>;
}

function OutcomeDot({ kind }: { kind: LogEntry["kind"] }) {
  const color: Record<LogEntry["kind"], string> = {
    created: "bg-sky-400",
    authorized: "bg-emerald-400",
    blocked: "bg-amber-400",
    revoked: "bg-rose-400",
    error: "bg-slate-500"
  };
  return <span className={`h-2 w-2 flex-none rounded-full ${color[kind]} ${kind === "authorized" ? "proof-pulse" : ""}`} />;
}

function shorten(hex: string): string {
  return hex.length <= 14 ? hex : `${hex.slice(0, 8)}…${hex.slice(-6)}`;
}
