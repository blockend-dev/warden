# Deploying `apps/web` for free

Railway moved the demo behind a paid plan. This guide replaces
`DEPLOY-RAILWAY.md` with a free host that fits Warden's one real constraint.

## The constraint

The demo session store lives in server memory (`apps/web/src/lib/demo-session.ts`),
scoped per visitor by a cookie. That needs **one persistent Node process** — not
Vercel/Netlify-style serverless functions, where a session would randomly vanish
mid-demo. So the host must run a long-lived container. The root `Dockerfile`
builds the whole monorepo into exactly that.

## Options

| Host | Cost | Fit |
|---|---|---|
| **Hugging Face Spaces (Docker)** — recommended | Free CPU basic (2 vCPU, 16 GB RAM), public URL, no card | Builds the root `Dockerfile` from a git push; one container = one process. Sleeps after ~48 h idle and wakes on the next visit (sessions are in memory, so a wake-up starts fresh — the UI handles it). |
| Render (free web service) | Free, no card | Works from the same Dockerfile, but the free instance has 512 MB RAM — too little to *build* the image. Build elsewhere and deploy a prebuilt image, or use Hugging Face. Spins down after 15 min idle. |
| Fly.io / Koyeb / Cloud Run | Free allowances, but need a payment method on file | Fine, not "no strings". |
| Vercel / Netlify / Cloudflare Pages | Free | **Not suitable** without moving sessions to a database (serverless splits requests across processes). |

## Hugging Face Spaces (about 10 minutes)

1. Create a free account at <https://huggingface.co>.
2. **New Space** → SDK **Docker** → blank template → keep it public → name it `warden`.
3. Create a **write** access token at <https://huggingface.co/settings/tokens>.
4. From the repo root:

   ```bash
   HF_USER=<your-username> HF_SPACE=warden HF_TOKEN=hf_xxx ./scripts/deploy-huggingface.sh
   ```

   The script pushes a clean snapshot of `HEAD` (with the Space's YAML front
   matter prepended to a *copy* of the README) to the Space. Nothing else is
   published and the token is not stored.
5. The Space builds the `Dockerfile` (~6–10 min the first time: Compact compiler
   download → contract compile → package builds → `next build`). When it turns
   green your app is at `https://<your-username>-warden.hf.space`.
6. Put that URL in the README's *Live demo* line and on the submission form.

No environment variables are needed: leaving `WARDEN_NETWORK` unset runs the real
compiled circuits on the in-process simulator (badge reads `DEMO · SIMULATOR`).
The Attack Lab always runs on a private simulator regardless.

### Verify after deploy

```bash
BASE=https://<your-username>-warden.hf.space
curl -s $BASE/api/network-status                     # {"mode":"simulator"}
curl -s -X POST $BASE/api/lab -H 'content-type: application/json' -d '{}' | head -c 300
```

A JSON body of 19 scenario results means the compiled circuits are really running.

### Keeping it awake (optional)

Free Spaces sleep when idle. For judging windows, point any free uptime pinger
(UptimeRobot, cron-job.org) at `/api/network-status` every 30 minutes.

## Render with a prebuilt image (alternative)

```bash
docker build -t ghcr.io/<you>/warden-web:latest .
docker push ghcr.io/<you>/warden-web:latest      # make the package public
```

Render → **New → Web Service → Deploy an existing image** → the URL above →
Free instance. Set the health-check path to `/api/network-status`.

## Live Preprod mode is not part of the free setup

`WARDEN_NETWORK=preprod` needs a funded server wallet, a private proof server and
a multi-hour first wallet sync, and Wave 2's new circuits need a **fresh contract
deployment** (the Wave 1 address has only three circuits). None of that fits a
free sleeping container. The full procedure is unchanged from Wave 1 and lives in
`docs/DEPLOYMENT.md`; build the image with `--build-arg WITH_PREPROD=1` to include
the proving keys.

### Live Preprod mode — what it needs (carried over from the Railway guide)

| Variable | Secret? | Value |
|---|---|---|
| `WARDEN_NETWORK` | no | `preprod` |
| `WARDEN_PREPROD_SEED` | **yes** | the server wallet's 32-byte hex seed — funded with tNight from the faucet |
| `WARDEN_CONTRACT_ADDRESS` | no | the deployed contract (Wave 1: `a61fb3417a82f6eff61e98e3ac50e759d916a86636f9ec25b9551375be8162bb`) |
| `WARDEN_PROOF_SERVER_URL` | no | a **private** URL for `midnightntwrk/proof-server:8.0.3` (port 6300) — never expose it publicly, it handles private data |

Mount persistent storage at `/app/apps/web/midnight-level-db` so a restart resumes
the wallet sync instead of repeating a multi-hour catch-up. The badge reads
`PREPROD · INITIALIZING` until the connection is genuinely ready.
