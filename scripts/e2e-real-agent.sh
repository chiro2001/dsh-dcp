#!/usr/bin/env bash
# Real-agent e2e: isolated DSH_HOME + real LLM (opencode go / deepseek-v4-flash).
# Keys are sourced from ~/litellm/.env and never printed or committed.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f "$HOME/litellm/.env" ]]; then
  echo "e2e-real-agent: $HOME/litellm/.env not found; skipping" >&2
  exit 0
fi

set -a
source "$HOME/litellm/.env"
set +a

if [[ -z "${OPENCODE_GO_API_KEY:-}" ]]; then
  echo "e2e-real-agent: OPENCODE_GO_API_KEY missing; skipping" >&2
  exit 0
fi

export DSH_DCP_REAL_MODEL=1
export DSH_DCP_LLM_BASE_URL="${DSH_DCP_LLM_BASE_URL:-https://opencode.ai/zen/go/v1}"
export DSH_DCP_LLM_MODEL="${DSH_DCP_LLM_MODEL:-deepseek-v4-flash}"
mkdir -p .tmp-vitest
export TMPDIR="$PWD/.tmp-vitest"

pnpm vitest run tests/e2e-real --reporter=verbose
