"use client";

// The authorization network: one Principal anchor, one node per root mandate,
// and each root's delegated sub-agents hanging off it. Node color is the
// mandate's *effective* status — a child whose parent is revoked turns red
// even though its own ledger flag is untouched, because that is exactly what
// the circuit enforces. Hovering a node shows only what is already public.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { animate, stagger } from "animejs";
import { prefersReducedMotion } from "@/lib/motion";
import type { LocalMandate } from "@/store/session-store";

const COLOR: Record<LocalMandate["status"], { stroke: string; fill: string; text: string }> = {
  active: { stroke: "#10b981", fill: "#ecfdf5", text: "#047857" },
  paused: { stroke: "#f59e0b", fill: "#fffbeb", text: "#b45309" },
  revoked: { stroke: "#f43f5e", fill: "#fff1f2", text: "#be123c" },
  expired: { stroke: "#94a3b8", fill: "#f1f5f9", text: "#475569" },
  unknown: { stroke: "#94a3b8", fill: "#f1f5f9", text: "#475569" }
};

const W = 780;
const ROW = 74;
const PRINCIPAL_X = 62;
const ROOT_X = 300;
const CHILD_X = 560;
const NODE_W = 150;
const NODE_H = 46;

type Placed = { m: LocalMandate; x: number; y: number };

function layout(mandates: LocalMandate[]): { roots: Placed[]; children: Placed[]; height: number } {
  const roots = mandates.filter((m) => m.kind === "root").sort((a, b) => a.createdAt - b.createdAt).slice(-5);
  const rootIds = new Set(roots.map((r) => r.id));
  const kids = mandates.filter((m) => m.kind === "delegated" && m.parentId && rootIds.has(m.parentId)).sort((a, b) => a.createdAt - b.createdAt);

  const placedRoots: Placed[] = [];
  const placedKids: Placed[] = [];
  let cursor = 0;
  for (const root of roots) {
    const mine = kids.filter((k) => k.parentId === root.id).slice(0, 6);
    const rows = Math.max(1, mine.length);
    const top = cursor;
    const groupH = rows * ROW;
    placedRoots.push({ m: root, x: ROOT_X, y: top + groupH / 2 });
    mine.forEach((k, i) => placedKids.push({ m: k, x: CHILD_X, y: top + i * ROW + ROW / 2 }));
    cursor += groupH + 14;
  }
  return { roots: placedRoots, children: placedKids, height: Math.max(220, cursor + 10) };
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

export function DelegationGraph({ mandates, highlightId }: { mandates: LocalMandate[]; highlightId?: string }) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const { roots, children, height } = useMemo(() => layout(mandates), [mandates]);
  const principalY = height / 2;
  const signature = [...roots, ...children].map((p) => p.m.id).join(",");
  const statusSignature = [...roots, ...children].map((p) => p.m.id + p.m.status).join(",");

  // Entrance: edges draw in, nodes pop in on a stagger.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || prefersReducedMotion()) return;
    const nodes = svg.querySelectorAll("[data-node]");
    const edges = svg.querySelectorAll("[data-edge]");
    const a1 = animate(edges, { opacity: [0, 1], duration: 700, delay: stagger(60), ease: "outQuad" });
    const a2 = animate(nodes, { opacity: [0, 1], scale: [0.7, 1], duration: 650, delay: stagger(70, { start: 120 }), ease: "outBack" });
    return () => {
      a1.pause();
      a2.pause();
    };
  }, [signature]);

  // Ambient halo on live nodes; a one-shot shake when something turns red.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || prefersReducedMotion()) return;
    const halos = svg.querySelectorAll("[data-halo='active']");
    if (halos.length === 0) return;
    const a = animate(halos, { r: [0, 5], opacity: [0.5, 0], duration: 1700, loop: true, delay: stagger(220), ease: "outQuad" });
    return () => {
      a.pause();
    };
  }, [statusSignature]);

  const prevStatus = useRef<Record<string, string>>({});
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    for (const p of [...roots, ...children]) {
      const before = prevStatus.current[p.m.id];
      if (before && before !== p.m.status && (p.m.status === "revoked" || p.m.status === "paused") && !prefersReducedMotion()) {
        const el = svg.querySelector(`[data-node-id="${p.m.id}"]`);
        if (el) animate(el, { translateX: [0, -7, 7, -4, 4, 0], duration: 520, ease: "outQuad" });
      }
      prevStatus.current[p.m.id] = p.m.status;
    }
  }, [statusSignature, roots, children]);

  const empty = roots.length === 0;
  const hovered = [...roots, ...children].find((p) => p.m.id === hover);

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label="Delegation graph: principal, root mandates, and delegated sub-agents"
        className="h-auto w-full"
        style={{ minHeight: 220 }}
      >
        <defs>
          <linearGradient id="dg-anchor" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7c3aed" />
            <stop offset="1" stopColor="#0284c7" />
          </linearGradient>
          <filter id="dg-shadow" x="-30%" y="-30%" width="160%" height="170%">
            <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#1e295a" floodOpacity="0.14" />
          </filter>
        </defs>

        {/* principal anchor */}
        <g transform={`translate(${PRINCIPAL_X}, ${principalY})`}>
          <circle r="30" fill="url(#dg-anchor)" opacity="0.14" />
          <circle r="22" fill="#fff" stroke="url(#dg-anchor)" strokeWidth="2" filter="url(#dg-shadow)" />
          <path d="M0 -10 L9 -6 V1 C9 7 5 10.5 0 12 C-5 10.5 -9 7 -9 1 V-6 Z" fill="none" stroke="#7c3aed" strokeWidth="1.7" />
          <text y="46" textAnchor="middle" fontSize="11" fontWeight="600" fill="#475569" letterSpacing="0.08em">
            PRINCIPAL
          </text>
        </g>

        {/* edges */}
        {roots.map((r) => {
          const c = COLOR[r.m.status];
          return (
            <path
              key={`pe-${r.m.id}`}
              data-edge
              d={curve(PRINCIPAL_X + 24, principalY, r.x - NODE_W / 2, r.y)}
              fill="none"
              stroke={c.stroke}
              strokeWidth="1.6"
              strokeOpacity={r.m.status === "active" ? 0.75 : 0.35}
              className={r.m.status === "active" ? "flow-line" : undefined}
            />
          );
        })}
        {children.map((k) => {
          const parent = roots.find((r) => r.m.id === k.m.parentId);
          if (!parent) return null;
          const c = COLOR[k.m.status];
          return (
            <path
              key={`ce-${k.m.id}`}
              data-edge
              d={curve(parent.x + NODE_W / 2, parent.y, k.x - NODE_W / 2, k.y)}
              fill="none"
              stroke={c.stroke}
              strokeWidth="1.6"
              strokeOpacity={k.m.status === "active" ? 0.75 : 0.35}
              className={k.m.status === "active" ? "flow-line" : undefined}
            />
          );
        })}

        {/* nodes */}
        {[...roots, ...children].map((p) => {
          const c = COLOR[p.m.status];
          const selected = highlightId === p.m.id;
          return (
            <g key={p.m.id} transform={`translate(${p.x - NODE_W / 2}, ${p.y - NODE_H / 2})`}>
            <g
              data-node
              data-node-id={p.m.id}
              style={{ cursor: "pointer", transformBox: "fill-box", transformOrigin: "center" }}
              onClick={() => router.push(`/mandates/${p.m.id}`)}
              onMouseEnter={() => setHover(p.m.id)}
              onMouseLeave={() => setHover(null)}
              tabIndex={0}
              role="link"
              aria-label={`${p.m.label}, ${p.m.status}`}
              onKeyDown={(e) => e.key === "Enter" && router.push(`/mandates/${p.m.id}`)}
            >
              <rect width={NODE_W} height={NODE_H} rx="14" fill={c.fill} stroke={c.stroke} strokeWidth={selected ? 2.6 : 1.5} filter="url(#dg-shadow)" />
              <circle data-halo={p.m.status === "active" ? "active" : "off"} cx="16" cy={NODE_H / 2} r="0" fill={c.stroke} opacity="0.4" />
              <circle cx="16" cy={NODE_H / 2} r="5" fill={c.stroke} />
              <text x="30" y="19" fontSize="12.5" fontWeight="700" fill="#0f172a">
                {p.m.label}
              </text>
              <text x="30" y="35" fontSize="10.5" fill={c.text} fontWeight="600">
                {p.m.blockedByParent ? `cut by parent (${p.m.blockedByParent})` : `${p.m.status} · ${p.m.actionsAuthorized} act`}
              </text>
            </g>
            </g>
          );
        })}
      </svg>

      {hovered && (
        <div className="glass-strong pointer-events-none absolute right-3 top-3 w-56 !rounded-xl p-3 text-[11px]">
          <div className="font-mono text-slate-500">
            {hovered.m.id.slice(0, 10)}…{hovered.m.id.slice(-6)}
          </div>
          <div className="mt-1 font-semibold uppercase tracking-wide" style={{ color: COLOR[hovered.m.status].text }}>
            {hovered.m.status}
          </div>
          <div className="mt-1 text-slate-500">Public only: id, state, action count, commitment. Policy stays private.</div>
        </div>
      )}

      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="max-w-xs text-center text-sm text-slate-500">No mandates yet — the delegation graph grows as you create and delegate them.</p>
        </div>
      )}
    </div>
  );
}
