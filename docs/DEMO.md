# Warden — Verification Procedure

A command-line procedure for independently checking Warden's claims — no
browser, no recording, no trust required. For a narrated UI walkthrough
instead, see [`docs/DEMO-SCRIPT.md`](DEMO-SCRIPT.md).

## The one-diagram privacy boundary

```
PRINCIPAL                         AGENT                          CHAIN
─────────                         ─────                          ─────
holds: Policy, salt,               holds: MandateContext           sees only:
  principalSecret                   (handed off out of band),        mandateId (hash)
  (derives agentSecret               agentSecret                     Policy.expiry (public —
  for the agent too, in                                                see PRIVACY.md)
  this MVP's single-session      ──authorize(id, amount,──▶          registered / revoked
  demo — see ARCHITECTURE §7)      asset, type, dest)                 (set membership)
                                                                      spentCommitment[id]
──createMandate(id)──────▶                                            (opaque, re-randomized)
                                 ◀──REVOKED / BLOCKED /               actionCount[id]
◀──REVOKE──────────────────       AUTHORIZED (from whether          a proof verified,
   (publishes id to `revoked`)    the call above threw)               or a transaction reverted
```

Everything above the "CHAIN" column stays there except the five public
fields listed — see [`docs/PRIVACY.md`](PRIVACY.md) for the field-by-field
version, including why `expiry` specifically is the one policy field that's
public.

## 1. Verify the contract compiles

```bash
npm run compact
```

Expect `compact compile src/warden.compact src/managed/warden` to report the
circuits compiling and exit `0`. This is the buildathon's technical gate —
no other check matters if this doesn't pass.

## 2. Verify the test suites pass

```bash
npm test
```

Expect all three suites green: `packages/contracts` (36 tests, real circuit
calls through the Compact-runtime simulator against the compiled contract —
no mocks), `packages/sdk` (9 tests, a genuine two-client principal/agent
flow), `packages/agent-adapter` (3 tests). Every attack in
[`docs/THREAT-MODEL.md`](THREAT-MODEL.md) is a named test in this run, not a
claim without evidence.

## 3. Verify the live protocol flow yourself

Against the [live deployment](https://wardenweb-production.up.railway.app/)
— or `npm run dev --workspace apps/web` and substitute `http://localhost:3000`:

```bash
BASE=https://wardenweb-production.up.railway.app
JAR=/tmp/warden-verify.jar

# A real mandate id and status — not a mock:
curl -s -c $JAR -b $JAR -X POST $BASE/api/mandate -H 'content-type: application/json' \
  -d '{"maxAmount":500,"asset":"DEMO","actionType":"payment","destinationCategory":"vendor:approved","expiresInSeconds":3600,"actionCountLimit":5}'
ID=$(...)   # extract "id" from the response above

# Authorized: a real circuit call, spentCommitment visibly changes
curl -s -c $JAR -b $JAR -X POST $BASE/api/authorize -H 'content-type: application/json' \
  -d "{\"id\":\"$ID\",\"amount\":120,\"asset\":\"DEMO\",\"actionType\":\"payment\",\"destinationCategory\":\"vendor:approved\"}"

# Over-cap: rejected by the circuit itself, PolicyViolationError, no amount/cap disclosed
curl -s -c $JAR -b $JAR -X POST $BASE/api/authorize -H 'content-type: application/json' \
  -d "{\"id\":\"$ID\",\"amount\":99999,\"asset\":\"DEMO\",\"actionType\":\"payment\",\"destinationCategory\":\"vendor:approved\"}"

# Revoke, then retry the exact call that succeeded above:
curl -s -c $JAR -b $JAR -X POST $BASE/api/revoke -H 'content-type: application/json' -d "{\"id\":\"$ID\"}"
curl -s -c $JAR -b $JAR -X POST $BASE/api/authorize -H 'content-type: application/json' \
  -d "{\"id\":\"$ID\",\"amount\":120,\"asset\":\"DEMO\",\"actionType\":\"payment\",\"destinationCategory\":\"vendor:approved\"}"
# -> now fails with MandateRevokedError, same call shape that succeeded before revocation
```

Every response includes the real `status` (`active`/`revoked`, `actionsAuthorized`,
`spentCommitment`) read straight off the ledger via `WardenClient.status()` —
not application-layer bookkeeping standing in for it.

## 4. Verify the privacy boundary

At no point in step 3's responses does `maxAmount`, `actionCountLimit`, or
any other private policy field appear — check the raw JSON yourself.
`packages/contracts/src/test/warden.test.ts`'s "privacy" test group asserts
this structurally (rejection messages never contain the private cap;
consecutive `spentCommitment` values are unlinkable byte strings) rather
than relying on the UI not showing something it secretly has.

## 5. Read the source that backs all of the above

- [`packages/contracts/src/warden.compact`](../packages/contracts/src/warden.compact) —
  the whole contract, one file, three circuits.
- [`packages/contracts/src/test/warden.test.ts`](../packages/contracts/src/test/warden.test.ts) —
  every claim in this document as a named, passing test.
- [`docs/WAVE-1-SPEC.md`](WAVE-1-SPEC.md) — the normative invariant list step
  3's flow is checked against.

## What "verified" means here

Every state transition above is a direct readout of a real circuit call's
outcome against the real compiled `warden.compact`, run through the
Compact-runtime simulator — not frontend state standing in for it, and not
a mocked response. The "on-chain" framing describes what a full
Preview/Preprod/Mainnet deployment does; this web app itself runs the
identical circuit logic through the simulator rather than a live network,
for demo responsiveness and to avoid asking judges to fund a wallet — the
same lifecycle has separately been proven end to end with real proofs and
real transactions on the live public Preprod network, see
[`docs/IMPLEMENTATION-NOTES.md`](IMPLEMENTATION-NOTES.md) for the evidence
and [`README.md`](../README.md) §12 for the summary.
