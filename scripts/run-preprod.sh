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
# Reuse the contract this machine already deployed (recorded in
# apps/web/.deployed-contract.json) so a restart never deploys a second one.
# Only when there is neither a configured address nor a record do we deploy.
if [ -z "${WARDEN_CONTRACT_ADDRESS:-}" ] && [ -f apps/web/.deployed-contract.json ]; then
  WARDEN_CONTRACT_ADDRESS="$(grep -o '"contractAddress": *"[0-9a-f]*"' apps/web/.deployed-contract.json | grep -oE '[0-9a-f]{64}')"
  export WARDEN_CONTRACT_ADDRESS
fi
if [ -n "${WARDEN_CONTRACT_ADDRESS:-}" ]; then
  export WARDEN_DEPLOY_CONTRACT=0
  echo "[run-preprod] using deployed contract ${WARDEN_CONTRACT_ADDRESS}"
else
  export WARDEN_DEPLOY_CONTRACT=1
  echo "[run-preprod] no contract recorded; will deploy a new one on first boot"
fi
export WARDEN_PROOF_SERVER_URL="${WARDEN_PROOF_SERVER_URL:-http://127.0.0.1:6300}"
export PORT="${PORT:-3100}"
[ -f apps/web/.next/BUILD_ID ] || npm run build --workspace apps/web
cd apps/web
# Restart automatically when the app exits with 75 (stalled sync after a
# sleep/disconnect); the wallet resumes from its snapshot each time. Mask the
# Blockfrost project id, which the RPC client logs inside URLs.
while true; do
  set +e
  npx next start 2>&1 | sed -u 's/project_id=[A-Za-z0-9]*/project_id=***/g'
  code=${PIPESTATUS[0]}
  set -e
  [ "$code" = "75" ] || exit "$code"
  echo "[run-preprod] restarting after stall"; sleep 3
done
