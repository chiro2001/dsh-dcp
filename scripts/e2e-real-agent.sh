#!/usr/bin/env bash
# Real-agent e2e: isolated DSH_HOME + explicitly configured real LLM.
# Node loads ~/litellm/.env in memory; existing environment values take priority.
set -euo pipefail
cd "$(dirname "$0")/.."

export DSH_DCP_REAL_MODEL=1
mkdir -p .tmp-vitest
export TMPDIR="$PWD/.tmp-vitest"

node --env-file-if-exists="$HOME/litellm/.env" node_modules/vitest/vitest.mjs run tests/e2e-real --reporter=verbose
