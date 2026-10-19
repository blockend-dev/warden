#!/usr/bin/env node
// Drives the Wave 2 lifecycle through a running apps/web instance and prints
// the evidence as markdown. Works against either backend:
//   BASE=http://localhost:3100 node scripts/verify-live.mjs [--write docs/DEPLOYMENT-WAVE-2.md]
// On a Preprod-backed instance every successful step carries a real txId and
// block height; on the simulator the same assertions run without them.

import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3100";
let cookie = "";

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return res.json();
}

const rows = [];
let failed = 0;
function record(step, ok, expected, evidence, note = "") {
  if (!ok) failed++;
  rows.push({ step, ok, expected, tx: evidence?.txId, block: evidence?.blockHeight, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${evidence ? `  tx ${evidence.txId.slice(0, 16)}… block ${evidence.blockHeight}` : ""}${note ? `  (${note})` : ""}`);
}

const status = await call("GET", "/api/network-status");
console.log("backend:", JSON.stringify(status), "\n");
const policy = { maxAmount: 1000, asset: "DEMO", actionType: "payment", destinationCategory: "vendor:approved", expiresInSeconds: 3600, actionCountLimit: 10 };
const act = (id, amount, destinationCategory = policy.destinationCategory) => ({ id, amount, asset: "DEMO", actionType: "payment", destinationCategory });

const root = await call("POST", "/api/mandate", policy);
record("createMandate (root)", Boolean(root.id), "registered", root.evidence);

const child = await call("POST", "/api/delegate", { parentId: root.id, maxAmount: 400, actionCountLimit: 4 });
record("delegate 400 of 1000 to a sub-agent", Boolean(child.id) && child.status?.parentId === root.id, "registered, parent recorded", child.evidence);

const over = await call("POST", "/api/delegate", { parentId: root.id, maxAmount: 700, actionCountLimit: 2 });
record("over-delegate 700 (only 600 left)", !over.id && /remaining budget/.test(over.error?.message ?? ""), "REFUSED", undefined, over.error?.kind);

const pay = await call("POST", "/api/authorize", act(child.id, 120));
record("sub-agent authorizes 120", pay.authorized === true, "AUTHORIZED", pay.evidence);

const cap = await call("POST", "/api/authorize", act(child.id, 999));
record("sub-agent over its 400 cap", cap.authorized === false && /exceeds mandate cap/.test(cap.error?.message ?? ""), "REFUSED", undefined, cap.error?.kind);

const dest = await call("POST", "/api/authorize", act(child.id, 1, "vendor:unknown"));
record("sub-agent pays an unapproved destination", dest.authorized === false && /not permitted/.test(dest.error?.message ?? ""), "REFUSED", undefined, dest.error?.kind);

const pause = await call("POST", "/api/pause", { id: root.id, paused: true });
record("pause root", pause.ok === true && pause.status?.status === "paused", "paused", pause.evidence);

const blocked = await call("POST", "/api/authorize", act(child.id, 10));
record("sub-agent acts while root paused", blocked.authorized === false && /paused/.test(blocked.error?.message ?? ""), "REFUSED", undefined, blocked.error?.kind);

const resume = await call("POST", "/api/pause", { id: root.id, paused: false });
record("resume root", resume.ok === true && resume.status?.status === "active", "active", resume.evidence);

const again = await call("POST", "/api/authorize", act(child.id, 10));
record("sub-agent acts after resume", again.authorized === true, "AUTHORIZED", again.evidence);

const att = await call("POST", "/api/attest", { id: root.id, ceiling: 900 });
record("attestSpend: spent <= 900 (committed 400)", att.ok === true && att.status?.attestation?.ceiling === "900", "attested", att.evidence);

const lie = await call("POST", "/api/attest", { id: root.id, ceiling: 100 });
record("attestSpend: false ceiling 100", lie.ok === false && /attestation false/.test(lie.error?.message ?? ""), "REFUSED", undefined, lie.error?.kind);

const rev = await call("POST", "/api/revoke", { id: root.id });
record("revoke root", rev.revoked === true, "revoked", rev.evidence);

const cut = await call("POST", "/api/authorize", act(child.id, 10));
record("sub-agent acts after root revoked", cut.authorized === false && /parent mandate revoked/.test(cut.error?.message ?? ""), "REFUSED (cascade)", undefined, cut.error?.kind);

const verify = await call("GET", `/api/verify/${child.id}`);
record("public verifier: child shows cut off by parent", verify.status?.status === "revoked" && verify.status?.blockedByParent === "revoked", "revoked via parent");

// ---- evidence ------------------------------------------------------------
const live = status.mode === "preprod" && status.phase === "ready";
const md = [
  `# Wave 2 verification — ${live ? "Midnight Preprod (live)" : "simulator"}`,
  "",
  `Generated ${new Date().toISOString()} by \`scripts/verify-live.mjs\` against \`${BASE}\`.`,
  live ? `\nContract: \`${status.contractAddress}\`` : "",
  live && status.deployment ? `\nDeploy transaction: \`${status.deployment.txId}\` (block ${status.deployment.blockHeight.toLocaleString()})` : "",
  "",
  "| # | Step | Expected | Result | Transaction | Block |",
  "|---|---|---|---|---|---|",
  ...rows.map((r, i) => `| ${i + 1} | ${r.step} | ${r.expected} | ${r.ok ? "✅" : "❌"} | ${r.tx ? `\`${r.tx}\`` : r.expected.startsWith("REFUSED") ? "none (no tx: the proof cannot be built)" : "—"} | ${r.block ? r.block.toLocaleString() : "—"} |`),
  "",
  `${rows.length - failed}/${rows.length} steps behaved as the protocol promises.`
].join("\n");

const i = process.argv.indexOf("--write");
if (i > -1) fs.writeFileSync(process.argv[i + 1], md + "\n");
console.log(`\n${rows.length - failed}/${rows.length} passed`);
process.exit(failed ? 1 : 0);
