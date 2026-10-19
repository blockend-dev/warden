#!/usr/bin/env bash
# Publishes this repository to a free Hugging Face Space (Docker SDK), which
# builds the root Dockerfile and serves apps/web on port 7860.
#
#   HF_USER=you HF_SPACE=warden HF_TOKEN=hf_xxx ./scripts/deploy-huggingface.sh
#
# Prerequisites: a (free) Hugging Face account, a write-scoped access token
# (https://huggingface.co/settings/tokens) and an EMPTY Space created with
# SDK = Docker (https://huggingface.co/new-space). Nothing is pushed anywhere
# else; the token is used only for this one git push and never written to disk.
set -euo pipefail

: "${HF_USER:?set HF_USER to your Hugging Face username}"
: "${HF_SPACE:=warden}"
: "${HF_TOKEN:?set HF_TOKEN to a write-scoped token}"

root="$(git rev-parse --show-toplevel)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# A Space reads its config from YAML front matter at the top of README.md.
# Prepend it to a COPY so the GitHub README stays clean.
git -C "$root" archive HEAD | tar -x -C "$work"
{
  cat <<'FRONT'
---
title: Warden
emoji: 🛡️
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
short_description: Private mandates and delegation for AI agents on Midnight
---

FRONT
  cat "$work/README.md"
} > "$work/README.hf.md"
mv "$work/README.hf.md" "$work/README.md"

cd "$work"
git init -q -b main
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-warden-deploy}" -c user.email="${GIT_AUTHOR_EMAIL:-deploy@example.invalid}" \
  commit -q -m "deploy $(git -C "$root" rev-parse --short HEAD)"
git push -f "https://${HF_USER}:${HF_TOKEN}@huggingface.co/spaces/${HF_USER}/${HF_SPACE}" main

echo
echo "Pushed. The Space now builds (about 6-10 minutes the first time)."
echo "Live URL: https://${HF_USER}-${HF_SPACE}.hf.space"
