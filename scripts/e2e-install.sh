#!/usr/bin/env bash
# e2e-install: verify the bundle installs into an isolated dsh profile and
# appears in the dumped config tree.
set -euo pipefail
cd "$(dirname "$0")/.."

e2e_tmp_root="$PWD/.tmp-vitest"
mkdir -p "$e2e_tmp_root"
export DSH_HOME="$(mktemp -d "$e2e_tmp_root/dsh-dcp-e2e.XXXXXX")"
e2e_fake_home="$DSH_HOME/home"
e2e_xdg_config="$DSH_HOME/xdg-config"
e2e_xdg_data="$DSH_HOME/xdg-data"
e2e_xdg_state="$DSH_HOME/xdg-state"
mkdir -p "$e2e_fake_home" "$e2e_xdg_config" "$e2e_xdg_data" "$e2e_xdg_state"
trap 'rm -rf -- "$DSH_HOME"' EXIT
echo "DSH_HOME=$DSH_HOME"

expected_dsh_version="0.1.2-rc.1"
if ! command -v dsh >/dev/null 2>&1; then
  echo "e2e-install FAILED: dsh CLI not found" >&2
  exit 1
fi
actual_dsh_version="$(dsh --version 2>/dev/null)"
if [[ "$actual_dsh_version" != "$expected_dsh_version" ]]; then
  echo "e2e-install FAILED: expected dsh $expected_dsh_version, got ${actual_dsh_version:-missing}" >&2
  exit 1
fi

pnpm build

dsh plugin --profile headless add "$PWD"

set +e
CONFIG_OUTPUT="$(dsh --profile headless --dump-config 2>&1)"
CONFIG_STATUS=$?
set -e
if [[ "$CONFIG_STATUS" -ne 0 || "$CONFIG_OUTPUT" != *"@chiro2001/dsh-dcp"* ]]; then
  echo "e2e-install FAILED: dcp bundle missing from dumped config" >&2
  exit 1
fi

# Activating one real pre-step catches runtime API drift that dump-config cannot
# observe.  This isolated profile has no credentials, so reaching the provider's
# missing-credential error proves the plugin loaded and the pre-step completed.
set +e
BOOT_OUTPUT="$(
  cd "$DSH_HOME"
  env \
    -u DEEPSEEK_API_KEY \
    -u DEEPSEEK_BASE_URL \
    -u OPENAI_API_KEY \
    -u ANTHROPIC_API_KEY \
    -u GEMINI_API_KEY \
    -u GOOGLE_API_KEY \
    -u MISTRAL_API_KEY \
    -u OPENROUTER_API_KEY \
    -u OPENCODE_GO_API_KEY \
    HOME="$e2e_fake_home" \
    XDG_CONFIG_HOME="$e2e_xdg_config" \
    XDG_DATA_HOME="$e2e_xdg_data" \
    XDG_STATE_HOME="$e2e_xdg_state" \
    dsh --profile headless "dsh-dcp installed-artifact activation smoke" 2>&1
)"
BOOT_STATUS=$?
set -e

if [[ "$BOOT_STATUS" -eq 0 || "$BOOT_OUTPUT" != *"MISSING_CREDENTIAL"* ]]; then
  echo "e2e-install FAILED: installed plugin did not reach the expected provider boundary" >&2
  exit 1
fi

echo "e2e-install PASSED"
