// Warden's web demo always runs `LocalSimulatorNetwork` — the real compiled
// `warden.compact` circuits, executed in-process via
// `@midnight-ntwrk/compact-runtime`, with no proof server or node involved.
// A local devnet (node + indexer + proof server) exists in `infra/devnet/`
// and is exercised separately — see docs/IMPLEMENTATION-NOTES.md for why the
// browser demo doesn't route through it yet. This badge names that honestly
// rather than implying a network connection that isn't there.
const ENVIRONMENT = {
  label: "LOCAL SIMULATOR",
  detail: "Real compiled circuits, run in-process via @midnight-ntwrk/compact-runtime. No proof server, no live network."
} as const;

export function EnvironmentBadge() {
  return (
    <span
      title={ENVIRONMENT.detail}
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400"
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-40" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-400" />
      </span>
      {ENVIRONMENT.label}
    </span>
  );
}
