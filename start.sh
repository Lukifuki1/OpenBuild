#!/usr/bin/env bash
set -euo pipefail

# OpenHands v1.3.0 (source) — host-native run
# - UI port: 3000
# - Ollama port: 11434
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
OLLAMA_PORT=11434
OLLAMA_MODEL="qwen3-coder:30b"
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
echo "   OpenHands v1.3.0 — host-native setup"
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

# ── Step 2: Ollama ─────────────────────────────────────────────
info "Korak 2/6: Preverjam Ollama..."
if ! command -v ollama >/dev/null 2>&1; then
  info "Ollama ni namescena. Namescam..."
  curl -fsSL https://ollama.com/install.sh | sh || die "Ollama namestitev neuspesna"
fi

# Ollama must listen on 0.0.0.0 (all interfaces) so that Docker sandbox
# containers can reach it via host.docker.internal.  By default Ollama
# only binds to 127.0.0.1 which is unreachable from Docker bridge
# networks, causing "Connection refused" errors in the agent.
export OLLAMA_HOST="0.0.0.0:${OLLAMA_PORT}"

# Check if Ollama is already running and reachable
OLLAMA_RUNNING=false
if curl -sf "http://localhost:${OLLAMA_PORT}/api/tags" >/dev/null 2>&1; then
  OLLAMA_RUNNING=true
fi

# If Ollama is running, check whether it is listening on 0.0.0.0.
# If it only listens on 127.0.0.1 we must restart it so Docker
# containers can connect.
if $OLLAMA_RUNNING; then
  if ! ss -tlnp 2>/dev/null | grep ":${OLLAMA_PORT}" | grep -q '0\.0\.0\.0'; then
    warn "Ollama poslusa samo na 127.0.0.1. Ponovno zaganjam na 0.0.0.0..."
    # Try to stop the existing Ollama gracefully
    pkill -f 'ollama serve' 2>/dev/null || true
    sleep 2
    OLLAMA_RUNNING=false
  fi
fi

if ! $OLLAMA_RUNNING; then
  warn "Ollama server ne tece (ali ni na 0.0.0.0). Zaganjam (background)..."
  # Use setsid to fully detach Ollama from this shell session so Ctrl+C
  # (which stops OpenHands) does NOT kill Ollama.
  setsid ollama serve </dev/null >/dev/null 2>&1 &
  sleep 3
  if ! curl -sf "http://localhost:${OLLAMA_PORT}/api/tags" >/dev/null 2>&1; then
    die "Ollama server se ni zagnal. Zazeni rocno: OLLAMA_HOST=0.0.0.0 ollama serve"
  fi
fi
ok "Ollama server tece na portu ${OLLAMA_PORT} (0.0.0.0)"

if ! ollama list 2>/dev/null | awk '{print $1}' | grep -q "${OLLAMA_MODEL}"; then
  info "Model ${OLLAMA_MODEL} ni najden. Prenasam (to lahko traja)..."
  ollama pull "${OLLAMA_MODEL}" || die "Neuspesno prenasanje modela ${OLLAMA_MODEL}"
  ok "Model ${OLLAMA_MODEL} prenesen"
else
  ok "Model ${OLLAMA_MODEL} je ze prenesen"
fi

# ── Step 3: Frontend ───────────────────────────────────────────
info "Korak 3/6: Preverjam Node.js + gradim frontend..."
if ! command -v npm >/dev/null 2>&1; then
  die "npm ni namescen. Namesti Node.js 22+ (npr. preko nvm)"
fi

if [ ! -d frontend/node_modules ]; then
  info "frontend: npm install..."
  (cd frontend && npm install)
else
  ok "frontend: node_modules ze obstaja"
fi

# Always rebuild the frontend from a clean state.
# The i18n locale files (public/locales/) are generated at build time by
# make-i18n and are git-ignored.  If we skip the build or reuse a stale
# build/ directory, the UI shows raw translation keys (e.g. SETTINGS$TITLE)
# instead of human-readable text.
if [ -d frontend/build ]; then
  info "frontend: cistim star build/ ..."
  rm -rf frontend/build
fi
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
info "Korak 5/6: Nastavljam LLM nastavitve za Ollama..."
mkdir -p "${OPENHANDS_CONFIG_DIR}" "${WORKSPACE_DIR}"
mkdir -p "${WORKSPACE_DIR}/conversations" "${WORKSPACE_DIR}/bash_events" "${WORKSPACE_DIR}/project"
# Some dirs may be owned by root from previous Docker runs — use sudo as fallback
for d in "${WORKSPACE_DIR}" "${WORKSPACE_DIR}/conversations" "${WORKSPACE_DIR}/bash_events" "${WORKSPACE_DIR}/project"; do
  chmod 777 "$d" 2>/dev/null || sudo chmod 777 "$d"
done

# Use the ollama_chat/ provider prefix so litellm routes requests to
# Ollama's /api/chat endpoint which supports function calling (tool calls).
# The plain ollama/ prefix uses /api/generate which does NOT support
# structured tool calls — the model returns arguments as plain strings
# instead of JSON dicts, causing 'str' object has no attribute 'pop'
# errors in the agent SDK.
# The base URL points directly at Ollama (no /v1 suffix).
export LLM_API_KEY="dummy"
export LLM_MODEL="ollama_chat/${OLLAMA_MODEL}"
export LLM_BASE_URL="http://localhost:${OLLAMA_PORT}"
export SANDBOX_VOLUMES="${WORKSPACE_DIR}:/workspace:rw"

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
