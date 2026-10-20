# Wave 2 verification — Midnight Preprod (live)

Generated 2026-10-20T17:52:57.854Z by `scripts/verify-live.mjs` against `http://localhost:3100`.

Contract: `4c09848830b6630e045c29433dae38f06b7d03ce55a3aa8953fd9639dffdb15f`

Deploy transaction: `0072e052ec03fe1dba01220c328346c4707bc588bb56c3b15bf8ba2bc282750a25` (block 3,064,612)

| # | Step | Expected | Result | Transaction | Block |
|---|---|---|---|---|---|
| 1 | createMandate (root) | registered | ✅ | `00e7adf0facc8b26628f56e6cdcb95d663cc206abe483760dbca56bc76ee6cd625` | 3,064,626 |
| 2 | delegate 400 of 1000 to a sub-agent | registered, parent recorded | ✅ | `003cea96c8fa1fa73f0474193314f6c345b6a45fc97e3a461d554740adbd223193` | 3,064,637 |
| 3 | over-delegate 700 (only 600 left) | REFUSED | ✅ | none (no tx: the proof cannot be built) | — |
| 4 | sub-agent authorizes 120 | AUTHORIZED | ✅ | `00c48eb08fb1d14946f813b2a08ac1bf3386e7d6bf71af0a5f62e72e63d3d46359` | 3,064,647 |
| 5 | sub-agent over its 400 cap | REFUSED | ✅ | none (no tx: the proof cannot be built) | — |
| 6 | sub-agent pays an unapproved destination | REFUSED | ✅ | none (no tx: the proof cannot be built) | — |
| 7 | pause root | paused | ✅ | `007420c9d9ddb8b75304c7b9f854ea30dd29d5c1357af045a9e5e316eeb9096ac8` | 3,064,655 |
| 8 | sub-agent acts while root paused | REFUSED | ✅ | none (no tx: the proof cannot be built) | — |
| 9 | resume root | active | ✅ | `0016f7881541cb3fbb4dcf5e68f4cc3837d9337351a92ec35ff9cec59074d7a86f` | 3,064,663 |
| 10 | sub-agent acts after resume | AUTHORIZED | ✅ | `0011bd68df381f596a6dc2af43004a6d6105c7e889f20fce22dfb37e70c645ade0` | 3,064,671 |
| 11 | attestSpend: spent <= 900 (committed 400) | attested | ✅ | `00ee4f38432cce2b955d8142211228864a851249c6f003030a12fbc38c5ee802e3` | 3,064,679 |
| 12 | attestSpend: false ceiling 100 | REFUSED | ✅ | none (no tx: the proof cannot be built) | — |
| 13 | revoke root | revoked | ✅ | `0028a9ee6da0f821d85f89439d78ff2195d2c3ca24dd72b2d76bee1c7fc6f11e4a` | 3,064,687 |
| 14 | sub-agent acts after root revoked | REFUSED (cascade) | ✅ | none (no tx: the proof cannot be built) | — |
| 15 | public verifier: child shows cut off by parent | revoked via parent | ✅ | — | — |

15/15 steps behaved as the protocol promises.

## Check it yourself

The contract and its calls are readable from any Midnight Preprod indexer. With a free
[Blockfrost](https://blockfrost.io) project ID for *Midnight Preprod*:

```bash
curl -s -X POST -H 'content-type: application/json' \
  -d '{"query":"{ contractAction(address: \"4c09848830b6630e045c29433dae38f06b7d03ce55a3aa8953fd9639dffdb15f\") { __typename } }"}' \
  "https://midnight-preprod.blockfrost.io/api/v0?project_id=$BLOCKFROST_PROJECT_ID"
# {"data":{"contractAction":{"__typename":"ContractCall"}}}
```

Refused steps produce **no transaction by design**: the circuit assertion fails while the proof
is being built, so nothing is ever submitted. They are visible as typed errors in the app and
in this table's "Expected" column. Reproduce the whole table with
`BASE=<app> node scripts/verify-live.mjs` against an app started by `scripts/run-preprod.sh`.

Environment: Midnight Preprod node 2.1.0 via Blockfrost, proof server 8.1.0, contract compiled
with Compact 0.31.1, midnight-js 4.1.1.
