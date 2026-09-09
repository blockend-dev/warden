# Warden — Submission Checklist

Buildathon hard requirements, checked against the actual repository, with
evidence. Not a self-assessment — every row links to the file or command
that backs it.

| Requirement | Status | Evidence |
|---|---|---|
| Public GitHub repository | **NEEDS MANUAL ACTION** | No `git remote` is configured yet (`git remote -v` is empty). The repository must be pushed to GitHub before submission. |
| Clear README | PASS | [`README.md`](../README.md) — problem, privacy rationale, Midnight rationale, contract-enforcement list, privacy table, SDK/adapter usage, setup, testing, limitations, licensing, doc index. |
| Setup instructions | PASS | [`README.md`](../README.md) §0 — exact commands, verified against the real toolchain (Compact 0.34.0, Node 24), no Docker required. |
| Architecture explanation | PASS | [`README.md`](../README.md) §6, [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), [`docs/WAVE-1-SPEC.md`](WAVE-1-SPEC.md) §2. |
| Explicit Midnight integration explanation | PASS | [`README.md`](../README.md) §5–§7 — Compact's disclosure-taint system, `blockTimeLte`, commitment chaining, all tied to specific lines in [`packages/contracts/src/warden.compact`](../packages/contracts/src/warden.compact). |
| Clear instructions for judges to test/evaluate | PASS | [`README.md`](../README.md) §0 "verify the whole repository" block; [`docs/DEMO-SCRIPT.md`](DEMO-SCRIPT.md) for the product walkthrough. |
| Description of Wave 1 progress | PASS | [`docs/WAVE-1-SPEC.md`](WAVE-1-SPEC.md) (frozen baseline), [`README.md`](../README.md) §14. |
| Slide deck | **NEEDS MANUAL ACTION** | Not produced by this repository. [`docs/SUBMISSION-NARRATIVE.md`](SUBMISSION-NARRATIVE.md) is written to convert directly into deck slides. |
| Demo/pitch video | **NEEDS MANUAL ACTION** | Not producible from this environment (no screen/voice recording). [`docs/DEMO-SCRIPT.md`](DEMO-SCRIPT.md) is a shot-by-shot script for recording one. |
| `midnightntwrk` GitHub label/topic | **BLOCKED** | Depends on the repo existing on GitHub first (see row 1). |
| Midnight-related code is Apache 2.0 compliant | PASS (fixed this pass) | Root [`LICENSE`](../LICENSE) added (was missing). Every workspace `package.json` now declares `"license": "Apache-2.0"` (previously only `packages/contracts` did). |
| Compact contract compiles | PASS | `npm run compact` → `compact compile src/warden.compact src/managed/warden` → "Compiling 3 circuits" → exit 0, verified fresh this pass. |
| Meaningful Midnight functionality exists | PASS | 4 ledger fields, 3 circuits, real commitment/nonce cryptography, 36 contract-level tests including adversarial/impersonation/replay cases — see [`docs/THREAT-MODEL.md`](THREAT-MODEL.md). |
| Not a fork/copy/superficial modification | PASS | Original protocol design (`WAVE-1-SPEC.md`) with its own invariants, threat model, and a from-scratch Wave 2 delegation design (`WAVE-2-DELEGATION-DESIGN.md`) not present in any Midnight example repository. |

## What "PASS" means here

Every PASS row above was checked against the actual repository during this
audit pass — file contents read, commands run, output inspected — not
inferred from prior claims. See §17 "Validation" evidence in the final
audit report for exact commands and output.

## What is not, and cannot be, fixed by editing this repository

- **Pushing to a public GitHub repo, adding the `midnightntwrk` topic,
  recording a demo video, and producing slides** are actions outside this
  environment's reach (no GitHub credentials configured, no screen/audio
  recording capability). They are listed as manual actions, not silently
  marked done.
- **AKINDO platform steps**, per the Official Rules: every team member
  registers individually on AKINDO; the actual submission (repo link, deck,
  video, Wave progress description) is filed through AKINDO's submission
  page, not just left sitting in this repository. Team eligibility (age 18+,
  no sanctioned-jurisdiction nexus) is a personal matter for each member,
  not something this repository can attest to.

## Precise official requirements (from the published Rules), cross-checked

- **Technical Gate — automatic disqualification if missed:** "at least one
  Compact contract that compiles successfully." Confirmed this pass — see
  the audit report's validation section. Everything else under "to be
  eligible for judging" (meaningful functionality, not a fork, the
  `midnightntwrk` GitHub label, public repo + deck + video, licensing) is
  also a hard gate, not a scoring nicety.
- **GitHub repo topics** ("tag your repositories with relevant Midnight
  topics") is separate from, and in addition to, the mandatory
  `midnightntwrk` label — both are GitHub-settings actions to do once the
  repo is pushed. Reasonable topics: `midnight`, `midnightntwrk`, `compact`,
  `zero-knowledge`, `zk`, `privacy`.
- **Communication (10%) is scored on the video + deck specifically**, not
  the README — `docs/DEMO-SCRIPT.md` and `docs/SUBMISSION-NARRATIVE.md`
  exist to make producing both fast, but they are not substitutes for
  actually recording/building them.
- **Resubmission requirement for Wave 2/3:** "a clear explanation of what
  has changed since the previous submission" is required *when
  resubmitting*. Not applicable to this Wave 1 submission; note for
  whoever prepares the Wave 2 submission to open with a "what changed since
  Wave 1" section referencing this checklist and `WAVE-1-SPEC.md` as the
  frozen baseline.
