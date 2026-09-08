import type { MandateStatus } from "@warden/shared";

const STYLES: Record<MandateStatus, string> = {
  active: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  revoked: "border-rose-500/30 bg-rose-500/15 text-rose-300",
  expired: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  unknown: "border-white/20 bg-white/10 text-slate-300"
};

const DOT: Record<MandateStatus, string> = {
  active: "bg-emerald-400",
  revoked: "bg-rose-400",
  expired: "bg-amber-400",
  unknown: "bg-slate-400"
};

export function StatusBadge({ status, className = "" }: { status: MandateStatus; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${STYLES[status]} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]} ${status === "active" ? "proof-pulse" : ""}`} />
      {status}
    </span>
  );
}
