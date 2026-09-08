"use client";

// Client-side record of what THIS browser session has done. Everything here
// is either (a) something the browser itself typed in as principal — its own
// private policy, never sent back by the server — or (b) a verbatim copy of
// a real API response. Nothing in this store is invented; it exists so the
// dashboard has something to render between page loads without re-deriving
// it from a server that intentionally never stores plaintext policy.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { MandateStatus } from "@warden/shared";

export type ActivityKind = "created" | "authorized" | "blocked" | "revoked" | "error";

export type ActivityEntry = {
  seq: number;
  ts: number;
  kind: ActivityKind;
  text: string;
  detail?: string;
  spentCommitment?: string;
  actionsAuthorized?: number;
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
};

type SessionState = { mandates: LocalMandate[] };

const STORAGE_KEY = "warden.demo-session.v1";

type SessionApi = {
  mandates: LocalMandate[];
  hydrated: boolean;
  addMandate: (input: { id: string; policy: PolicySnapshot; status: MandateStatus; spentCommitment?: string }) => LocalMandate;
  updateStatus: (id: string, patch: { status: MandateStatus; actionsAuthorized: number; spentCommitment?: string }) => void;
  appendActivity: (id: string, entry: Omit<ActivityEntry, "seq" | "ts">) => void;
  resetAll: () => void;
};

const SessionContext = createContext<SessionApi | null>(null);

function load(): SessionState {
  if (typeof window === "undefined") return { mandates: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { mandates: [] };
    const parsed = JSON.parse(raw) as SessionState;
    return Array.isArray(parsed.mandates) ? parsed : { mandates: [] };
  } catch {
    return { mandates: [] };
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ mandates: [] });
  const [hydrated, setHydrated] = useState(false);
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

  const addMandate = useCallback<SessionApi["addMandate"]>((input) => {
    const mandate: LocalMandate = {
      id: input.id,
      label: `Agent #${String(labelCounter++).padStart(2, "0")}`,
      policy: input.policy,
      createdAt: Date.now(),
      status: input.status,
      actionsAuthorized: 0,
      spentCommitment: input.spentCommitment,
      activity: []
    };
    setState((s) => ({ mandates: [mandate, ...s.mandates] }));
    return mandate;
  }, []);

  const updateStatus = useCallback<SessionApi["updateStatus"]>((id, patch) => {
    setState((s) => ({
      mandates: s.mandates.map((m) => (m.id === id ? { ...m, ...patch } : m))
    }));
  }, []);

  const appendActivity = useCallback<SessionApi["appendActivity"]>((id, entry) => {
    seqRef.current += 1;
    const full: ActivityEntry = { seq: seqRef.current, ts: Date.now(), ...entry };
    setState((s) => ({
      mandates: s.mandates.map((m) => (m.id === id ? { ...m, activity: [full, ...m.activity].slice(0, 30) } : m))
    }));
  }, []);

  const resetAll = useCallback(() => {
    setState({ mandates: [] });
  }, []);

  const value = useMemo<SessionApi>(
    () => ({ mandates: state.mandates, hydrated, addMandate, updateStatus, appendActivity, resetAll }),
    [state.mandates, hydrated, addMandate, updateStatus, appendActivity, resetAll]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

let labelCounter = 1;

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

export function useMandate(id: string | undefined): LocalMandate | undefined {
  const { mandates } = useSession();
  return useMemo(() => mandates.find((m) => m.id === id), [mandates, id]);
}
