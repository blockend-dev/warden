# Warden — Demo Script

A shot-by-shot script for recording the product walkthrough. Everything
below is the *actual* current UI (`apps/web`) and *actual* current circuit
behavior — nothing here is aspirational. Live, publicly reachable instance:
**[wardenweb-production.up.railway.app](https://wardenweb-production.up.railway.app/)**
— judges can use this directly, no setup required. To run it locally
instead: `npm run dev --workspace apps/web` at `http://localhost:3000`.

Environment note to say on camera, once, near the start: **this runs
against `LocalSimulatorNetwork`** — the real compiled Compact circuits,
executed in-process, no live network. The dashboard's environment badge
says `LOCAL SIMULATOR` for exactly this reason, on the live deployment too
— hosting it publicly changes nothing about that boundary; see
[`README.md`](../README.md) §12 for why a live *Midnight* devnet deployment
isn't part of this submission, and [`docs/DEPLOY-RAILWAY.md`](DEPLOY-RAILWAY.md)
for exactly what the Railway deployment is (and isn't).

## Core sequence (~75 seconds)

**0:00–0:08 — Problem.** On the dashboard hero: "Give AI agents real
authority without giving them unrestricted power." One sentence on camera:
*"An agent with a hot wallet is one prompt injection away from being
unlimited. Warden lets a principal grant a bounded, private mandate instead
of a blank check."*

**0:08–0:20 — Create a mandate.** Click **Create a mandate** →
`/mandates/new`. Step through Principal (shows the session's real
`principalPk`, fetched from `/api/identity`) → Agent (real `agentPk`) →
Policy (set a spending cap, asset, action type, destination, expiry, action
limit) → **Privacy preview**. Pause here: the private/public/derived
columns are real classifications, not decoration — point out that the cap
you just typed is under "Private" and will never appear again outside this
browser.

**0:20–0:28 — Confirm.** Click **Create mandate** — this is a real
`POST /api/mandate` → `WardenClient.createMandate` → `createMandate` circuit
call. Show the resulting mandate id (a real hash, copyable) and status
`ACTIVE`. Click through to the mandate detail page.

**0:28–0:40 — Authorized action.** In the authorization console, submit an
amount inside the cap. Show the verification-steps list animate through
(mandate located → not revoked → agent verified → not expired → policy
matched → within cap → commitment advanced) ending in **AUTHORIZED**. Note
on camera: this list is the real check order inside `authorize` in
`warden.compact`, rendered against the real pass/fail the circuit returned
— not a fake progress bar.

**0:40–0:50 — Attack.** Click **Try over-cap attempt**. Same call shape,
no client-side gate — the circuit itself rejects it. Show **BLOCKED**, with
the specific step it failed at, and the real error kind
(`PolicyViolationError`) surfaced from the SDK. No amount or remaining
headroom is revealed in the rejection, on purpose.

**0:50–1:00 — Revoke.** Click **Revoke mandate**, confirm in the dialog
(deliberately a two-step, non-trivial confirmation — this is a security
operation). Status flips to `REVOKED`.

**1:00–1:10 — Attack again.** Submit the exact same in-cap request that
succeeded at 0:28. Now: **BLOCKED**, rejected by the circuit's own
`!revoked.member(id)` check — not the UI remembering a flag. This is the
moment that should land: same call, same shape, permanently dead.

**1:10–1:15 — Close.** Back on the dashboard: the mandate node in the
authorization graph is now shown revoked; the activity feed shows the whole
sequence just performed, unedited.

## Optional extended sequence (+45 seconds)

- Open [`packages/contracts/src/warden.compact`](../packages/contracts/src/warden.compact)
  briefly — show the four ledger fields and the `authorize` circuit's
  assert list matching what was just narrated.
- Open [`packages/contracts/src/test/warden.test.ts`](../packages/contracts/src/test/warden.test.ts)
  and run `npm run test --workspace packages/contracts` on camera — 36
  passing, including named adversarial cases (wrong agent, forged context,
  replay, cross-mandate substitution).
- Briefly show the SDK snippet from [`README.md`](../README.md) §9 and the
  agent-adapter snippet from §10 — make clear the frontend is a consumer of
  this SDK, not a separate implementation.
- Mention Wave 2: [`docs/WAVE-2-DELEGATION-DESIGN.md`](WAVE-2-DELEGATION-DESIGN.md)
  — nested delegation (Principal → Agent → Sub-agent) has a full protocol
  design and threat model already written, not implemented.

## What not to say

- Do not say "deployed to Midnight" or name Preview/Preprod/Mainnet — it
  isn't, and doing so would contradict the environment badge on screen.
- Do not claim the over-cap rejection is a "smart contract revert" in the
  Solidity sense — say it plainly: the circuit cannot produce a valid proof
  for a non-compliant request, so no transaction is ever submitted.
