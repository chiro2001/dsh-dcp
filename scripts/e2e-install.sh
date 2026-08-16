#!/usr/bin/env bash
# e2e-install: verify the bundle installs into an isolated dsh profile and
# appears in the dumped config tree.
set -euo pipefail
cd "$(dirname "$0")/.."

export DSH_HOME="$(mktemp -d)"
echo "DSH_HOME=$DSH_HOME"

pnpm build

dsh plugin --profile e2e add "$PWD"

if ! dsh --profile e2e --dump-config 2>&1 | grep -q "@chiro2001/dsh-dcp"; then
  echo "e2e-install FAILED: dcp bundle missing from dumped config" >&2
  exit 1
fi

echo "e2e-install PASSED"

