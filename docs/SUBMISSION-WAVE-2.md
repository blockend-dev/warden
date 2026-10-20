# Wave 2 submission

## Progress completed this Wave (paste into the AKINDO form)

Wave 1 proved a single hop: a principal grants an agent a private mandate and every
action is proven in zero knowledge. Wave 2 turns that primitive into a trust tree.

**New Midnight functionality (6 new Compact circuits, 9 total):** `delegate`,
`authorizeDelegated`, `revokeDelegated` give Principal → Agent → Sub-agent delegation where
a child can never hold more authority than its parent has left (delegation debits the
parent's own re-randomized spend commitment, so siblings cannot double-allocate) and
revoking the root kills every sub-agent instantly via a live parent check, leaving the
children's own flags untouched. `pause`/`resume` add a reversible kill-switch for the whole
subtree. `attestSpend` is selective disclosure: the agent proves "spent at most X" against
the on-chain commitment and the ledger learns only the ceiling.

**Quality:** 96 contract tests (+60), 24 SDK tests, 13 Playwright browser tests — all
passing — plus an Attack Lab of 19 adversarial scenarios and a seeded autonomous-agent swarm
run against the real compiled circuits. Every refusal shown is a circuit `assert`.

**Experience:** a ground-up white glassmorphism redesign with anime.js, a live delegation
graph, a public verifier (what a third party can and cannot learn), audit-packet export and
an in-app pitch deck.

**Live on Preprod:** the nine-circuit contract is deployed on Midnight Preprod
(`4c09848830b6630e045c29433dae38f06b7d03ce55a3aa8953fd9639dffdb15f`) and the full lifecycle — delegation, pause/resume, attestation, cascade
revocation and every refusal — ran through the web app's own API against it: 15/15 steps,
real proofs and transactions (`docs/DEPLOYMENT-WAVE-2.md`).

**Honest limits:** delegation depth is one hop; the free hosted demo runs on the simulator
and says so (live mode needs a funded wallet and private proof server). Details:
`docs/WAVE-2.md` §6.

## What changed since the previous submission
See the table at the top of the README and `docs/WAVE-2.md`. Wave 1 circuits are unchanged
except that `authorize` now also refuses while a mandate is paused.

## Checklist
- [ ] Public GitHub repo, Apache-2.0, **`midnightntwrk` topic added** (Settings → About → Topics)
- [ ] README explains project, setup, architecture, Midnight integration, how to test (done)
- [ ] Slide deck: open `/deck` → press **P** → Save as PDF (or share the URL)
- [ ] Demo video (3 min) — script below
- [ ] Live URL deployed (`docs/DEPLOY-FREE.md`) and pasted into README + form
- [ ] CI green (`.github/workflows/ci.yml`)

## 3-minute video script
1. **0:00 — Problem (20 s).** "Agents are starting to move money. Today you trust their code or approve every step."
2. **0:20 — Idea (20 s).** Dashboard. "A private mandate and a public proof it was respected. Spend cap, destination, identities never touch the ledger."
3. **0:40 — Load live demo (30 s).** Click it. Show the delegation graph: root → two sub-agents. "Real circuit calls, in-process."
4. **1:10 — Refusals (40 s).** Over-cap attack, wrong destination → red toasts with the circuit's assert text. Over-delegate attack → refused.
5. **1:50 — Cascade (25 s).** Pause (sub-agent blocked), resume, then Revoke root → both children turn red, "own flag untouched".
6. **2:15 — Selective disclosure (15 s).** Attest → "spent ≤ N"; Attest a lie → refused. "Auditor learns the ceiling, never the total."
7. **2:30 — Attack Lab (20 s).** Run all: 19/19. Swarm at 4×: "7 of 7 rogue attempts blocked."
8. **2:50 — Close (10 s).** Verify page. "Warden: authority you can delegate, bound, pause and revoke — privately."
