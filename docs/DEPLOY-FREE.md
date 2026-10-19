# Deploying `apps/web` for free

Railway moved the demo behind a paid plan; Hugging Face's Docker option turned out
to be paid too. This guide uses **Render's free web service** with an image built
for free in GitHub Actions.

## The constraint

The demo session store lives in server memory (`apps/web/src/lib/demo-session.ts`),
scoped per visitor by a cookie. That needs **one persistent Node process** — not
Vercel/Netlify-style serverless, where a session would vanish mid-demo. The root
`Dockerfile` builds the monorepo into exactly that.

## Why prebuilt

Render's free instance has 512 MB RAM, which is not enough to *build* the image
(Compact compile + `npm install` + `next build`). GitHub Actions builds it for
free on a public repo and publishes it to GHCR; Render only has to *run* it.

## Steps (about 15 minutes)

1. Push the repo to GitHub (public). `.github/workflows/image.yml` runs on every push
   to `main` and publishes `ghcr.io/<owner>/warden-web:latest` (first build ~10 min).
2. GitHub → your profile → **Packages** → `warden-web` → **Package settings** →
   change visibility to **Public** (so Render can pull without credentials).
3. <https://render.com> → sign up (GitHub login, no card) → **New → Web Service →
   Existing image** → `ghcr.io/<owner>/warden-web:latest` (owner in lowercase) →
   instance type **Free**.
4. Settings → **Health Check Path** = `/api/network-status`; add env var
   `NODE_OPTIONS=--max-old-space-size=384` to stay under the memory limit.
   (Or use the `render.yaml` blueprint at the repo root.)
5. Deploy. Your URL is `https://<service-name>.onrender.com`; put it in the README's
   *Live demo* line and the submission form.

Leaving `WARDEN_NETWORK` unset runs the real compiled circuits on the in-process
simulator (badge: `DEMO · SIMULATOR`). The Attack Lab always runs on a private
simulator.

## Updating

Push to `main` → the workflow publishes a new `:latest` → in Render click
**Manual Deploy → Deploy latest reference** (or enable auto-deploy for image
updates via a deploy hook). The URL never changes. Sessions are in memory, so each
redeploy starts them fresh; the UI detects this.

## Free-tier behaviour to know about

- The instance **spins down after 15 minutes idle** and takes ~30–60 s to wake on the
  next visit. Before judging, open the URL once, or point a free pinger (UptimeRobot,
  cron-job.org) at `/api/network-status` every 10 minutes.
- **Memory is tight.** If the instance restarts under load, that is the 512 MB
  ceiling; the fallback is to run locally (`npm run dev --workspace apps/web`) and
  record the demo from there. I could not test on Render itself.

## Other hosts

Anything that runs a container as one process works (Fly.io, Koyeb, Cloud Run), but
those ask for a payment method. Vercel/Netlify/Cloudflare Pages do not fit without
moving sessions into a database. The image honours `$PORT` (default 7860).

## Live Preprod mode is not part of the free setup

`WARDEN_NETWORK=preprod` needs a funded server wallet, a private proof server and a
multi-hour first wallet sync, and Wave 2's new circuits need a **fresh contract
deployment** (the Wave 1 address has only three circuits). The procedure is in
`docs/DEPLOYMENT.md`; build with `--build-arg WITH_PREPROD=1` to include proving keys.

| Variable | Secret? | Value |
|---|---|---|
| `WARDEN_NETWORK` | no | `preprod` |
| `WARDEN_PREPROD_SEED` | **yes** | the server wallet's 32-byte hex seed, funded with tNight |
| `WARDEN_CONTRACT_ADDRESS` | no | the deployed contract (Wave 1: `a61fb3417a82f6eff61e98e3ac50e759d916a86636f9ec25b9551375be8162bb`) |
| `WARDEN_PROOF_SERVER_URL` | no | a **private** URL for `midnightntwrk/proof-server:8.0.3` (port 6300) |

Persist `/app/apps/web/midnight-level-db` so restarts resume the wallet sync.
