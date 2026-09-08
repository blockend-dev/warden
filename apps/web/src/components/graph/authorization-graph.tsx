"use client";

// The dashboard's authorization network: one Principal anchor, one Agent
// anchor (this demo runs a single identity pair per browser session — see
// docs/ARCHITECTURE.md §7), and one node per mandate actually created in
// this session, positioned between them. Node color and motion are driven
// entirely by each mandate's real `status`; nothing here is decorative
// state. Hovering a mandate node shows only what's already public: its id
// and status, never policy content.

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";
import type { LocalMandate } from "@/store/session-store";

const STATUS_COLOR: Record<LocalMandate["status"], string> = {
  active: "#34d399",
  revoked: "#fb7185",
  expired: "#fbbf24",
  unknown: "#94a3b8"
};

const PRINCIPAL_POS = new THREE.Vector3(-3.4, 0, 0);
const AGENT_POS = new THREE.Vector3(3.4, 0, 0);

function Anchor({ position, color, label }: { position: THREE.Vector3; color: string; label: string }) {
  return (
    <group position={position}>
      <mesh>
        <icosahedronGeometry args={[0.42, 1]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.35} metalness={0.4} />
      </mesh>
      <Html center distanceFactor={9} position={[0, -0.85, 0]}>
        <div className="pointer-events-none whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {label}
        </div>
      </Html>
    </group>
  );
}

function Pulse({ from, to, active, speed }: { from: THREE.Vector3; to: THREE.Vector3; active: boolean; speed: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const t = useRef(Math.random());
  useFrame((_, delta) => {
    if (!active || !ref.current) return;
    t.current = (t.current + delta * speed) % 1;
    ref.current.position.lerpVectors(from, to, t.current);
  });
  if (!active) return null;
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.055, 12, 12]} />
      <meshBasicMaterial color="#38bdf8" />
    </mesh>
  );
}

function MandateNode({
  mandate,
  position,
  reducedMotion
}: {
  mandate: LocalMandate;
  position: THREE.Vector3;
  reducedMotion: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const meshRef = useRef<THREE.Mesh>(null);
  const color = STATUS_COLOR[mandate.status];
  const active = mandate.status === "active";

  useFrame((state) => {
    if (!meshRef.current) return;
    const base = 0.24;
    if (!reducedMotion && active) {
      meshRef.current.scale.setScalar(base + Math.sin(state.clock.elapsedTime * 2.4 + position.y) * 0.02);
    } else {
      meshRef.current.scale.setScalar(base);
    }
  });

  return (
    <group position={position}>
      <Line points={[PRINCIPAL_POS, position]} color={color} transparent opacity={hovered ? 0.85 : 0.35} lineWidth={1.2} />
      <Line points={[position, AGENT_POS]} color={color} transparent opacity={hovered ? 0.85 : 0.35} lineWidth={1.2} />
      {!reducedMotion && <Pulse from={PRINCIPAL_POS} to={position} active={active} speed={0.35} />}
      {!reducedMotion && <Pulse from={position} to={AGENT_POS} active={active} speed={0.35} />}
      <mesh
        ref={meshRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[0.24, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hovered ? 0.9 : 0.45} roughness={0.4} />
      </mesh>
      {hovered && (
        <Html center distanceFactor={9} position={[0, 0.55, 0]}>
          <div className="pointer-events-none w-max max-w-[220px] rounded-lg border border-white/15 bg-black/85 px-2.5 py-1.5 font-mono text-[10px] text-slate-200 shadow-xl">
            <div className="text-slate-400">{mandate.id.slice(0, 10)}…{mandate.id.slice(-6)}</div>
            <div className="mt-0.5 uppercase tracking-wide" style={{ color }}>
              {mandate.status}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

function Scene({ mandates, reducedMotion }: { mandates: LocalMandate[]; reducedMotion: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const shown = mandates.slice(0, 7);

  const positions = useMemo(() => {
    const n = shown.length;
    return shown.map((_, i) => {
      const y = n <= 1 ? 0 : (i - (n - 1) / 2) * 0.95;
      const z = Math.sin(i * 1.3) * 0.5;
      return new THREE.Vector3(0, y, z);
    });
  }, [shown]);

  useFrame((_, delta) => {
    if (groupRef.current && !reducedMotion) {
      groupRef.current.rotation.y += delta * 0.05;
    }
  });

  return (
    <group ref={groupRef}>
      <ambientLight intensity={0.55} />
      <pointLight position={[4, 4, 6]} intensity={60} color="#38bdf8" />
      <pointLight position={[-4, -3, 4]} intensity={40} color="#c084fc" />
      <Anchor position={PRINCIPAL_POS} color="#c084fc" label="Principal" />
      <Anchor position={AGENT_POS} color="#38bdf8" label="Agent" />
      {shown.map((m, i) => (
        <MandateNode key={m.id} mandate={m} position={positions[i]} reducedMotion={reducedMotion} />
      ))}
    </group>
  );
}

export function AuthorizationGraph({ mandates }: { mandates: LocalMandate[] }) {
  const reducedMotion = Boolean(useReducedMotion());

  return (
    <div className="relative h-[320px] w-full sm:h-[380px]">
      <Canvas camera={{ position: [0, 0.4, 7.2], fov: 42 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }}>
        <Scene mandates={mandates} reducedMotion={reducedMotion} />
      </Canvas>
      {mandates.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="max-w-xs text-center text-sm text-slate-500">No mandates yet — the graph populates as you create them.</p>
        </div>
      )}
    </div>
  );
}
