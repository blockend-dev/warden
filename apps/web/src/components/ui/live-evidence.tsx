// Present only when a real network-backed WardenBackend actually submitted
// this specific transaction (see LiveEvidence in packages/sdk/src/network.ts)
// — never fabricated, never shown for a simulator call or a rejected one
// (rejections never reach the chain, so there is no transaction to point
// to). Deliberately small and easy to skip past: this is proof for anyone
// who wants to check it, not the primary UI.
import type { LiveEvidence } from "@warden/sdk";

export function LiveEvidencePanel({ evidence }: { evidence: LiveEvidence }) {
  return (
    <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-50/80 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">Verified on Midnight Preprod</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-slate-500">Transaction</dt>
        <dd className="mono-chip truncate">{evidence.txId}</dd>
        <dt className="text-slate-500">Block</dt>
        <dd className="mono-chip">{evidence.blockHeight.toLocaleString()}</dd>
        <dt className="text-slate-500">Contract</dt>
        <dd className="mono-chip truncate">{evidence.contractAddress}</dd>
      </dl>
    </div>
  );
}
