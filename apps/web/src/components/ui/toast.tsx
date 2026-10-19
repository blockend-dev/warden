"use client";

// Lightweight toast feedback. Every circuit outcome — success or refusal —
// surfaces here as well as inline, so a user never wonders whether a click
// did anything.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { animate } from "animejs";
import { prefersReducedMotion } from "@/lib/motion";

export type ToastTone = "success" | "error" | "info" | "warn";
type Toast = { id: number; tone: ToastTone; title: string; body?: string };

const ToastContext = createContext<{ push: (t: Omit<Toast, "id">) => void } | null>(null);

const TONE: Record<ToastTone, { bar: string; icon: string; iconBg: string }> = {
  success: { bar: "bg-emerald-500", icon: "✓", iconBg: "bg-emerald-100 text-emerald-700" },
  error: { bar: "bg-rose-500", icon: "✕", iconBg: "bg-rose-100 text-rose-700" },
  warn: { bar: "bg-amber-500", icon: "!", iconBg: "bg-amber-100 text-amber-700" },
  info: { bar: "bg-sky-500", icon: "i", iconBg: "bg-sky-100 text-sky-700" }
};

function ToastItem({ toast, onDone }: { toast: Toast; onDone: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const tone = TONE[toast.tone];

  useEffect(() => {
    const el = ref.current;
    if (el && !prefersReducedMotion()) {
      animate(el, { opacity: [0, 1], translateX: [40, 0], scale: [0.96, 1], duration: 520, ease: "outExpo" });
    }
    const t = setTimeout(() => {
      if (el && !prefersReducedMotion()) {
        animate(el, { opacity: 0, translateX: 30, duration: 260, ease: "inQuad", onComplete: () => onDone(toast.id) });
      } else {
        onDone(toast.id);
      }
    }, toast.tone === "error" ? 6500 : 4200);
    return () => clearTimeout(t);
  }, [toast.id, toast.tone, onDone]);

  return (
    <div
      ref={ref}
      role={toast.tone === "error" ? "alert" : "status"}
      className="glass-strong pointer-events-auto relative flex w-80 max-w-[calc(100vw-2rem)] gap-3 overflow-hidden !rounded-2xl p-3.5 pl-4"
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} />
      <span className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-bold ${tone.iconBg}`}>{tone.icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
        {toast.body && <p className="mt-0.5 break-words text-xs leading-relaxed text-slate-600">{toast.body}</p>}
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = useCallback((t: Omit<Toast, "id">) => {
    counter.current += 1;
    const id = counter.current;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
  }, []);
  const remove = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.push;
}
