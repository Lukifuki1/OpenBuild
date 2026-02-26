#!/usr/bin/env bash
# ============================================================================
# OpenHands (latest stable) — Avtomatski zagon za Ubuntu + Ollama + GPU
# Metoda: uv CLI launcher (uradno priporocena)
# ============================================================================
# Uporaba:
#   ./start.sh              — Preveri odvisnosti, nastavi in zazeni OpenHands
#   ./start.sh --stop       — Ustavi OpenHands
#   ./start.sh --clean      — Odstrani OpenHands, uv cache, state
#   ./start.sh --upgrade    — Posodobi OpenHands na najnovejso verzijo
# ============================================================================

set -euo pipefail

# ── Barve ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERR]${NC}   $*"; }
die()   { err "$*"; exit 1; }

# ── Konfiguracija ──
OPENHANDS_STATE_DIR="$HOME/.openhands"
WORKSPACE_DIR="$HOME/workspace"
OPENHANDS_PORT=3000

# Ollama konfiguracija
OLLAMA_MODEL="qwen3-coder:30b"
OLLAMA_MIN_CONTEXT=32768

# ── Ukazi ──
case "${1:-}" in
    --stop)
        info "Ustavljam OpenHands..."
        docker stop openhands-app 2>/dev/null && ok "Docker kontejner ustavljen" || true
        pkill -f "openhands serve" 2>/dev/null && ok "OpenHands process ustavljen" || warn "OpenHands process ni najden"
        exit 0
        ;;
    --clean)
        info "Cistim vse..."
        pkill -f "openhands serve" 2>/dev/null || true
        docker stop openhands-app 2>/dev/null || true; docker rm openhands-app 2>/dev/null || true
        uv tool uninstall openhands 2>/dev/null || true
        rm -rf "${OPENHANDS_STATE_DIR}"
        ok "Vse pocisceno. Workspace (${WORKSPACE_DIR}) ni izbrisan — pobrisi ga rocno ce zelis."
        exit 0
        ;;
    --upgrade)
        info "Posodabljam OpenHands..."
        if command -v uv &>/dev/null; then
            uv tool upgrade openhands --python 3.12
            ok "OpenHands posodobljen"
        else
            die "uv ni nameschen. Zazeni najprej ./start.sh za namestitev."
        fi
        exit 0
        ;;
    "")
        # Normalni zagon
        ;;
    *)
        die "Neznan ukaz: $1\nUporaba: ./start.sh [--stop|--clean|--upgrade]"
        ;;
esac

echo ""
echo "============================================================"
echo "  OpenHands — Avtomatski setup za Ubuntu + Ollama + GPU"
echo "============================================================"
echo ""

# ============================================================================
# KORAK 1: Preveri Docker
# ============================================================================
info "Korak 1/5: Preverjam Docker..."

if ! command -v docker &>/dev/null; then
    die "Docker ni nameschen. Namesti ga z: sudo apt install docker.io"
fi

if ! docker info &>/dev/null 2>&1; then
    die "Docker daemon ne tece ali nimas pravic. Poskusi:\n  sudo systemctl start docker\n  sudo usermod -aG docker \$USER  (nato se odjavi in prijavi)"
fi

ok "Docker deluje"

# ============================================================================
# KORAK 2: Preveri Ollama + GPU
# ============================================================================
info "Korak 2/5: Preverjam Ollama..."

if ! command -v ollama &>/dev/null; then
    die "Ollama ni namescena. Namesti jo z: curl -fsSL https://ollama.com/install.sh | sh"
fi

# Preveri ali Ollama server tece
if ! curl -sf http://localhost:11434/api/tags &>/dev/null; then
    warn "Ollama server ne tece. Zaganjam..."
    nohup ollama serve &>/dev/null &
    sleep 3
    if ! curl -sf http://localhost:11434/api/tags &>/dev/null; then
        die "Ollama server se ni zagnal. Zazeni ga rocno z: ollama serve"
    fi
    ok "Ollama server zagnan"
else
    ok "Ollama server tece"
fi

# Preveri ali model obstaja
if ! ollama list 2>/dev/null | grep -q "${OLLAMA_MODEL}"; then
    info "Model ${OLLAMA_MODEL} ni najden. Prenasam (to traja nekaj minut)..."
    ollama pull "${OLLAMA_MODEL}" || die "Neuspesno prenasanje modela ${OLLAMA_MODEL}"
    ok "Model ${OLLAMA_MODEL} prenesen"
else
    ok "Model ${OLLAMA_MODEL} je ze prenesen"
fi

# Preveri GPU
if command -v nvidia-smi &>/dev/null; then
    GPU_COUNT=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | wc -l)
    if [ "${GPU_COUNT}" -gt 0 ]; then
        ok "Zaznanih ${GPU_COUNT} NVIDIA GPU-jev"
        nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | while read -r line; do
            info "  GPU: ${line}"
        done
    else
        warn "NVIDIA GPU ni zaznan — Ollama bo uporabljala CPU"
    fi
else
    warn "nvidia-smi ni najden — Ollama bo morda uporabljala CPU"
fi

# ============================================================================
# KORAK 3: Namesti uv + OpenHands
# ============================================================================
info "Korak 3/5: Preverjam uv in OpenHands..."

# Dodaj uv v PATH
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

# Namesti uv ce ni nameschen
if ! command -v uv &>/dev/null; then
    info "Namescam uv (Python package manager)..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
    if ! command -v uv &>/dev/null; then
        die "uv namestitev neuspesna. Poskusi rocno: curl -LsSf https://astral.sh/uv/install.sh | sh"
    fi
    ok "uv nameschen"
else
    ok "uv ze nameschen ($(uv --version 2>/dev/null || echo 'unknown'))"
fi

# Namesti OpenHands ce ni nameschen
if ! uv tool list 2>/dev/null | grep -q "openhands"; then
    info "Namescam OpenHands (to traja nekaj minut prvic)..."
    uv tool install openhands --python 3.12 || die "OpenHands namestitev neuspesna"
    ok "OpenHands nameschen"
else
    ok "OpenHands ze nameschen"
fi

# Preveri da openhands ukaz obstaja
if ! command -v openhands &>/dev/null; then
    die "openhands ukaz ni najden v PATH. Poskusi: source ~/.bashrc ali znova odpri terminal"
fi

# ============================================================================
# KORAK 4: Pripravi direktorije
# ============================================================================
info "Korak 4/5: Pripravljam direktorije..."

mkdir -p "${OPENHANDS_STATE_DIR}"
mkdir -p "${WORKSPACE_DIR}"

ok "State dir: ${OPENHANDS_STATE_DIR}"
ok "Workspace: ${WORKSPACE_DIR}"

# ============================================================================
# KORAK 5: Zazeni OpenHands
# ============================================================================
info "Korak 5/5: Zaganjam OpenHands..."

# Ustavi stari Docker kontejner ce obstaja
docker stop openhands-app 2>/dev/null || true; docker rm openhands-app 2>/dev/null || true

echo ""
echo "============================================================"
ok "OpenHands se zaganja na http://localhost:${OPENHANDS_PORT}"
echo "============================================================"
echo ""
echo -e "  ${GREEN}UI:${NC}        http://localhost:${OPENHANDS_PORT}"
echo -e "  ${GREEN}Workspace:${NC} ${WORKSPACE_DIR}"
echo -e "  ${GREEN}Ustavi:${NC}    CTRL+C"
echo ""
echo "============================================================"
echo -e "  ${YELLOW}NASTAVITVE (prvic v UI):${NC}"
echo "  1. Odpri http://localhost:${OPENHANDS_PORT}"
echo "  2. Klikni Settings (zobnik ikona)"
echo "  3. Vklopi 'Advanced' stikalo"
echo "  4. Nastavi:"
echo -e "     ${BLUE}Custom Model:${NC}  openai/${OLLAMA_MODEL}"
echo -e "     ${BLUE}Base URL:${NC}      http://localhost:11434/v1"
echo -e "     ${BLUE}API Key:${NC}       dummy"
echo "  5. Shrani nastavitve"
echo "============================================================"
echo ""
echo -e "  ${YELLOW}POMEMBNO: Ollama mora teci z vecjim kontekstom!${NC}"
echo "  Ce agent ne deluje pravilno, ustavi Ollamo in jo znova zazeni:"
echo "  sudo systemctl stop ollama"
echo "  OLLAMA_CONTEXT_LENGTH=${OLLAMA_MIN_CONTEXT} OLLAMA_HOST=0.0.0.0:11434 OLLAMA_KEEP_ALIVE=-1 ollama serve"
echo ""
echo "============================================================"
echo ""

# Zazeni OpenHands v foreground-u (CTRL+C za ustavitev)
exec openhands serve --port "${OPENHANDS_PORT}"
