"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { animate } from "animejs";
import { EnvironmentBadge } from "@/components/ui/environment-badge";
import { prefersReducedMotion } from "@/lib/motion";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/mandates/new", label: "New mandate" },
  { href: "/lab", label: "Attack Lab" },
  { href: "/verify", label: "Verify" },
  { href: "/deck", label: "Deck" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const blobs = useRef<HTMLDivElement>(null);
  const isDeck = pathname === "/deck";

  // Slow, ambient drift of the glass-backdrop orbs.
  useEffect(() => {
    const root = blobs.current;
    if (!root || prefersReducedMotion()) return;
    const anims = Array.from(root.children).map((el, i) =>
      animate(el, {
        translateX: [0, i % 2 ? -70 : 80, 0],
        translateY: [0, i % 2 ? 60 : -50, 0],
        scale: [1, 1.12, 1],
        duration: 16000 + i * 4500,
        loop: true,
        ease: "inOutSine"
      })
    );
    return () => anims.forEach((a) => a.pause());
  }, []);

  return (
    <div className="relative isolate min-h-screen">
      <div ref={blobs} aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-24 top-10 h-[420px] w-[420px] rounded-full bg-sky-300/35 blur-3xl" />
        <div className="absolute right-[-120px] top-[18%] h-[480px] w-[480px] rounded-full bg-violet-300/30 blur-3xl" />
        <div className="absolute bottom-[-160px] left-[30%] h-[460px] w-[460px] rounded-full bg-cyan-200/40 blur-3xl" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-grid bg-[length:44px_44px] [mask-image:radial-gradient(ellipse_70%_55%_at_50%_0%,black,transparent)]"
      />

      {!isDeck && (
        <header className="sticky top-0 z-40 px-4 pt-4">
          <div className="glass-strong mx-auto flex max-w-6xl items-center justify-between gap-3 !rounded-2xl px-4 py-2.5">
            <Link href="/" className="flex items-center gap-2.5">
              <WardenMark />
              <span className="font-display text-base font-semibold tracking-tight text-slate-900">Warden</span>
              <span className="hidden rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 sm:inline">
                Wave 2
              </span>
            </Link>
            <nav className="hidden items-center gap-0.5 rounded-full border border-slate-900/[0.06] bg-white/60 p-1 md:flex">
              {NAV.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                      active ? "bg-slate-900 text-white shadow" : "text-slate-600 hover:bg-white hover:text-slate-900"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <EnvironmentBadge />
          </div>
          <nav className="mx-auto mt-2 flex max-w-6xl items-center gap-1 overflow-x-auto md:hidden">
            {NAV.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex-none rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-900/10 bg-white/70 text-slate-600"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>
      )}

      <main>{children}</main>

      {!isDeck && (
        <footer className="mx-auto max-w-6xl px-6 py-12 text-xs leading-relaxed text-slate-500">
          Every state shown reflects a real call into the compiled <code className="mono-chip">warden.compact</code> circuits
          via <code className="mono-chip">@warden/sdk</code> — no application-layer shortcut. Built on{" "}
          <a className="font-medium text-sky-700 hover:underline" href="https://docs.midnight.network/" target="_blank" rel="noreferrer">
            Midnight
          </a>
          . Apache-2.0.
        </footer>
      )}
    </div>
  );
}

export function WardenMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 2 L21 6 V12 C21 17 17 20.5 12 22 C7 20.5 3 17 3 12 V6 Z" stroke="url(#warden-mark-gradient)" strokeWidth="1.5" fill="rgba(2,132,199,0.08)" />
      <path d="M8 11.5 L11 14.5 L16 8.5" stroke="#0284c7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="warden-mark-gradient" x1="3" y1="2" x2="21" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0284c7" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
    </svg>
  );
}
