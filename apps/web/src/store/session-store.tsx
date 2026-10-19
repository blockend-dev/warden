"use client";

// Client-side record of what THIS browser session has done. Everything here
// is either (a) something the browser itself typed in as principal — its own
// private policy, never sent back by the server — or (b) a verbatim copy of
// a real API response. Nothing in this store is invented; it exists so the
// dashboard has something to render between page loads without re-deriving
// it from a server that intentionally never stores plaintext policy.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { MandateStatus, MandateSummary, SpendAttestation } from "@warden/shared";

export type ActivityKind = "created" | "delegated" | "authorized" | "blocked" | "revoked" | "paused" | "resumed" | "attested" | "error";

export type ActivityEntry = {
  seq: number;
  ts: number;
  kind: ActivityKind;
  text: string;
  detail?: string;
  spentCommitment?: string;
  actionsAuthorized?: number;
  /** Present only when a live network backend returned a real transaction. */
  txId?: string;
  blockHeight?: number;
};

export type PolicySnapshot = {
  maxAmount: number;
  asset: string;
  actionType: string;
  destinationCategory: string;
  actionCountLimit: number;
  expiresInSeconds: number;
  expiryUnix: number;
};

export type LocalMandate = {
  id: string;
  label: string;
  policy: PolicySnapshot;
  createdAt: number;
  status: MandateStatus;
  actionsAuthorized: number;
  spentCommitment?: string;
  activity: ActivityEntry[];
  kind: "root" | "delegated";
  parentId?: string;
  paused?: boolean;
  blockedByParent?: "revoked" | "paused";
  attestation?: SpendAttestation;
  /** Budget this session knows it has spent (client-side tally of its own
   * accepted actions — the chain only ever shows the opaque commitment). */
  spentKnown: number;
};

type SessionState = { mandates: LocalMandate[]; rootCounter: number; subCounter: number };

const STORAGE_KEY = "warden.demo-session.v2";
const EMPTY: SessionState = { mandates: [], rootCounter: 1, subCounter: 1 };

type StatusPatch = Pick<MandateSummary, "status" | "actionsAuthorized"> &
  Partial<Pick<MandateSummary, "spentCommitment" | "paused" | "blockedByParent" | "attestation" | "parentId" | "kind">>;

type SessionApi = {
  mandates: LocalMandate[];
  hydrated: boolean;
  /** True when the server no longer knows this browser's mandates (it restarted). */
  serverLost: boolean;
  addMandate: (input: {
    id: string;
    policy: PolicySnapshot;
    status: MandateStatus;
    spentCommitment?: string;
    parentId?: string;
  }) => LocalMandate;
  updateStatus: (id: string, patch: StatusPatch) => void;
  addSpent: (id: string, amount: number) => void;
  appendActivity: (id: string, entry: Omit<ActivityEntry, "seq" | "ts">) => void;
  refresh: () => Promise<void>;
  resetAll: () => void;
};

const SessionContext = createContext<SessionApi | null>(null);

function load(): SessionState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as SessionState;
    return Array.isArray(parsed.mandates) ? { ...EMPTY, ...parsed } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [serverLost, setServerLost] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    setState(load());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private-browsing / storage-disabled: the session still works in-memory.
    }
  }, [state, hydrated]);

  // Mirror of state for synchronous reads (labels/counters) inside callbacks.
  const stateRef = useRef<SessionState>(EMPTY);
  stateRef.current = state;

  const addMandate = useCallback<SessionApi["addMandate"]>((input) => {
    const s = stateRef.current;
    const delegated = Boolean(input.parentId);
    const n = delegated ? s.subCounter : s.rootCounter;
    const created: LocalMandate = {
      id: input.id,
      label: delegated ? "Sub-agent #" + String(n).padStart(2, "0") : "Agent #" + String(n).padStart(2, "0"),
      policy: input.policy,
      createdAt: Date.now(),
      status: input.status,
      actionsAuthorized: 0,
      spentCommitment: input.spentCommitment,
      activity: [],
      kind: delegated ? "delegated" : "root",
      parentId: input.parentId,
      spentKnown: 0
    };
    setState((prev) => ({
      mandates: [created, ...prev.mandates],
      rootCounter: delegated ? prev.rootCounter : prev.rootCounter + 1,
      subCounter: delegated ? prev.subCounter + 1 : prev.subCounter
    }));
    return created;
  }, []);

  const updateStatus = useCallback<SessionApi["updateStatus"]>((id, patch) => {
    setState((s) => ({
      ...s,
      mandates: s.mandates.map((m) =>
        m.id === id
          ? {
              ...m,
              status: patch.status,
              actionsAuthorized: patch.actionsAuthorized,
              spentCommitment: patch.spentCommitment ?? m.spentCommitment,
              paused: patch.paused,
              blockedByParent: patch.blockedByParent,
              attestation: patch.attestation
            }
          : m
      )
    }));
  }, []);

  const addSpent = useCallback<SessionApi["addSpent"]>((id, amount) => {
    setState((s) => ({ ...s, mandates: s.mandates.map((m) => (m.id === id ? { ...m, spentKnown: m.spentKnown + amount } : m)) }));
  }, []);

  const appendActivity = useCallback<SessionApi["appendActivity"]>((id, entry) => {
    seqRef.current += 1;
    const full: ActivityEntry = { seq: Date.now() * 1000 + (seqRef.current % 1000), ts: Date.now(), ...entry };
    setState((s) => ({
      ...s,
      mandates: s.mandates.map((m) => (m.id === id ? { ...m, activity: [full, ...m.activity].slice(0, 40) } : m))
    }));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/mandate", { cache: "no-store" });
      const data = (await res.json()) as { mandates: MandateSummary[] };
      const known = new Map(data.mandates.map((m) => [m.id, m]));
      setState((s) => {
        setServerLost(s.mandates.length > 0 && s.mandates.every((m) => !known.has(m.id)));
        return {
          ...s,
          mandates: s.mandates.map((m) => {
            const fresh = known.get(m.id);
            return fresh
              ? {
                  ...m,
                  status: fresh.status,
                  actionsAuthorized: fresh.actionsAuthorized,
                  spentCommitment: fresh.spentCommitment ?? m.spentCommitment,
                  paused: fresh.paused,
                  blockedByParent: fresh.blockedByParent,
                  attestation: fresh.attestation
                }
              : m;
          })
        };
      });
    } catch {
      // Offline or server restarting: keep the last known state.
    }
  }, []);

  const resetAll = useCallback(() => {
    setState(EMPTY);
    setServerLost(false);
  }, []);

  const value = useMemo<SessionApi>(
    () => ({
      mandates: state.mandates,
      hydrated,
      serverLost,
      addMandate,
      updateStatus,
      addSpent,
      appendActivity,
      refresh,
      resetAll
    }),
    [state.mandates, hydrated, serverLost, addMandate, updateStatus, addSpent, appendActivity, refresh, resetAll]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

export function useMandate(id: string | undefined): LocalMandate | undefined {
  const { mandates } = useSession();
  return useMemo(() => mandates.find((m) => m.id === id), [mandates, id]);
}
