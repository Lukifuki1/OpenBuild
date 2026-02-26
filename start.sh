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

OPENHANDS_PORT=3000
OLLAMA_PORT=11434
OLLAMA_MODEL="qwen3-coder:30b"
WORKSPACE_DIR="$HOME/workspace"
OPENHANDS_CONFIG_DIR="$HOME/.openhands"

# Ensure ~/.local/bin on PATH (pipx/poetry)
export PATH="$HOME/.local/bin:$PATH"

usage() {
  cat <<EOF
Uporaba:
  ./start.sh            Namesti manjkajoce, konfigurira in zazene OpenHands (UI na :${OPENHANDS_PORT})
  ./start.sh --stop     Ustavi OpenHands (uvicorn)
  ./start.sh --clean    Pobrise lokalne build cache (.venv, frontend build/node_modules)
EOF
}

case "${1:-}" in
  --stop)
    info "Ustavljam OpenHands (uvicorn)..."
    pkill -f "uvicorn openhands.server.listen:app" 2>/dev/null || true
    ok "Stop signal poslan (ce je bil proces najden)"
    exit 0
    ;;
  --clean)
    info "Cistim lokalne cache direktorije..."
    rm -rf .venv 2>/dev/null || true
    rm -rf frontend/node_modules 2>/dev/null || true
    rm -rf frontend/build 2>/dev/null || true
    ok "Pocisceno. (Workspace: ${WORKSPACE_DIR} ni izbrisan)"
    exit 0
    ;;
  "")
    ;;
  *)
    usage
    exit 1
    ;;
esac

echo ""
echo "============================================================"
echo "  OpenHands v1.3.0 — host-native setup (Docker samo za sandbox)"
echo "============================================================"
echo ""

# 1) Docker (sandbox/runtime)
info "Korak 1/6: Preverjam Docker..."
if ! command -v docker >/dev/null 2>&1; then
  die "Docker ni namescen. Namesti ga z: sudo apt-get update && sudo apt-get install -y docker.io"
fi
if ! docker info >/dev/null 2>&1; then
  die "Docker daemon ne tece ali nimas pravic. Poskusi: sudo systemctl start docker; sudo usermod -aG docker $USER (nato logout/login)"
fi
ok "Docker deluje"

# 2) Ollama
info "Korak 2/6: Preverjam Ollama..."
if ! command -v ollama >/dev/null 2>&1; then
  info "Ollama ni namescena. Namescam..."
  curl -fsSL https://ollama.com/install.sh | sh || die "Ollama namestitev neuspesna"
fi

if ! curl -sf "http://localhost:${OLLAMA_PORT}/api/tags" >/dev/null 2>&1; then
  warn "Ollama server ne tece. Zaganjam (background)..."
  nohup ollama serve >/dev/null 2>&1 &
  sleep 3
  if ! curl -sf "http://localhost:${OLLAMA_PORT}/api/tags" >/dev/null 2>&1; then
    die "Ollama server se ni zagnal. Zazeni rocno: ollama serve"
  fi
fi
ok "Ollama server tece"

if ! ollama list 2>/dev/null | awk '{print $1}' | grep -q "${OLLAMA_MODEL}"; then
  info "Model ${OLLAMA_MODEL} ni najden. Prenasam..."
  ollama pull "${OLLAMA_MODEL}" || die "Neuspesno prenasanje modela ${OLLAMA_MODEL}"
  ok "Model ${OLLAMA_MODEL} prenesen"
else
  ok "Model ${OLLAMA_MODEL} je ze prenesen"
fi

# 3) Node / build frontend
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

if [ ! -d frontend/build ]; then
  info "frontend: npm run build..."
  (cd frontend && npm run build)
else
  ok "frontend: build ze obstaja"
fi

# 4) Poetry + Python deps
info "Korak 4/6: Preverjam Poetry + Python odvisnosti..."
if ! command -v python3.12 >/dev/null 2>&1; then
  die "python3.12 ni najden. Na Ubuntu 24.04 je obicajno prisoten. Ce ni: sudo apt-get install -y python3.12 python3.12-venv"
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
  info "poetry install (prvic)..."
  poetry install --no-interaction
else
  ok "Python venv (.venv) ze obstaja"
fi

# 5) Konfiguracija (env vars)
info "Korak 5/6: Nastavljam privzete LLM nastavitve za Ollama..."
mkdir -p "${OPENHANDS_CONFIG_DIR}" "${WORKSPACE_DIR}"
mkdir -p "${WORKSPACE_DIR}/conversations" "${WORKSPACE_DIR}/bash_events" "${WORKSPACE_DIR}/project"
chmod 777 "${WORKSPACE_DIR}" "${WORKSPACE_DIR}/conversations" "${WORKSPACE_DIR}/bash_events" "${WORKSPACE_DIR}/project"

export LLM_API_KEY="dummy"
export LLM_MODEL="openai/${OLLAMA_MODEL}"
export LLM_BASE_URL="http://localhost:${OLLAMA_PORT}/v1"
export SANDBOX_VOLUMES="${WORKSPACE_DIR}:/workspace:rw"

ok "LLM_MODEL=${LLM_MODEL}"
ok "LLM_BASE_URL=${LLM_BASE_URL}"
ok "SANDBOX_VOLUMES=${SANDBOX_VOLUMES}"

# 6) Run server
info "Korak 6/6: Zaganjam OpenHands server (uvicorn) na port ${OPENHANDS_PORT}..."
echo ""
echo "============================================================"
ok "UI: http://localhost:${OPENHANDS_PORT}"
echo "============================================================"
echo ""
echo "POMEMBNO: OpenHands tece na hostu. Docker se uporablja samo za sandbox/runtime."
echo "Ustavi: CTRL+C (ali ./start.sh --stop)"
echo ""

exec poetry run uvicorn openhands.server.listen:app --host 0.0.0.0 --port "${OPENHANDS_PORT}"
