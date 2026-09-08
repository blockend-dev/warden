"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EnvironmentBadge } from "@/components/ui/environment-badge";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/mandates/new", label: "New mandate" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="relative isolate min-h-screen">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-grid bg-[length:40px_40px] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_-10%,black,transparent)]"
      />
      <header className="border-b border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <WardenMark />
            <span className="font-display text-base font-semibold tracking-tight text-white">Warden</span>
          </Link>
          <nav className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.02] p-1">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                    active ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <EnvironmentBadge />
        </div>
      </header>
      <main>{children}</main>
      <footer className="mx-auto max-w-6xl px-6 py-10 text-xs text-slate-600">
        Every state shown reflects a real call into the compiled <code className="mono-chip">warden.compact</code> circuit
        via <code className="mono-chip">@warden/sdk</code>. See{" "}
        <code className="mono-chip">docs/DEMO.md</code> and <code className="mono-chip">docs/PRIVACY.md</code>.
      </footer>
    </div>
  );
}

function WardenMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2 L21 6 V12 C21 17 17 20.5 12 22 C7 20.5 3 17 3 12 V6 Z"
        stroke="url(#warden-mark-gradient)"
        strokeWidth="1.4"
        fill="rgba(56,189,248,0.06)"
      />
      <path d="M8 11.5 L11 14.5 L16 8.5" stroke="#38bdf8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="warden-mark-gradient" x1="3" y1="2" x2="21" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#38bdf8" />
          <stop offset="1" stopColor="#c084fc" />
        </linearGradient>
      </defs>
    </svg>
  );
}
