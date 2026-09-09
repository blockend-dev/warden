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
RUN npm run build --workspace apps/web

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "apps/web"]
