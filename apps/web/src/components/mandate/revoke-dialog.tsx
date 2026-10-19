"use client";

import { useEffect, useRef, useState } from "react";
import { animate } from "animejs";
import { HexChip } from "@/components/ui/hex-chip";
import { prefersReducedMotion } from "@/lib/motion";

export function RevokeDialog({
  open,
  mandateId,
  childCount,
  delegated,
  onCancel,
  onConfirm
}: {
  open: boolean;
  mandateId: string;
  childCount: number;
  delegated: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    if (!prefersReducedMotion()) {
      if (backdrop.current) animate(backdrop.current, { opacity: [0, 1], duration: 240, ease: "outQuad" });
      if (card.current) animate(card.current, { opacity: [0, 1], translateY: [18, 0], scale: [0.95, 1], duration: 420, ease: "outBack" });
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="revoke-dialog-title" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div ref={backdrop} aria-hidden className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onCancel} />
      <div ref={card} className="glass-strong relative w-full max-w-sm border-rose-500/20 p-6">
        <h2 id="revoke-dialog-title" className="font-display text-lg font-semibold text-slate-900">
          Revoke this mandate?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          This is a security operation, not an edit. Once <HexChip value={mandateId} label="mandate id" /> is revoked, the circuit itself
          rejects every future action against it — permanently. There is no un-revoke.
          {!delegated && childCount > 0 && (
            <>
              {" "}
              <strong className="text-rose-700">
                Its {childCount} sub-agent{childCount === 1 ? "" : "s"} will stop working instantly
              </strong>{" "}
              — their own flags stay untouched; the circuit checks this parent live.
            </>
          )}
        </p>
        <p className="mt-3 text-xs text-slate-500">If you only need a temporary freeze, use Pause instead.</p>
        <div className="mt-6 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className="btn-ghost" disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Revoking…" : "Revoke permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
