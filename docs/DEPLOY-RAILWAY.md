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

1. **Push this repository to GitHub** first (see `docs/SUBMISSION-CHECKLIST.md`
   — this is also a hard submission requirement independent of deployment).
2. On [railway.app](https://railway.app), **New Project → Deploy from GitHub
   repo** → select this repository.
3. Railway detects the root `Dockerfile` automatically (Nixpacks is skipped
   when a `Dockerfile` is present). No build/start command configuration is
   needed — they're baked into the image (`npm run start --workspace apps/web`,
   which respects Railway's injected `$PORT`).
4. **No environment variables are required.** The app has no database, no
   API keys, no secrets — it's fully self-contained.
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
   attach a custom domain). Open it and confirm the environment badge reads
   `LOCAL SIMULATOR` — that's correct, not a bug: the deployment is real
   infrastructure, but the Midnight logic still runs through
   `LocalSimulatorNetwork` (real compiled circuits, no live network — see
   `README.md` §12). A live URL doesn't change that honesty boundary; it
   just removes the "clone and run it yourself" step for judges.

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
  known `@react-three/fiber` optional-peer-dependency resolution issue (see
  `docs/IMPLEMENTATION-NOTES.md` if you want the full story).
- **Build fails at `compact update` or the compiler download:** transient
  GitHub Releases network issue — retry the deploy.
- **App builds but crashes on start:** check `docker logs`-equivalent
  (Railway's deploy logs) for the actual Next.js startup error; this exact
  image was verified to start cleanly (`✓ Ready in 3.6s`) locally.
- **Two people testing at once seem to interfere with each other:** confirm
  replica count is 1 (step 5) — this is the one setting that actually
  matters for correctness here.

## After it's live

Send me the URL and I'll add it to `README.md` and `docs/DEMO-SCRIPT.md` so
judges have a one-click link instead of only local-run instructions.
