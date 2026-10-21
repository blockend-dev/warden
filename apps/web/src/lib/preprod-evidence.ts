// The recorded result of running the Wave 2 lifecycle against the deployed
// contract on Midnight Preprod. Mirrors docs/DEPLOYMENT-WAVE-2.md, which
// scripts/verify-live.mjs generated from real API calls — transaction hashes
// and block numbers are copied verbatim, never invented. Refused steps have no
// transaction by design: the circuit assertion fails while the proof is built.

export const PREPROD_CONTRACT = "4c09848830b6630e045c29433dae38f06b7d03ce55a3aa8953fd9639dffdb15f";

export const PREPROD_DEPLOY = {
  txId: "0072e052ec03fe1dba01220c328346c4707bc588bb56c3b15bf8ba2bc282750a25",
  blockHeight: 3_064_612
};

export type EvidenceStep = {
  step: string;
  expected: string;
  tx?: string;
  block?: number;
};

export const PREPROD_STEPS: EvidenceStep[] = [
  { step: "createMandate (root)", expected: "registered", tx: "00e7adf0facc8b26628f56e6cdcb95d663cc206abe483760dbca56bc76ee6cd625", block: 3_064_626 },
  { step: "delegate 400 of 1000 to a sub-agent", expected: "registered, parent recorded", tx: "003cea96c8fa1fa73f0474193314f6c345b6a45fc97e3a461d554740adbd223193", block: 3_064_637 },
  { step: "over-delegate 700 (only 600 left)", expected: "REFUSED" },
  { step: "sub-agent authorizes 120", expected: "AUTHORIZED", tx: "00c48eb08fb1d14946f813b2a08ac1bf3386e7d6bf71af0a5f62e72e63d3d46359", block: 3_064_647 },
  { step: "sub-agent over its 400 cap", expected: "REFUSED" },
  { step: "sub-agent pays an unapproved destination", expected: "REFUSED" },
  { step: "pause root", expected: "paused", tx: "007420c9d9ddb8b75304c7b9f854ea30dd29d5c1357af045a9e5e316eeb9096ac8", block: 3_064_655 },
  { step: "sub-agent acts while root paused", expected: "REFUSED" },
  { step: "resume root", expected: "active", tx: "0016f7881541cb3fbb4dcf5e68f4cc3837d9337351a92ec35ff9cec59074d7a86f", block: 3_064_663 },
  { step: "sub-agent acts after resume", expected: "AUTHORIZED", tx: "0011bd68df381f596a6dc2af43004a6d6105c7e889f20fce22dfb37e70c645ade0", block: 3_064_671 },
  { step: "attestSpend: spent ≤ 900 (committed 400)", expected: "attested", tx: "00ee4f38432cce2b955d8142211228864a851249c6f003030a12fbc38c5ee802e3", block: 3_064_679 },
  { step: "attestSpend: false ceiling 100", expected: "REFUSED" },
  { step: "revoke root", expected: "revoked", tx: "0028a9ee6da0f821d85f89439d78ff2195d2c3ca24dd72b2d76bee1c7fc6f11e4a", block: 3_064_687 },
  { step: "sub-agent acts after root revoked", expected: "REFUSED (cascade)" },
  { step: "public verifier: child shows cut off by parent", expected: "revoked via parent" }
];
