"use client";

import { useRef, useState } from "react";
import { HexChip } from "@/components/ui/hex-chip";
import { useToast } from "@/components/ui/toast";
import { useReveal } from "@/lib/motion";
import { PREPROD_CONTRACT, PREPROD_DEPLOY, PREPROD_STEPS } from "@/lib/preprod-evidence";

type Proof =
  | { configured: false }
  | { configured: true; reachable: false; status?: number }
  | { configured: true; reachable: true; contractFound: boolean; actionType: string | null; chainHeight: number | null; checkedAt: string };

export default function PreprodPage() {
  const root = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [proof, setProof] = useState<Proof | null>(null);
  const [checking, setChecking] = useState(false);
  useReveal(root, []);

  const txCount = PREPROD_STEPS.filter((s) => s.tx).length + 1;
  const refused = PREPROD_STEPS.filter((s) => s.expected.startsWith("REFUSED")).length;

  async function check() {
    setChecking(true);
    try {
      const data = (await (await fetch("/api/preprod-proof", { cache: "no-store" })).json()) as Proof;
      setProof(data);
      if ("reachable" in data && data.reachable && data.contractFound) {
        toast({ tone: "success", title: "Contract found on Midnight Preprod", body: `Read live from the indexer at block ${data.chainHeight?.toLocaleString()}.` });
      }
    } catch (e) {
      toast({ tone: "error", title: "Could not reach the server", body: (e as Error).message });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div ref={root} className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <span data-reveal className="eyebrow">On-chain evidence</span>
      <h1 data-reveal className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        All nine circuits, <span className="gradient-text">live on Midnight Preprod.</span>
      </h1>
      <p data-reveal className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">
        The Wave 2 contract is deployed on the real Preprod network. The full lifecycle — delegation, pause/resume, attestation, cascade
        revocation and every attack — was run through this app&rsquo;s own API against it, with real zero-knowledge proofs. The table below is
        that run, copied from <code className="mono-chip">docs/DEPLOYMENT-WAVE-2.md</code>.
      </p>

      <section data-reveal className="glass-strong mt-8 grid gap-4 p-5 sm:grid-cols-[1fr,auto] sm:items-center">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">Contract</dt>
          <dd><HexChip value={PREPROD_CONTRACT} label="contract address" /></dd>
          <dt className="text-slate-500">Deploy tx</dt>
          <dd><HexChip value={PREPROD_DEPLOY.txId} label="deploy transaction" /> <span className="ml-2 text-xs text-slate-500">block {PREPROD_DEPLOY.blockHeight.toLocaleString()}</span></dd>
          <dt className="text-slate-500">Result</dt>
          <dd className="font-semibold text-emerald-700">15/15 steps behaved as the protocol promises · {txCount} transactions · {refused} refusals</dd>
        </dl>
        <button type="button" className="btn-accent" onClick={check} disabled={checking}>
          {checking ? "Querying indexer…" : "Verify on-chain now"}
        </button>
      </section>

      {proof && (
        <section data-reveal className="glass mt-4 p-4 text-sm">
          {!proof.configured && (
            <p className="text-slate-700">
              This deployment has no Preprod indexer key configured, so it cannot query the chain live. You can check it yourself with a free
              Blockfrost <em>Midnight Preprod</em> project id:
              <code className="mono-chip mt-2 block overflow-x-auto whitespace-pre p-2">{`curl -s -X POST -H 'content-type: application/json' \\
  -d '{"query":"{ contractAction(address: \\"${PREPROD_CONTRACT.slice(0, 12)}…\\") { __typename } }"}' \\
  "https://midnight-preprod.blockfrost.io/api/v0?project_id=<your id>"`}</code>
            </p>
          )}
          {proof.configured && !proof.reachable && <p className="text-rose-700">The Preprod indexer did not answer{proof.status ? ` (HTTP ${proof.status})` : ""}. Try again in a moment.</p>}
          {proof.configured && proof.reachable && (
            <p className={proof.contractFound ? "text-emerald-800" : "text-rose-700"}>
              {proof.contractFound
                ? `✓ The indexer returns this contract (${proof.actionType}) at chain height ${proof.chainHeight?.toLocaleString()}.`
                : "The indexer does not know this contract address."}
              <span className="ml-2 text-xs text-slate-500">checked {new Date(proof.checkedAt).toLocaleTimeString()}</span>
            </p>
          )}
        </section>
      )}

      <section data-reveal className="glass mt-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-900/[0.07] text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Step</th>
                <th className="px-4 py-3">Outcome</th>
                <th className="px-4 py-3">Transaction</th>
                <th className="px-4 py-3 text-right">Block</th>
              </tr>
            </thead>
            <tbody>
              {PREPROD_STEPS.map((s, i) => {
                const refusal = s.expected.startsWith("REFUSED");
                return (
                  <tr key={s.step} className="border-b border-slate-900/[0.05] last:border-0">
                    <td className="px-4 py-2.5 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{s.step}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${refusal ? "border-rose-500/30 bg-rose-50 text-rose-700" : "border-emerald-500/30 bg-emerald-50 text-emerald-700"}`}>
                        {s.expected}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {s.tx ? <HexChip value={s.tx} label="transaction hash" /> : <span className="text-xs text-slate-400">{refusal ? "none — the proof cannot be built" : "—"}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">{s.block ? s.block.toLocaleString() : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p data-reveal className="mt-4 text-xs leading-relaxed text-slate-500">
        Refused steps produce no transaction on purpose: the circuit assertion fails while the proof is being generated, so nothing is ever
        submitted. This hosted demo runs the same circuits in-process (header: <em>Demo · Simulator</em>) because live mode needs a funded
        wallet and a private proof server; the evidence above is from the live Preprod-backed run.
      </p>
    </div>
  );
}
