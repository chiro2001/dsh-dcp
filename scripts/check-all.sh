#!/usr/bin/env bash
# One-shot quality gate: typecheck, lint, tests, build, package check, perf smoke,
# optionally coverage and e2e. Any failure stops the run.
set -euo pipefail
cd "$(dirname "$0")/.."

COVERAGE=0
E2E=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --coverage) COVERAGE=1; shift ;;
    --e2e) E2E=1; shift ;;
    *) shift ;;
  esac
done

echo "== typecheck =="
pnpm typecheck

echo "== lint =="
pnpm lint

echo "== unit + contract + integration tests =="
pnpm test

echo "== build =="
pnpm build

echo "== package check =="
pnpm check:package

echo "== perf smoke =="
pnpm perf-smoke

if [[ "$COVERAGE" == "1" ]]; then
  echo "== coverage =="
  pnpm vitest run --coverage
fi

if [[ "$E2E" == "1" ]]; then
  echo "== e2e (not implemented yet) =="
fi

echo "check-all: PASSED"
