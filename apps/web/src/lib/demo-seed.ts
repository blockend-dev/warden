"use client";

// One-click demo: a root mandate, two delegated sub-agents and a little
// activity — every step a real API call into the real circuits. Lets a judge
// land on a populated app, then break things.

import { api, DEFAULT_POLICY } from "@/lib/api-client";
import type { PolicySnapshot, useSession } from "@/store/session-store";

type Store = ReturnType<typeof useSession>;

function snapshot(policy: { maxAmount: number; asset: string; actionType: string; destinationCategory: string; actionCountLimit: number }, expiryUnix: number): PolicySnapshot {
  return {
    maxAmount: policy.maxAmount,
    asset: policy.asset,
    actionType: policy.actionType,
    destinationCategory: policy.destinationCategory,
    actionCountLimit: policy.actionCountLimit,
    expiresInSeconds: Math.max(0, expiryUnix - Math.floor(Date.now() / 1000)),
    expiryUnix
  };
}

export async function seedDemo(store: Store, onStep?: (label: string) => void): Promise<string> {
  onStep?.("Creating root mandate");
  const policy = { ...DEFAULT_POLICY };
  const root = await api.createMandate(policy);
  if (!root.id || !root.status) throw new Error(root.error?.message ?? "Could not create the root mandate.");
  const expiryUnix = Math.floor(Date.now() / 1000) + policy.expiresInSeconds;
  store.addMandate({ id: root.id, status: root.status.status, spentCommitment: root.status.spentCommitment, policy: snapshot(policy, expiryUnix) });
  store.appendActivity(root.id, { kind: "created", text: "CREATED", detail: "genesis spend commitment written", spentCommitment: root.status.spentCommitment, txId: root.evidence?.txId, blockHeight: root.evidence?.blockHeight });

  const carve = [
    { maxAmount: 400, actionCountLimit: 5 },
    { maxAmount: 300, actionCountLimit: 4 }
  ];
  const kids: string[] = [];
  for (const [i, c] of carve.entries()) {
    onStep?.(`Delegating to sub-agent ${i + 1}`);
    const child = await api.delegate({ parentId: root.id, ...c });
    if (!child.id || !child.status) throw new Error(child.error?.message ?? "Delegation failed.");
    kids.push(child.id);
    store.addMandate({
      id: child.id,
      parentId: root.id,
      status: child.status.status,
      spentCommitment: child.status.spentCommitment,
      policy: snapshot({ ...policy, ...c }, expiryUnix)
    });
    store.appendActivity(child.id, { kind: "delegated", text: "DELEGATED", detail: `carved ${c.maxAmount} ${policy.asset} out of the root mandate`, spentCommitment: child.status.spentCommitment, txId: child.evidence?.txId, blockHeight: child.evidence?.blockHeight });
    if (child.parentStatus) store.updateStatus(root.id, child.parentStatus);
  }

  onStep?.("Sub-agent 1 makes a payment");
  const pay = await api.authorize({ id: kids[0], amount: 120, asset: policy.asset, actionType: policy.actionType, destinationCategory: policy.destinationCategory });
  if (pay.authorized && pay.status) {
    store.updateStatus(kids[0], pay.status);
    store.addSpent(kids[0], 120);
    store.appendActivity(kids[0], { kind: "authorized", text: "AUTHORIZED", detail: `requested 120 ${policy.asset}`, spentCommitment: pay.status.spentCommitment, actionsAuthorized: pay.status.actionsAuthorized, txId: pay.evidence?.txId, blockHeight: pay.evidence?.blockHeight });
  }
  await store.refresh();
  return root.id;
}
