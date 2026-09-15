# Deploying `apps/web` to Railway

This guide is verified, not speculative: the `Dockerfile` at the repo root
was built and run locally end-to-end before this guide was written —
`docker build`, then a real `docker run`, then the full
create → authorize → over-cap-reject → revoke → reject-again flow against
the running container via `curl`, all passing. Railway builds this same
`Dockerfile`, so the same result is expected there.

## Why Docker, and why not Vercel

The app's demo session lives in server memory (see
`apps/web/src/lib/demo-session.ts`), scoped per visitor by a cookie. That
requires the app to run as **one persistent Node process** — not Vercel's
default model of ephemeral serverless functions per request, where the
session would randomly vanish mid-demo. The `Dockerfile` builds the whole
monorepo (Compact compiler → contract compile → every workspace package →
`next build`) into one image that runs `next start` as a long-lived process,
which is what Railway (and Render, Fly.io, or a plain VPS) actually give
you.

## Steps

1. **Push this repository to GitHub** first — a public repo is a submission
   requirement independent of deployment.
2. On [railway.app](https://railway.app), **New Project → Deploy from GitHub
   repo** → select this repository.
3. Railway detects the root `Dockerfile` automatically (Nixpacks is skipped
   when a `Dockerfile` is present). No build/start command configuration is
   needed — they're baked into the image (`npm run start --workspace apps/web`,
   which respects Railway's injected `$PORT`).
4. **No environment variables are required for the simulator (default).**
   Leaving `WARDEN_NETWORK` unset, or anything other than `preprod`, runs
   the app against `LocalSimulatorNetwork` exactly as before — no database,
   no API keys, no secrets. **For the live Midnight Preprod backend**, see
   "Live Preprod backend" below — it's an explicit opt-in, not the
   zero-config path.
5. **Set the service's replica/instance count to 1.** This is not optional:
   the in-memory session store is single-process by design (documented
   limitation, not a bug — see `docs/WAVE-1-SPEC.md` §11 and the deployment
   note above). More than one replica means a visitor's session can land on
   a different instance than the one that created it, breaking the demo
   unpredictably. Railway defaults to 1 replica for a new service, so this
   is usually just "don't turn on autoscaling/multiple replicas," not an
   extra step.
6. Deploy. **Expect the first build to take around 8–12 minutes** — it's
   genuinely doing more than a typical Next.js deploy: downloading the
   Compact compiler, compiling the real ZK circuit, then building four
   TypeScript packages before `next build` even starts. This matched
   locally: `compact update` (~18s) → `npm install` (a few minutes) →
   contract compile + package builds → `next build` (~80s) → image export.
   Subsequent deploys are faster if Railway's layer cache is reused.
7. Once deployed, Railway gives you a public `*.up.railway.app` URL (or
   attach a custom domain). Open it and check the environment badge: with no
   `WARDEN_NETWORK` set, it reads `DEMO · SIMULATOR` — correct, not a bug
   (real compiled circuits, no live network — see `README.md` §12). Set up
   the live Preprod backend below and it reads `LIVE · MIDNIGHT PREPROD`
   instead, once the server-side connection actually finishes initializing.

## Live Preprod backend

By default the hosted app runs `LocalSimulatorNetwork`, same as running it
locally. Setting `WARDEN_NETWORK=preprod` (plus the variables below) makes
the app's own API routes execute the mandate lifecycle against the real,
already-deployed Warden contract on Midnight Preprod — real ZK proofs, real
transactions, the same proven path documented in
[`docs/DEPLOYMENT.md`](DEPLOYMENT.md). This needs two things Railway's
single web service doesn't give you by default: a proof server the app can
reach privately, and (for a fast restart instead of an hours-long resync) a
persistent volume.

**Why the app compiles the contract twice (0.34.0 and 0.31.1).** The
current Compact compiler (0.34.0), used by `packages/contracts` for Wave
1's own tests, generates an async circuit API that no currently-stable
`midnight-js` release supports. The live backend instead compiles the same,
unmodified `warden.compact` source with an older compiler (0.31.1) that
matches the stable `midnight-js@4.1.1` line the proven Preprod path uses
(see `npm run compact:legacy --workspace apps/web`, wired into the
`Dockerfile`). Both compiled builds come from the identical contract
source — this is a toolchain-compatibility detail, not a protocol
difference.

**How the live backend handles multiple visitors.** One shared server-side
wallet serves the whole deployment, not one per visitor — a fresh Preprod
wallet's first sync takes hours, which a hosted demo can't pay per visitor.
Every demo session still gets its own principal/agent identities and its
own mandates; only the wallet that pays fees and submits transactions is
shared, and calls into it are serialized (see `enqueue` in
`apps/web/src/server/preprod/preprod-network.ts`) so concurrent requests
can't race its transaction nonce. This is deliberate, documented scope for
a judge-facing demo — not a production multi-tenant custody model.

### 1. A second Railway service for the proof server

**What's actually verified:** every successful run in this repository —
the local devnet lifecycle, both live Preprod validation scripts, and the
`apps/web` live smoke test — reached the proof server as a plain HTTP URL
(`http://127.0.0.1:6300`, the image `midnightntwrk/proof-server:8.0.3` run
via `docker compose`, `infra/devnet/standalone.yml`). The code itself
(`WARDEN_PROOF_SERVER_URL` → `new URL(...)` → `httpClientProofProvider`,
`apps/web/src/server/preprod/preprod-network.ts`) has no hardcoded
localhost assumption — it's a generic HTTP client pointed at whatever URL
it's given.

**What's a sound recommendation, not yet independently verified on
Railway:** Midnight's own docs are explicit that the proof server "handles
your private data" and should not be public — Railway's private networking
(every service in a project gets an internal `<service>.railway.internal`
DNS name, unreachable from outside the project) is the natural fit, and the
code should accept that URL with no changes. This session has no Railway
account access, so this specific topology has not been exercised against a
real Railway deployment — treat it as the right design, confirm it
actually resolves once deployed rather than assuming:

1. In the same Railway project, **New → Empty Service**, then set its
   source to the public Docker image `midnightntwrk/proof-server:8.0.3`
   (Settings → Source → Docker Image) — the exact image already proven
   working locally.
2. Set its internal port to `6300` (the image's own default).
3. **Do not expose a public domain for this service.** It only needs to be
   reachable from `warden-web` over Railway's private network.
4. Note the service's name (e.g. `proof-server`) — `warden-web`'s
   `WARDEN_PROOF_SERVER_URL` points at
   `http://<that-name>.railway.internal:6300`. If that name doesn't
   resolve for some reason, Railway's own docs for private networking are
   the next place to check, not a code change here.

### 2. A persistent volume for wallet sync state

A brand-new Preprod wallet's first sync has to catch up the entire chain
history — multiple hours (this repository's own validation runs took
~3h45m and ~4h18m for two independent processes syncing the same address;
other teams on the buildathon's channel reported similar). That cost is
unavoidable at least once per process. Without a volume, Railway's
container filesystem resets on every redeploy, and the app starts that
sync over from nothing again each time. Attaching one is expected to let a
later restart resume from near the last-synced block rather than from
zero — **confirmed:** `apps/web/midnight-level-db/` is genuinely where the
running app writes its LevelDB state (verified directly after a real sync
completed). **Not yet independently confirmed:** how much a *second* boot
that reuses this exact directory actually speeds up — every validation run
so far has been a single continuous process, never a stop/restart reusing
prior state. Treat the volume as the correct, expected mitigation, not yet
as a measured one; if a post-attach restart still takes as long as a fresh
sync, that's worth re-examining, not assuming away.

1. On the `warden-web` service, **Settings → Volumes → New Volume**.
2. Mount path: `/app/apps/web/midnight-level-db` (matches the `WORKDIR /app`
   in the `Dockerfile` and where the wallet writes its sync state — see
   `apps/web/src/server/preprod/preprod-network.ts`).
3. Redeploy. The first boot after this still takes hours; every one after
   that should be fast. `PREPROD · INITIALIZING` in the badge means it's
   still catching up — that's expected, not broken.

### 3. Environment variables on `warden-web`

| Variable | Secret? | Value |
|---|---|---|
| `WARDEN_NETWORK` | no | `preprod` |
| `WARDEN_PREPROD_SEED` | **yes** | the server wallet's 32-byte hex seed — never logged, never sent to the browser |
| `WARDEN_CONTRACT_ADDRESS` | no | the deployed contract's address (this repository's proven one: `a61fb3417a82f6eff61e98e3ac50e759d916a86636f9ec25b9551375be8162bb`) |
| `WARDEN_PROOF_SERVER_URL` | no | `http://<proof-server-service-name>.railway.internal:6300` |

`WARDEN_PREPROD_INDEXER` / `WARDEN_PREPROD_INDEXER_WS` / `WARDEN_PREPROD_NODE`
default to the real public Preprod endpoints and don't need to be set — see
`.env.example` for all of them. The server wallet needs its own tNight
balance on Preprod; fund its address via the public faucet before expecting
any live transaction to succeed (see
`infra/devnet/deploy-script-legacy/src/print-preprod-address.ts` to derive
the address from a seed without running the whole validation script).

## Verifying it after deploy

From any machine:

```bash
curl -s -c /tmp/j.jar -b /tmp/j.jar https://<your-app>.up.railway.app/api/identity
curl -s -c /tmp/j.jar -b /tmp/j.jar -X POST https://<your-app>.up.railway.app/api/mandate \
  -H 'content-type: application/json' \
  -d '{"maxAmount":500,"asset":"DEMO","actionType":"payment","destinationCategory":"vendor:approved","expiresInSeconds":3600,"actionCountLimit":5}'
```

A real mandate id and `"status":"active"` back means the deployment is
genuinely running the compiled circuit, not just serving a static page.

## Troubleshooting

- **Build times out / fails at `npm install`:** Railway's default build
  resources are usually enough for this, but if it fails, check the build
  log for the actual npm error rather than assuming it's a timeout —
  `--legacy-peer-deps` is already set in the `Dockerfile` to work around a
  known `@react-three/fiber` optional-peer-dependency resolution issue.
- **Build fails at `compact update` or the compiler download:** transient
  GitHub Releases network issue — retry the deploy.
- **App builds but crashes on start:** check `docker logs`-equivalent
  (Railway's deploy logs) for the actual Next.js startup error; this exact
  image was verified to start cleanly (`✓ Ready in 3.6s`) locally.
- **Two people testing at once seem to interfere with each other:** confirm
  replica count is 1 (step 5) — this is the one setting that actually
  matters for correctness here.

## Current live deployment

**[wardenweb-production.up.railway.app](https://wardenweb-production.up.railway.app/)** —
deployed via this exact procedure, linked from `README.md`. Redeploying
from a fresh Railway project follows the same steps above.
