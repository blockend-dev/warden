# One image for every host: Hugging Face Spaces (free), Render, Fly, Railway,
# or a plain VPS. Runs `apps/web` as ONE persistent Node process — required,
# not optional, because the demo session store lives in server memory (see
# apps/web/src/lib/demo-session.ts) and does not survive being split across
# serverless invocations or multiple replicas. Keep the replica count at 1.
#
#   docker build -t warden-web .
#   docker run -p 7860:7860 warden-web          # → http://localhost:7860
#
# Build args
#   WITH_PREPROD=0 (default)  skip ZK proving-key generation for the live
#                             Preprod bundle: the app runs on the in-process
#                             simulator, builds in ~6 minutes and needs no
#                             secrets. This is the free-hosting configuration.
#   WITH_PREPROD=1            generate the full proving keys so the container
#                             can run with WARDEN_NETWORK=preprod (adds ~15
#                             minutes; needs a funded wallet seed and a proof
#                             server — see docs/DEPLOY-FREE.md).
FROM node:24-bookworm

ARG WITH_PREPROD=0
WORKDIR /app

# The Compact compiler is a native toolchain, installed the same way
# README.md §11 documents for local setup. Versions are pinned EXPLICITLY:
# a bare `compact update` installs whatever is newest, and the scripts below
# invoke `compact compile +0.34.0` / `+0.31.1`, which fail on a machine that
# has never installed that exact version.
RUN curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
ENV PATH="/root/.local/bin:${PATH}"
RUN compact update 0.34.0 && compact update 0.31.1 --no-set-default

COPY . .

RUN npm install --legacy-peer-deps

# Compile the contract (the simulator only needs the generated JS, not the ZK
# keys, so skip key generation), then build every workspace package apps/web
# depends on, in dependency order.
RUN npm run compact:fast --workspace packages/contracts
RUN npm run build --workspace packages/contracts
RUN npm run build --workspace packages/shared
RUN npm run build --workspace packages/sdk
RUN npm run build --workspace packages/agent-adapter

# apps/web's live-Preprod backend needs the SAME warden.compact source
# recompiled with the older 0.31.1 compiler to match the stable
# midnight-js@4.1.1 line — see docs/DEPLOYMENT.md. Always generated (the
# module is imported at server start); only the heavyweight proving keys are
# conditional.
RUN if [ "$WITH_PREPROD" = "1" ]; then \
      npm run compact:legacy --workspace apps/web; \
    else \
      npm run compact:legacy:fast --workspace apps/web; \
    fi

RUN npm run build --workspace apps/web

# Hosts like Hugging Face Spaces run containers as uid 1000 (the base image's
# `node` user). The server writes only under /app (Next cache, wallet LevelDB).
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=7860
# 7860 is Hugging Face's default; Railway/Render/Fly inject their own $PORT.
EXPOSE 7860
CMD ["npm", "run", "start", "--workspace", "apps/web"]
