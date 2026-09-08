"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HexChip } from "@/components/ui/hex-chip";

export function RevokeDialog({
  open,
  mandateId,
  onCancel,
  onConfirm
}: {
  open: boolean;
  mandateId: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="revoke-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="relative w-full max-w-sm rounded-2xl border border-rose-500/25 bg-[#12131a] p-6 shadow-2xl"
          >
            <h2 id="revoke-dialog-title" className="font-display text-lg font-semibold text-white">
              Revoke this mandate?
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              This is a security operation, not an edit. Once <HexChip value={mandateId} label="mandate id" /> is revoked,
              the circuit itself rejects every future <code className="mono-chip">authorize</code> call against it —
              permanently. There is no un-revoke.
            </p>
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
