#!/usr/bin/env bash
# Starts apps/web against Midnight Preprod, deploying the contract on first
# boot if no WARDEN_CONTRACT_ADDRESS is set. Safe to re-run at any time: the
# wallet resumes from apps/web/.wallet-snapshot.json instead of re-syncing.
#   ./scripts/run-preprod.sh
# Needs WARDEN_PREPROD_SEED and BLOCKFROST_PROJECT_ID in ./.env (gitignored)
# and a proof server on :6300 (override with WARDEN_PROOF_SERVER_URL).
set -euo pipefail
cd "$(dirname "$0")/.."
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null
set -a; . ./.env; set +a
export WARDEN_NETWORK=preprod
export WARDEN_DEPLOY_CONTRACT="${WARDEN_DEPLOY_CONTRACT:-1}"
export WARDEN_PROOF_SERVER_URL="${WARDEN_PROOF_SERVER_URL:-http://127.0.0.1:6300}"
export PORT="${PORT:-3100}"
[ -f apps/web/.next/BUILD_ID ] || npm run build --workspace apps/web
cd apps/web
# Mask the Blockfrost project id, which the RPC client logs inside URLs.
exec npx next start 2>&1 | sed -u 's/project_id=[A-Za-z0-9]*/project_id=***/g'
