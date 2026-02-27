#!/usr/bin/env bash
# ============================================================================
# OpenHands v1.3.0 — Avtomatski zagon za Ubuntu + Ollama + GPU
# ============================================================================
# Uporaba:
#   ./start.sh              — Preveri odvisnosti, nastavi in zazeni OpenHands
#   ./start.sh --stop       — Ustavi OpenHands kontejner
#   ./start.sh --status     — Preveri status kontejnerja
#   ./start.sh --clean      — Ustavi in odstrani vse (image, state, workspace)
#   ./start.sh --pull       — Prisili ponovni pull Docker image-a
#   ./start.sh --logs       — Prikazi loge kontejnerja
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
OPENHANDS_VERSION="1.3"
OPENHANDS_IMAGE="docker.openhands.dev/openhands/openhands:${OPENHANDS_VERSION}"
OPENHANDS_IMAGE_FALLBACK="ghcr.io/openhands/openhands:${OPENHANDS_VERSION}"
CONTAINER_NAME="openhands-app"
OPENHANDS_STATE_DIR="$HOME/.openhands"
WORKSPACE_DIR="$HOME/workspace"
OPENHANDS_PORT=3000

# Ollama konfiguracija
OLLAMA_MODEL="qwen3.5:35b-agent"
OLLAMA_HOST_URL="http://host.docker.internal:11434"
# V OpenHands UI se model nastavi kot: openai/qwen3.5:35b-agent
# Base URL: http://host.docker.internal:11434/v1
# API Key: dummy (katerakoli vrednost)

# ── Pomocne funkcije ──
container_running() {
    docker ps --filter "name=${CONTAINER_NAME}" --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"
}

container_exists() {
    docker ps -a --filter "name=${CONTAINER_NAME}" --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"
}

image_exists() {
    docker image inspect "$1" &>/dev/null
}

stop_container() {
    if container_running; then
        info "Ustavljam OpenHands kontejner..."
        docker stop "${CONTAINER_NAME}" >/dev/null 2>&1
        ok "Kontejner ustavljen"
    fi
    if container_exists; then
        docker rm "${CONTAINER_NAME}" >/dev/null 2>&1
    fi
}

# ── Ukazi ──
case "${1:-}" in
    --stop)
        stop_container
        exit 0
        ;;
    --status)
        if container_running; then
            ok "OpenHands tece na http://localhost:${OPENHANDS_PORT}"
            docker ps --filter "name=${CONTAINER_NAME}" --format 'table {{.Status}}\t{{.Ports}}'
        else
            warn "OpenHands ne tece"
        fi
        exit 0
        ;;
    --clean)
        stop_container
        info "Brisem Docker image..."
        docker rmi "${OPENHANDS_IMAGE}" 2>/dev/null || true
        docker rmi "${OPENHANDS_IMAGE_FALLBACK}" 2>/dev/null || true
        info "Brisem state direktorij (${OPENHANDS_STATE_DIR})..."
        rm -rf "${OPENHANDS_STATE_DIR}"
        ok "Vse pocisceno. Workspace (${WORKSPACE_DIR}) ni izbrisan — pobrisi ga rocno ce zelis."
        exit 0
        ;;
    --pull)
        info "Prisiljujem ponovni pull Docker image-a..."
        FORCE_PULL=1
        ;;
    --logs)
        if container_exists; then
            docker logs -f "${CONTAINER_NAME}"
        else
            die "Kontejner ne obstaja. Zazeni najprej z ./start.sh"
        fi
        exit 0
        ;;
    "")
        # Normalni zagon
        ;;
    *)
        die "Neznan ukaz: $1\nUporaba: ./start.sh [--stop|--status|--clean|--pull|--logs]"
        ;;
esac

# ============================================================================
# KORAK 1: Preveri Docker
# ============================================================================
info "Korak 1/6: Preverjam Docker..."

if ! command -v docker &>/dev/null; then
    die "Docker ni nameschen. Namesti ga z: sudo apt install docker.io docker-compose-v2"
fi

if ! docker info &>/dev/null 2>&1; then
    die "Docker daemon ne tece ali nimas pravic. Poskusi:\n  sudo systemctl start docker\n  sudo usermod -aG docker \$USER  (nato se odjavi in prijavi)"
fi

ok "Docker deluje"

# ============================================================================
# KORAK 2: Preveri Ollama
# ============================================================================
info "Korak 2/6: Preverjam Ollama..."

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

# Opozorilo glede OLLAMA_CONTEXT_LENGTH
echo ""
warn "POMEMBNO: OpenHands zahteva velik kontekst za pravilno delovanje!"
warn "Ce Ollama ne deluje pravilno, ustavi jo in ponovno zazeni z:"
warn "  OLLAMA_CONTEXT_LENGTH=32768 OLLAMA_HOST=0.0.0.0:11434 OLLAMA_KEEP_ALIVE=-1 ollama serve"
echo ""

# ============================================================================
# KORAK 3: Pripravi direktorije
# ============================================================================
info "Korak 3/6: Pripravljam direktorije..."

mkdir -p "${OPENHANDS_STATE_DIR}"
mkdir -p "${WORKSPACE_DIR}"

ok "State dir: ${OPENHANDS_STATE_DIR}"
ok "Workspace: ${WORKSPACE_DIR}"

# ============================================================================
# KORAK 4: Pull Docker image (s smart caching)
# ============================================================================
info "Korak 4/6: Preverjam Docker image..."

PULL_NEEDED=0

if [ "${FORCE_PULL:-0}" = "1" ]; then
    PULL_NEEDED=1
elif ! image_exists "${OPENHANDS_IMAGE}" && ! image_exists "${OPENHANDS_IMAGE_FALLBACK}"; then
    PULL_NEEDED=1
fi

if [ "${PULL_NEEDED}" = "1" ]; then
    info "Prenasam OpenHands v${OPENHANDS_VERSION} Docker image..."
    if docker pull "${OPENHANDS_IMAGE}" 2>/dev/null; then
        USED_IMAGE="${OPENHANDS_IMAGE}"
        ok "Image prenesen: ${USED_IMAGE}"
    elif docker pull "${OPENHANDS_IMAGE_FALLBACK}" 2>/dev/null; then
        USED_IMAGE="${OPENHANDS_IMAGE_FALLBACK}"
        ok "Image prenesen (fallback): ${USED_IMAGE}"
    else
        die "Neuspesno prenasanje Docker image-a. Preveri internetno povezavo."
    fi
else
    if image_exists "${OPENHANDS_IMAGE}"; then
        USED_IMAGE="${OPENHANDS_IMAGE}"
    else
        USED_IMAGE="${OPENHANDS_IMAGE_FALLBACK}"
    fi
    ok "Image ze obstaja: ${USED_IMAGE}"
fi

# ============================================================================
# KORAK 5: Ustavi obstojecega ce tece
# ============================================================================
info "Korak 5/6: Preverjam obstojecega kontejnerja..."

if container_running; then
    warn "OpenHands ze tece. Ustavljam starega..."
    stop_container
fi

if container_exists; then
    docker rm "${CONTAINER_NAME}" >/dev/null 2>&1
fi

ok "Pripravljeno za zagon"

# ============================================================================
# KORAK 6: Zazeni OpenHands
# ============================================================================
info "Korak 6/6: Zaganjam OpenHands v${OPENHANDS_VERSION}..."
echo ""

docker run -d \
    --name "${CONTAINER_NAME}" \
    -e SANDBOX_USER_ID="$(id -u)" \
    -e SANDBOX_VOLUMES="${WORKSPACE_DIR}:/workspace:rw" \
    -e OH_SANDBOX_USE_HOST_NETWORK=true \
    -e LOG_ALL_EVENTS=true \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "${OPENHANDS_STATE_DIR}:/.openhands" \
    -p "${OPENHANDS_PORT}:3000" \
    --add-host host.docker.internal:host-gateway \
    "${USED_IMAGE}" >/dev/null

# Pocakaj da se zazene
info "Cakam da se OpenHands zazene..."
for i in $(seq 1 30); do
    if curl -sf "http://localhost:${OPENHANDS_PORT}" &>/dev/null; then
        break
    fi
    sleep 2
done

if container_running; then
    echo ""
    echo "============================================================"
    ok "OpenHands v${OPENHANDS_VERSION} TECE!"
    echo "============================================================"
    echo ""
    echo -e "  ${GREEN}UI:${NC}        http://localhost:${OPENHANDS_PORT}"
    echo -e "  ${GREEN}Workspace:${NC} ${WORKSPACE_DIR}"
    echo -e "  ${GREEN}Logi:${NC}      ./start.sh --logs"
    echo -e "  ${GREEN}Ustavi:${NC}    ./start.sh --stop"
    echo ""
    echo "============================================================"
    echo -e "  ${YELLOW}NASTAVITVE (prvic):${NC}"
    echo "  1. Odpri http://localhost:${OPENHANDS_PORT}"
    echo "  2. Klikni Settings (zobnik ikona)"
    echo "  3. Vklopi 'Advanced' stikalo"
    echo "  4. Nastavi:"
    echo -e "     ${BLUE}Custom Model:${NC}  openai/${OLLAMA_MODEL}"
    echo -e "     ${BLUE}Base URL:${NC}      ${OLLAMA_HOST_URL}/v1"
    echo -e "     ${BLUE}API Key:${NC}       dummy"
    echo "  5. Shrani nastavitve"
    echo "============================================================"
    echo ""
    echo -e "  ${YELLOW}Ce agent ne deluje pravilno, zagotovi da Ollama${NC}"
    echo -e "  ${YELLOW}tece z vecjim kontekstom:${NC}"
    echo "  OLLAMA_CONTEXT_LENGTH=32768 ollama serve"
    echo ""
else
    err "OpenHands se ni zagnal. Preveri loge z: docker logs ${CONTAINER_NAME}"
    exit 1
fi
