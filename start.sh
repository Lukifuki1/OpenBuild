#!/usr/bin/env bash
set -euo pipefail

# OpenHands v1.5.0 (source) — host-native run
# - UI port: 3000
# - LM Studio port: 1234
# - Docker used only for sandbox/runtime containers

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*"; }
die()  { err "$*"; exit 1; }

# ── Configuration ──────────────────────────────────────────────
OPENHANDS_PORT=3000
LMSTUDIO_PORT=1234
LMSTUDIO_MODEL="qwen3.5-35b-a3b-uncensored-hauhaucs-aggressive"
WORKSPACE_DIR="$HOME/workspace"
OPENHANDS_CONFIG_DIR="$HOME/.openhands"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export PATH="$HOME/.local/bin:$PATH"

# ── Cleanup on exit ───────────────────────────────────────────
cleanup() {
  local code=$?
  if [ $code -ne 0 ]; then
    warn "start.sh koncal z napako (koda: $code)"
  fi
}
trap cleanup EXIT

echo ""
echo "============================================"
echo "   OpenHands v1.5.0 — host-native setup"
echo "============================================"
echo ""

# ── Step 1: Docker ─────────────────────────────────────────────
info "Korak 1/6: Preverjam Docker..."
if ! command -v docker >/dev/null 2>&1; then
  die "Docker ni namescen. Namesti ga z: sudo apt-get update && sudo apt-get install -y docker.io"
fi
if ! docker info >/dev/null 2>&1; then
  die "Docker daemon ne tece ali nimas pravic. Poskusi: sudo systemctl start docker; sudo usermod -aG docker \$USER (nato logout/login)"
fi
ok "Docker deluje"

# ── Step 2: LM Studio ────────────────────────────────────────────
info "Korak 2/6: Preverjam LM Studio..."

# LM Studio must be running with OpenAI-compatible server enabled
# Check if LM Studio API is accessible
if ! curl -sf "http://localhost:${LMSTUDIO_PORT}/v1/models" >/dev/null 2>&1; then
  die "LM Studio server ne tece na portu ${LMSTUDIO_PORT}. Zagnaj LM Studio in omogoci 'Enable API' (v Settings > App > Advanced)."
fi
ok "LM Studio server tece na portu ${LMSTUDIO_PORT}"

# Note: We don't check/load models here - LM Studio handles that independently
# Just verify the server is running and will accept connections

# ── Step 3: Frontend ───────────────────────────────────────────
info "Korak 3/6: Preverjam Node.js + gradim frontend..."
if ! command -v npm >/dev/null 2>&1; then
  die "npm ni namescen. Namesti Node.js 22+ (npr. preko nvm)"
fi

# Always reinstall node_modules to ensure fresh dependencies
info "frontend: npm install (clean install)..."
(cd frontend && rm -rf node_modules && npm install)

# Always rebuild the frontend from a clean state.
# The i18n locale files (public/locales/) are generated at build time by
# make-i18n and are git-ignored.  If we skip the build or reuse a stale
# build/ directory, the UI shows raw translation keys (e.g. SETTINGS$TITLE)
# instead of human-readable text.
info "frontend: cistim star build/ ..."
rm -rf frontend/build
info "frontend: npm run build..."
(cd frontend && npm run build)

# Sanity check: verify locale files were generated
if [ ! -f frontend/build/locales/en/translation.json ]; then
  die "Frontend build NI ustvaril locale datotek! Preveri npm run make-i18n."
fi
ok "frontend: build pripravljen (locales OK)"

# ── Step 4: Poetry + Python deps ──────────────────────────────
info "Korak 4/6: Preverjam Poetry + Python odvisnosti..."
if ! command -v python3.12 >/dev/null 2>&1; then
  die "python3.12 ni najden. Na Ubuntu 24.04: sudo apt-get install -y python3.12 python3.12-venv"
fi

if ! command -v pipx >/dev/null 2>&1; then
  info "pipx ni namescen. Namescam (zahteva sudo)..."
  sudo apt-get update && sudo apt-get install -y pipx
  pipx ensurepath || true
  export PATH="$HOME/.local/bin:$PATH"
fi

if ! command -v poetry >/dev/null 2>&1; then
  info "poetry ni namescen. Namescam..."
  pipx install poetry
fi
ok "Poetry: $(poetry --version 2>/dev/null || echo unknown)"

export POETRY_VIRTUALENVS_IN_PROJECT=true

if [ ! -d .venv ]; then
  info "poetry install (prvic — traja nekaj minut)..."
  poetry install --no-interaction
else
  ok "Python venv (.venv) ze obstaja"
fi

# ── Step 5: Environment ───────────────────────────────────────
info "Korak 5/6: Nastavljam LLM nastavitve za LM Studio..."
mkdir -p "${OPENHANDS_CONFIG_DIR}" "${WORKSPACE_DIR}"
mkdir -p "${WORKSPACE_DIR}/conversations" "${WORKSPACE_DIR}/bash_events" "${WORKSPACE_DIR}/project"
# Some dirs may be owned by root from previous Docker runs — use sudo as fallback
for d in "${WORKSPACE_DIR}" "${WORKSPACE_DIR}/conversations" "${WORKSPACE_DIR}/bash_events" "${WORKSPACE_DIR}/project"; do
  chmod 777 "$d" 2>/dev/null || sudo chmod 777 "$d"
done

# Use the openai/ provider prefix with LM Studio's OpenAI-compatible endpoint.
# LM Studio exposes /v1/chat/completions which fully supports function calling
# (tool calls) with properly structured JSON arguments.
export LLM_API_KEY="dummy"
export LLM_MODEL="openai/${LMSTUDIO_MODEL}"
export LLM_BASE_URL="http://localhost:${LMSTUDIO_PORT}/v1"
export SANDBOX_VOLUMES="${WORKSPACE_DIR}:/workspace:rw"

# Disable browser tools for local models.
# Local models (like qwen3.5) cannot handle native function calling
# when the tool count exceeds ~5.  The default tool set includes ~13 browser
# sub-tools (navigate, click, type, scroll, …) which pushes the total to 19.
# With browser disabled the agent keeps terminal + file_editor + task_tracker
# (3 tools), well within the model's limit.
export OH_ENABLE_BROWSER=false

# Also disable MCP tools (create_pr, create_mr, create_bitbucket_pr,
# create_azure_devops_pr) which the default OpenHands MCP server adds.
# These 4 extra tools push the total from 5 to 9, still above the ~5
# threshold for local models.  With MCP disabled the agent has exactly
# 5 tools: terminal, file_editor, task_tracker, finish, think.
export OH_ENABLE_MCP=false

# Disable native (API-parameter) tool calling.  With native FC the SDK
# sends tools via the `tools` JSON parameter; local models may ignore this
# and just output free text ("Thinking…") without ever invoking a tool.
#
# When native FC is OFF the SDK uses "prompt-mocked" tool calling:
#   1. Tool schemas + in-context usage examples are injected directly
#      into the system prompt as plain text.
#   2. The model outputs text containing <function=terminal>…</function>
#      tags (format it already understands from its training data).
#   3. The SDK parses those tags back into structured tool calls.
#
# This prompt-based approach works reliably with local models that
# cannot handle the OpenAI-style `tools` API parameter.
export LLM_NATIVE_TOOL_CALLING=false

# Write a fresh settings.json so the OpenHands server has the correct
# LLM configuration from the very first request.  Without this file the
# GET /api/settings endpoint returns 404, the frontend shows a blank
# "AI Provider Configuration" dialog, and conversations start with no
# LLM — resulting in Connection refused / ReadTimeout errors.
SETTINGS_FILE="${OPENHANDS_CONFIG_DIR}/settings.json"
info "Zapisujem nastavitve v ${SETTINGS_FILE} ..."
cat > "${SETTINGS_FILE}" <<SETTINGS_EOF
{
  "language": "en",
  "agent": "CodeActAgent",
  "max_iterations": 100,
  "llm_model": "${LLM_MODEL}",
  "llm_api_key": "${LLM_API_KEY}",
  "llm_base_url": "${LLM_BASE_URL}",
  "v1_enabled": true,
  "enable_default_condenser": true
}
SETTINGS_EOF
ok "Nastavitve zapisane (${SETTINGS_FILE})"

ok "LLM_MODEL=${LLM_MODEL}"
ok "LLM_BASE_URL=${LLM_BASE_URL}"
ok "SANDBOX_VOLUMES=${SANDBOX_VOLUMES}"

# ── Step 6: Launch ────────────────────────────────────────────
info "Korak 6/6: Zaganjam OpenHands server (uvicorn) na portu ${OPENHANDS_PORT}..."
echo ""
echo "============================================"
ok "UI: http://localhost:${OPENHANDS_PORT}"
echo "============================================"
echo ""
echo "OpenHands tece na hostu. Docker se uporablja samo za sandbox/runtime."
echo "Ustavi: CTRL+C"
echo ""

exec poetry run uvicorn openhands.server.listen:app --host 0.0.0.0 --port "${OPENHANDS_PORT}"
