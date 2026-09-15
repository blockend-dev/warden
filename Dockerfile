# Single-stage, deliberately: this repo's build needs the native Compact
# compiler (not an npm package) plus several workspace packages built in
# order before `next build` can run, and a hackathon deployment favors
# "reliably works" over image size. Runs `apps/web` as one persistent
# process — required, not optional, because its demo session store lives
# in server memory (see apps/web/src/lib/demo-session.ts) and does not
# survive being split across serverless invocations or multiple replicas.
# Keep Railway's replica count at 1 for this service.
FROM node:24-bookworm

WORKDIR /app

# The Compact compiler is a native toolchain, installed the same way
# README.md §0 documents for local setup.
RUN curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
ENV PATH="/root/.local/bin:${PATH}"
RUN compact update

COPY . .

RUN npm install --legacy-peer-deps

# Compile the contract, then build every workspace package apps/web depends
# on, in dependency order — mirrors README.md §0 exactly.
RUN npm run compact
RUN npm run build --workspace packages/contracts
RUN npm run build --workspace packages/shared
RUN npm run build --workspace packages/sdk
RUN npm run build --workspace packages/agent-adapter

# apps/web's live-Preprod backend needs the SAME warden.compact source
# recompiled with an older Compact compiler (0.31.1) to match the stable
# midnight-js line it uses — see docs/DEPLOYMENT.md and
# apps/web/src/server/preprod/preprod-network.ts. Unlike `compact update`
# (no version pinned), `compact compile +0.31.1` does NOT fetch a missing
# toolchain on demand — it fails outright on a fresh machine that has never
# installed that exact version. `--no-set-default` installs it alongside
# 0.34.0 without changing which one plain `compact compile` (no `+version`)
# resolves to elsewhere in this build (packages/contracts' own script pins
# `+0.34.0` explicitly too, but this keeps the ambient default honest
# regardless). This step runs even when WARDEN_NETWORK isn't "preprod" —
# the compiled output goes unused in that case, but harmless to have built.
RUN compact update 0.31.1 --no-set-default
RUN npm run compact:legacy --workspace apps/web

RUN npm run build --workspace apps/web

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "apps/web"]
