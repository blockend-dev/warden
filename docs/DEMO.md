# Warden — Demo Script (sub-60-second walkthrough)

## The one-diagram privacy boundary

```
PRINCIPAL                         AGENT                          CHAIN
─────────                         ─────                          ─────
holds: Policy, salt,               holds: MandateContext           sees only:
  principalSecret                   (handed off out of band),        mandateId (hash)
  (derives agentSecret               agentSecret                     registered / revoked
  for the agent too, in                                               (set membership)
  this MVP's single-session      ──authorize(id, amount,──▶          spentCommitment[id]
  demo — see ARCHITECTURE §7)      asset, type, dest,                 (opaque, re-randomized)
                                    now)                              actionCount[id]
──createMandate(id)──────▶                                         a proof verified,
                                 ◀──REVOKED / BLOCKED /               or a transaction reverted
◀──REVOKE──────────────────       AUTHORIZED (from whether
   (publishes id to `revoked`)    the call above threw)
```

Nothing above the "CHAIN" column ever crosses into it except the four public
fields listed. That's the whole privacy story in one picture — see
`docs/PRIVACY.md` for the field-by-field version.

## Script

**0:00–0:10 — Create mandate.** Principal sets a policy: *cap 500, asset
`DEMO`, action type `payment`, one destination category, expires in an hour,
up to 5 actions.* UI shows the policy fields, then immediately masks them:
`PRIVATE POLICY ████████`. Only the resulting `mandateId` (a hex commitment)
appears as something "public."

**0:10–0:25 — Authorized action.** Agent requests a payment within the cap.
UI shows a real circuit call running (not a spinner over nothing — the proof
generation step is visible), then **✓ AUTHORIZED**. The policy stays masked;
`spentCommitment` visibly changes to a new opaque value; `actionCount`
increments to 1.

**0:25–0:40 — Attack.** Agent requests a payment that would exceed the
remaining cap. The SAME circuit call is attempted — not a disabled button,
not a client-side check — and the call itself fails.
**✕ BLOCKED — POLICY VIOLATION.** No amount, cap, or remaining-headroom
number is ever shown to explain *why*, on purpose (see `docs/PRIVACY.md`).

**0:40–0:50 — Revoke.** Principal presses **REVOKE AGENT**. `id` is inserted
into the public `revoked` set. UI: **REVOKED**.

**0:50–0:60 — Attack again.** Agent retries the same valid, in-cap request
that succeeded at 0:10–0:25. Same circuit, same call shape — now
**✕ REVOKED**, rejected by the circuit's own `!revoked.member(pid)` check,
not by the UI remembering a flag.

## What makes this demo honest, not just fast

- Every one of the four states (AUTHORIZED / BLOCKED-POLICY / REVOKED /
  the initial private-policy mask) is a direct readout of a real circuit
  call's outcome against the real compiled `warden.compact`, run through the
  Compact-runtime simulator described in `docs/IMPLEMENTATION-NOTES.md` — not
  frontend state standing in for it.
- The masked policy is actually never sent anywhere the UI could read it
  back from — see `docs/PRIVACY.md`'s SDK-surface leakage tests.
- The "on-chain" framing describes what a full Preview/Preprod deployment
  does; running this exact script end-to-end against a live network additionally
  requires the Docker-based proof server + devnet, which this development
  environment does not have available (see `docs/IMPLEMENTATION-NOTES.md`) —
  the demo as shippable today runs the identical circuit logic through the
  simulator, and `docs/ARCHITECTURE.md` states plainly where the line between
  "simulated" and "deployed" currently sits.
