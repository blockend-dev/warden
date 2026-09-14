# Warden — Submission Checklist

Buildathon hard requirements, checked against the actual repository, with
evidence. Every row links to the file, command, or live check that backs it.

| Requirement | Status | Evidence |
|---|---|---|
| Public GitHub repository | PASS | [`github.com/blockend-dev/warden`](https://github.com/blockend-dev/warden) — confirmed public via the GitHub API (`"private": false`). |
| Clear README | PASS | [`README.md`](../README.md) — problem, privacy rationale, Midnight rationale, contract-enforcement list, privacy table, SDK/adapter usage, setup, testing, limitations, licensing, doc index. |
| Setup instructions | PASS | [`README.md`](../README.md) §11 — exact commands, verified against the real toolchain (Compact 0.34.0, Node 24), no Docker required. |
| Architecture explanation | PASS | [`README.md`](../README.md) §5 & §7, [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), [`docs/WAVE-1-SPEC.md`](WAVE-1-SPEC.md) §2. |
| Explicit Midnight integration explanation | PASS | [`README.md`](../README.md) §3, §5, §7 — Compact's disclosure-taint system, the dual-ledger model, `blockTimeLte`, commitment chaining, all tied to specific lines in [`packages/contracts/src/warden.compact`](../packages/contracts/src/warden.compact). |
| Clear instructions for judges to test/evaluate | PASS | [`README.md`](../README.md) §11; [`docs/DEMO.md`](DEMO.md) for a command-line verification procedure; [`docs/DEMO-SCRIPT.md`](DEMO-SCRIPT.md) for the UI walkthrough. |
| Description of Wave 1 progress | PASS | [`docs/WAVE-1-SPEC.md`](WAVE-1-SPEC.md) (frozen baseline), [`README.md`](../README.md) §4. |
| Live, publicly reachable demo | PASS | [wardenweb-production.up.railway.app](https://wardenweb-production.up.railway.app/) — deployed and verified end-to-end; see [`docs/DEPLOY-RAILWAY.md`](DEPLOY-RAILWAY.md). |
| Live network deployment (beyond the simulator) | PASS | Full mandate lifecycle — deploy, `createMandate`, `authorize` (accepted and correctly-rejected cases), `revoke`, post-revoke `authorize` (correctly rejected) — with real ZK proofs and real transactions on the live public Midnight Preprod network. Real contract address, mandate ID, transaction hashes, and block numbers in [`docs/IMPLEMENTATION-NOTES.md`](IMPLEMENTATION-NOTES.md). Not a hard requirement (the technical gate only needs a compiling contract), but strictly stronger evidence than the simulator alone. |
| Slide deck | **NEEDS MANUAL ACTION** | Not produced by this repository. [`docs/SUBMISSION-NARRATIVE.md`](SUBMISSION-NARRATIVE.md) is written to convert directly into deck slides. |
| Demo/pitch video | **NEEDS MANUAL ACTION** | Not producible from this environment (no screen/voice recording). [`docs/DEMO-SCRIPT.md`](DEMO-SCRIPT.md) is a shot-by-shot script for recording one. |
| `midnightntwrk` GitHub label/topic | **NEEDS MANUAL ACTION** | Repo is live and public; no topics are set yet (confirmed via the GitHub API — `topics: []`). Add `midnightntwrk` (mandatory) plus reasonable additional topics (`midnight`, `compact`, `zero-knowledge`, `zk`, `privacy`) in the repo's GitHub settings. |
| Midnight-related code is Apache 2.0 compliant | PASS | Root [`LICENSE`](../LICENSE). Every workspace `package.json` declares `"license": "Apache-2.0"`. |
| Compact contract compiles | PASS | `npm run compact` → `compact compile src/warden.compact src/managed/warden` → circuits compile → exit 0. |
| Meaningful Midnight functionality exists | PASS | 4 ledger fields, 3 circuits, real commitment/nonce cryptography, 36 contract-level tests including adversarial/impersonation/replay cases — see [`docs/THREAT-MODEL.md`](THREAT-MODEL.md). |
| Not a fork/copy/superficial modification | PASS | Original protocol design ([`WAVE-1-SPEC.md`](WAVE-1-SPEC.md)) with its own invariants, threat model, and a from-scratch Wave 2 delegation design ([`WAVE-2-DELEGATION-DESIGN.md`](WAVE-2-DELEGATION-DESIGN.md)) not present in any Midnight example repository. |

## What is still a manual action, and why

- **Adding the `midnightntwrk` GitHub topic** and any additional topics is a
  repo-settings action on [github.com/blockend-dev/warden](https://github.com/blockend-dev/warden) —
  one field, not code.
- **Recording a demo video and producing slides** need screen/voice
  recording and slide-authoring tools outside this repository's reach.
  `docs/DEMO-SCRIPT.md` and `docs/SUBMISSION-NARRATIVE.md` exist to make
  producing both fast, but they are not substitutes for actually building
  them — Communication (10% of the rubric) is scored on the video and deck
  specifically, not the README.
- **AKINDO platform steps**, per the Official Rules: every team member
  registers individually on AKINDO; the actual submission (repo link, deck,
  video, Wave progress description) is filed through AKINDO's submission
  page, not just left sitting in this repository. Team eligibility (age
  18+, no sanctioned-jurisdiction nexus) is a personal matter for each
  member, not something this repository can attest to.

## Technical gate

"At least one Compact contract that compiles successfully" is an automatic
disqualifier if missed — confirmed above. Everything else under "to be
eligible for judging" per the Official Rules (meaningful functionality, not
a fork, the `midnightntwrk` GitHub label, public repo + deck + video,
licensing) is also a hard gate, not a scoring nicety.

## Resubmission note (for Wave 2)

The Official Rules require "a clear explanation of what has changed since
the previous submission" when resubmitting in a later Wave — not applicable
here, but whoever prepares the Wave 2 submission should open it with a
"what changed since Wave 1" section referencing this checklist and
[`WAVE-1-SPEC.md`](WAVE-1-SPEC.md) as the frozen baseline.
