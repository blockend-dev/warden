import type { MandateStatus } from "@warden/shared";

const STYLES: Record<MandateStatus, string> = {
  active: "border-emerald-500/30 bg-emerald-50 text-emerald-700",
  paused: "border-amber-500/35 bg-amber-50 text-amber-700",
  revoked: "border-rose-500/30 bg-rose-50 text-rose-700",
  expired: "border-slate-400/40 bg-slate-100 text-slate-600",
  unknown: "border-slate-300 bg-slate-100 text-slate-500"
};

const DOT: Record<MandateStatus, string> = {
  active: "bg-emerald-500",
  paused: "bg-amber-500",
  revoked: "bg-rose-500",
  expired: "bg-slate-400",
  unknown: "bg-slate-400"
};

export function StatusBadge({ status, className = "" }: { status: MandateStatus; className?: string }) {
  return (
    <span
      data-status={status}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STYLES[status]} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]} ${status === "active" ? "proof-pulse" : ""}`} />
      {status}
    </span>
  );
}
