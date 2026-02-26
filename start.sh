#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# OpenDevin - start.sh
# Avtomatski zagonski skript za OpenDevin na Ubuntu z Ollama + GPU
#
# Ob prvem zagonu:
#   - Preveri in namesti vse manjkajoce odvisnosti
#   - Ustvari .env in config.toml
#   - Namesti Python/frontend odvisnosti, zgradi frontend
#   - Potegne Docker sandbox sliko
#
# Ob ponovnem zagonu:
#   - Preveri kaj je ze namesceno/zgrajeno in preskoci
#   - Samo zazene servise
###############################################################################

# ======================== BARVE ========================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ======================== HELPERS ========================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

WORKSPACE_DIR="${SCRIPT_DIR}/workspace"
BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-3001}"
OLLAMA_PORT=11434
OLLAMA_HOST="http://localhost:${OLLAMA_PORT}"

# Privzeti model - lahko spremenite
DEFAULT_LLM_MODEL="${LLM_MODEL:-ollama/qwen3-coder:30b}"
DEFAULT_OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3-coder:30b}"

# State direktorij za sledenje kaj je ze namesceno
STATE_DIR="${SCRIPT_DIR}/.opendevin-state"

# PID spremenljivke za cleanup
BACKEND_PID=""
FRONTEND_PID=""

log_info()  { echo -e "${BLUE}[INFO]${RESET}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${RESET}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
log_err()   { echo -e "${RED}[ERR]${RESET}   $*"; }
log_step()  { echo -e "\n${BOLD}${CYAN}=== $* ===${RESET}\n"; }
log_skip()  { echo -e "${GREEN}[SKIP]${RESET}  $* (ze opravljeno)"; }

command_exists() { command -v "$1" &>/dev/null; }

# ======================== STATE MANAGEMENT ========================
state_init() {
    mkdir -p "$STATE_DIR"
}

state_is_done() {
    [[ -f "${STATE_DIR}/$1" ]]
}

state_mark_done() {
    echo "$(date '+%Y-%m-%d %H:%M:%S')" > "${STATE_DIR}/$1"
}

state_clear() {
    rm -f "${STATE_DIR}/$1"
}

state_clear_all() {
    rm -rf "$STATE_DIR"
    mkdir -p "$STATE_DIR"
}

file_hash() {
    if [[ -f "$1" ]]; then
        md5sum "$1" 2>/dev/null | cut -d' ' -f1
    else
        echo "missing"
    fi
}

# ======================== CLEANUP ========================
cleanup() {
    local exit_code=$?
    echo ""
    log_info "Ustavljam OpenDevin..."
    if [[ -n "${BACKEND_PID:-}" ]]; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    if [[ -n "${FRONTEND_PID:-}" ]]; then
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi
    rm -f "${SCRIPT_DIR}/.backend.pid" "${SCRIPT_DIR}/.frontend.pid"
    log_ok "OpenDevin ustavljen."
    exit "$exit_code"
}

# ======================== 1. PREVERJANJE SISTEMA ========================
check_system() {
    log_step "1/8 Preverjanje sistema"

    # OS
    if [[ "$(uname)" != "Linux" ]]; then
        log_warn "Ta skript je optimiziran za Ubuntu Linux."
    fi

    if command_exists lsb_release; then
        log_info "OS: $(lsb_release -ds)"
    fi
    log_info "Kernel: $(uname -r)"
    log_info "RAM: $(free -h | awk '/^Mem:/{print $2}') skupno"
    log_info "Disk: $(df -h "$SCRIPT_DIR" | awk 'NR==2{print $4}') prosto"
}

# ======================== 2. GPU PREVERJANJE ========================
check_gpu() {
    log_step "2/8 Preverjanje GPU (NVIDIA)"

    if command_exists nvidia-smi; then
        GPU_COUNT=$(nvidia-smi --query-gpu=count --format=csv,noheader,nounits | head -1)
        log_ok "Najdeno $GPU_COUNT NVIDIA GPU:"
        nvidia-smi --query-gpu=index,name,memory.total,driver_version --format=csv,noheader | while read -r line; do
            log_info "  GPU $line"
        done

        # Dinamicno nastavi CUDA_VISIBLE_DEVICES glede na stevilo GPU
        GPU_INDICES=$(nvidia-smi --query-gpu=index --format=csv,noheader,nounits | paste -sd',')
        export CUDA_VISIBLE_DEVICES="$GPU_INDICES"
        log_info "CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES}"

        # Preveri NVIDIA Container Toolkit
        if dpkg -l nvidia-container-toolkit &>/dev/null; then
            log_ok "NVIDIA Container Toolkit je nameščen"
        else
            log_warn "NVIDIA Container Toolkit ni nameščen. Nameščam..."
            install_nvidia_container_toolkit
        fi
    else
        log_warn "nvidia-smi ni najden. GPU pospešitev ne bo na voljo."
        log_warn "Če imate NVIDIA GPU, namestite driver: sudo apt install nvidia-driver-XXX"
    fi
}

install_nvidia_container_toolkit() {
    log_info "Nameščam NVIDIA Container Toolkit..."
    if ! command_exists curl; then
        sudo apt-get update -qq && sudo apt-get install -y -qq curl
    fi
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
        sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null || true
    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
    sudo apt-get update -qq && sudo apt-get install -y -qq nvidia-container-toolkit
    sudo nvidia-ctk runtime configure --runtime=docker
    sudo systemctl restart docker
    log_ok "NVIDIA Container Toolkit nameščen"
}

# ======================== 3. ODVISNOSTI ========================
install_dependencies() {
    log_step "3/8 Preverjanje in nameščanje odvisnosti"

    # Python 3.11+
    PYTHON_CMD=""
    for py in python3.12 python3.11 python3; do
        if command_exists "$py"; then
            PY_VER=$("$py" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
            PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
            PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
            if [[ "$PY_MAJOR" -ge 3 && "$PY_MINOR" -ge 11 ]]; then
                PYTHON_CMD="$py"
                break
            fi
        fi
    done

    if [[ -z "$PYTHON_CMD" ]]; then
        log_warn "Python 3.11+ ni najden. Nameščam..."
        sudo apt-get update -qq
        sudo apt-get install -y -qq software-properties-common
        sudo add-apt-repository -y ppa:deadsnakes/ppa
        sudo apt-get update -qq
        sudo apt-get install -y -qq python3.11 python3.11-venv python3.11-dev
        PYTHON_CMD="python3.11"
    fi
    log_ok "Python: $($PYTHON_CMD --version)"

    # pip
    if ! $PYTHON_CMD -m pip --version &>/dev/null; then
        log_info "Nameščam pip..."
        sudo apt-get install -y -qq python3-pip
    fi

    # Node.js & npm
    if ! command_exists node; then
        log_warn "Node.js ni najden. Nameščam v18.x..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y -qq nodejs
    fi
    log_ok "Node.js: $(node --version)"
    log_ok "npm: $(npm --version)"

    # Poetry
    if ! command_exists poetry; then
        log_warn "Poetry ni najden. Nameščam..."
        curl -sSL https://install.python-poetry.org | $PYTHON_CMD -
        export PATH="$HOME/.local/bin:$PATH"
        # Dodaj v .bashrc ce se ni tam
        if ! grep -q '\.local/bin' "$HOME/.bashrc" 2>/dev/null; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
        fi
    fi
    # Zagotovi da je poetry v PATH
    export PATH="$HOME/.local/bin:$PATH"
    log_ok "Poetry: $(poetry --version)"

    # Docker
    if ! command_exists docker; then
        log_warn "Docker ni najden. Nameščam..."
        sudo apt-get update -qq
        sudo apt-get install -y -qq docker.io
        sudo systemctl enable --now docker
        sudo usermod -aG docker "$USER"
        log_warn "Dodan v docker skupino. Morda boste morali odjaviti in prijaviti nazaj."
    fi
    log_ok "Docker: $(docker --version)"

    # Docker Compose
    if ! docker compose version &>/dev/null && ! command_exists docker-compose; then
        log_warn "Docker Compose ni najden. Nameščam plugin..."
        sudo apt-get install -y -qq docker-compose-plugin
    fi
    if docker compose version &>/dev/null; then
        log_ok "Docker Compose: $(docker compose version)"
    fi

    # netcat za health check
    if ! command_exists nc && ! command_exists ncat; then
        sudo apt-get install -y -qq netcat-openbsd 2>/dev/null || sudo apt-get install -y -qq ncat 2>/dev/null || true
    fi

    # Ollama
    if ! command_exists ollama; then
        log_warn "Ollama ni najden. Nameščam..."
        curl -fsSL https://ollama.com/install.sh | sh
    fi
    log_ok "Ollama: $(ollama --version 2>/dev/null || echo 'nameščen')"
}

# ======================== 4. OLLAMA + MODEL ========================
setup_ollama() {
    log_step "4/8 Nastavljanje Ollama in modela"

    # Zagotovi da Ollama tece
    if ! curl -sf "${OLLAMA_HOST}/api/tags" &>/dev/null; then
        log_info "Zaganjam Ollama server..."
        export OLLAMA_NUM_GPU=999

        # Poskusi zagnati prek systemd ali v ozadju
        if systemctl is-active --quiet ollama 2>/dev/null; then
            log_ok "Ollama ze tece prek systemd"
        else
            # Poskusi systemd
            if sudo systemctl start ollama 2>/dev/null; then
                log_ok "Ollama zagnan prek systemd"
            else
                # Zazeni v ozadju
                nohup ollama serve > /tmp/ollama.log 2>&1 &
                log_info "Ollama zagnan v ozadju (PID: $!)"
            fi
        fi

        # Pocakaj da se zazene
        log_info "Cakam da se Ollama zazene..."
        for i in $(seq 1 30); do
            if curl -sf "${OLLAMA_HOST}/api/tags" &>/dev/null; then
                break
            fi
            sleep 1
        done

        if ! curl -sf "${OLLAMA_HOST}/api/tags" &>/dev/null; then
            log_err "Ollama se ni zagnal v 30s. Prosim zazenite 'ollama serve' rocno."
            exit 1
        fi
    fi
    log_ok "Ollama server tece na ${OLLAMA_HOST}"

    # Preveri ali prenesi model
    OLLAMA_MODEL_NAME="${DEFAULT_OLLAMA_MODEL}"
    if ollama list 2>/dev/null | grep -q "${OLLAMA_MODEL_NAME}"; then
        log_skip "Model ${OLLAMA_MODEL_NAME} je ze prenesen"
    else
        log_info "Prenasam model ${OLLAMA_MODEL_NAME}... (to lahko traja)"
        ollama pull "${OLLAMA_MODEL_NAME}"
        log_ok "Model ${OLLAMA_MODEL_NAME} prenesen"
    fi

    # Pokazi informacije o modelu
    log_info "Nalozeni modeli:"
    ollama list 2>/dev/null || true
}

# ======================== 5. .ENV + CONFIG ========================
setup_config() {
    log_step "5/8 Ustvarjanje konfiguracije (.env + config.toml)"

    mkdir -p "$WORKSPACE_DIR"

    # Dinamicno zaznaj GPU indekse
    local gpu_devices="0"
    if command_exists nvidia-smi; then
        gpu_devices=$(nvidia-smi --query-gpu=index --format=csv,noheader,nounits | paste -sd',')
    fi

    # Ustvari .env SAMO ce ne obstaja
    if [[ ! -f "${SCRIPT_DIR}/.env" ]]; then
        cat > "${SCRIPT_DIR}/.env" <<EOF
# ============================================
# OpenDevin - Avtomatsko ustvarjena konfiguracija
# Datum: $(date '+%Y-%m-%d %H:%M:%S')
# ============================================

# ----- LLM (Ollama) -----
LLM_MODEL="${DEFAULT_LLM_MODEL}"
LLM_API_KEY="ollama"
LLM_BASE_URL="${OLLAMA_HOST}"
LLM_EMBEDDING_MODEL="local"
LLM_NUM_RETRIES=5
LLM_COOLDOWN_TIME=3

# ----- Workspace -----
WORKSPACE_BASE="${WORKSPACE_DIR}"

# ----- Sandbox -----
SANDBOX_CONTAINER_IMAGE="ghcr.io/opendevin/sandbox"
SANDBOX_TYPE="ssh"
USE_HOST_NETWORK="false"

# ----- Agent -----
AGENT="MonologueAgent"
MAX_ITERATIONS=100
MAX_CHARS=5000000

# ----- GPU -----
CUDA_VISIBLE_DEVICES=${gpu_devices}
OLLAMA_NUM_GPU=999

# ----- Server -----
BACKEND_HOST="127.0.0.1:${BACKEND_PORT}"
FRONTEND_PORT="${FRONTEND_PORT}"
EOF
        log_ok ".env ustvarjen"
    else
        log_skip ".env ze obstaja (uporabi --force-config za ponovno ustvarjanje)"
    fi

    # Ustvari config.toml SAMO ce ne obstaja
    if [[ ! -f "${SCRIPT_DIR}/config.toml" ]]; then
        cat > "${SCRIPT_DIR}/config.toml" <<EOF
# OpenDevin config - avtomatsko ustvarjeno
# Datum: $(date '+%Y-%m-%d %H:%M:%S')

LLM_MODEL="${DEFAULT_LLM_MODEL}"
LLM_API_KEY="ollama"
LLM_BASE_URL="${OLLAMA_HOST}"
LLM_EMBEDDING_MODEL="local"
LLM_NUM_RETRIES=5
LLM_COOLDOWN_TIME=3
WORKSPACE_BASE="${WORKSPACE_DIR}"
AGENT="MonologueAgent"
MAX_ITERATIONS=100
EOF
        log_ok "config.toml ustvarjen"
    else
        log_skip "config.toml ze obstaja"
    fi

    log_info "Konfiguracija:"
    log_info "  Model: ${DEFAULT_LLM_MODEL}"
    log_info "  Ollama URL: ${OLLAMA_HOST}"
    log_info "  Workspace: ${WORKSPACE_DIR}"
    log_info "  Backend port: ${BACKEND_PORT}"
    log_info "  Frontend port: ${FRONTEND_PORT}"
}

# ======================== 6. PYTHON + FRONTEND DEPS ========================
install_project_deps() {
    log_step "6/8 Nameščanje projektnih odvisnosti"

    # Python odvisnosti - preveri hash pyproject.toml
    local pyproject_hash
    pyproject_hash=$(file_hash "${SCRIPT_DIR}/pyproject.toml")
    local saved_hash=""
    [[ -f "${STATE_DIR}/pyproject.hash" ]] && saved_hash=$(cat "${STATE_DIR}/pyproject.hash")

    if [[ "$pyproject_hash" != "$saved_hash" ]]; then
        # Preveri ce je poetry.lock iz stare verzije Poetry
        if [[ -f "${SCRIPT_DIR}/poetry.lock" ]]; then
            local lock_poetry_ver
            lock_poetry_ver=$(head -3 "${SCRIPT_DIR}/poetry.lock" | grep -oP 'Poetry \K[0-9]+' || echo "")
            local cur_poetry_ver
            cur_poetry_ver=$(poetry --version 2>/dev/null | grep -oP 'Poetry \(version \K[0-9]+' || echo "")
            if [[ -n "$lock_poetry_ver" && -n "$cur_poetry_ver" && "$lock_poetry_ver" != "$cur_poetry_ver" ]]; then
                log_warn "poetry.lock je iz Poetry ${lock_poetry_ver}.x, ti imas Poetry ${cur_poetry_ver}.x — regeneriram lock..."
                rm -f "${SCRIPT_DIR}/poetry.lock"
                poetry lock 2>&1 | tail -5
            fi
        fi

        log_info "Nameščam Python odvisnosti prek Poetry..."
        if ! poetry install --without evaluation 2>&1 | tail -10; then
            log_warn "Poetry install ni uspel. Regeneriram poetry.lock in poskusam znova..."
            rm -f "${SCRIPT_DIR}/poetry.lock"
            poetry lock 2>&1 | tail -5
            poetry install --without evaluation 2>&1 | tail -10
        fi
        echo "$pyproject_hash" > "${STATE_DIR}/pyproject.hash"
        log_ok "Python odvisnosti nameščene"
    else
        log_skip "Python odvisnosti (pyproject.toml se ni spremenil)"
    fi

    # Frontend odvisnosti - preveri hash package.json
    local pkg_hash
    pkg_hash=$(file_hash "${SCRIPT_DIR}/frontend/package.json")
    local saved_pkg_hash=""
    [[ -f "${STATE_DIR}/package.hash" ]] && saved_pkg_hash=$(cat "${STATE_DIR}/package.hash")

    if [[ "$pkg_hash" != "$saved_pkg_hash" ]]; then
        log_info "Nameščam frontend odvisnosti..."
        cd "${SCRIPT_DIR}/frontend"
        npm install 2>&1 | tail -5
        npm run make-i18n 2>&1 || true
        cd "$SCRIPT_DIR"
        echo "$pkg_hash" > "${STATE_DIR}/package.hash"
        log_ok "Frontend odvisnosti nameščene"
    else
        log_skip "Frontend odvisnosti (package.json se ni spremenil)"
    fi
}

# ======================== 7. BUILD ========================
build_project() {
    log_step "7/8 Gradnja projekta"

    # Docker sandbox slika - preveri ce ze obstaja
    if docker image inspect ghcr.io/opendevin/sandbox &>/dev/null && state_is_done "docker_sandbox"; then
        log_skip "Docker sandbox slika ze prenesena"
    else
        log_info "Prenasam Docker sandbox sliko..."
        if docker pull ghcr.io/opendevin/sandbox 2>&1 | tail -3; then
            state_mark_done "docker_sandbox"
            log_ok "Docker sandbox slika prenesena"
        else
            log_warn "Nisem mogel prenesti sandbox slike. Gradim lokalno..."
            docker build -t ghcr.io/opendevin/sandbox -f containers/sandbox/Dockerfile containers/sandbox/
            state_mark_done "docker_sandbox"
            log_ok "Docker sandbox slika zgrajena lokalno"
        fi
    fi

    # Frontend build - preveri hash frontend/src
    local src_hash
    src_hash=$(find "${SCRIPT_DIR}/frontend/src" -type f -exec md5sum {} + 2>/dev/null | sort | md5sum | cut -d' ' -f1)
    local saved_src_hash=""
    [[ -f "${STATE_DIR}/frontend_src.hash" ]] && saved_src_hash=$(cat "${STATE_DIR}/frontend_src.hash")

    if [[ "$src_hash" != "$saved_src_hash" ]] || [[ ! -d "${SCRIPT_DIR}/frontend/build" ]]; then
        log_info "Gradim frontend..."
        cd "${SCRIPT_DIR}/frontend"
        npm run build 2>&1 | tail -5
        cd "$SCRIPT_DIR"
        echo "$src_hash" > "${STATE_DIR}/frontend_src.hash"
        log_ok "Frontend zgrajen"
    else
        log_skip "Frontend build (izvorna koda se ni spremenila)"
    fi
}

# ======================== 8. ZAGON ========================
start_app() {
    log_step "8/8 Zaganjanje OpenDevin"

    # TRAP na zacetku - PRED zaganjanjem procesov
    trap cleanup SIGINT SIGTERM EXIT

    # Nalaganje .env
    set -a
    source "${SCRIPT_DIR}/.env"
    set +a

    # Ustvari logs direktorij
    mkdir -p "${SCRIPT_DIR}/logs"

    # Ustavi morebiten predhodni backend proces
    if lsof -i ":${BACKEND_PORT}" &>/dev/null 2>&1; then
        log_warn "Port ${BACKEND_PORT} je ze zaseden. Ustavljam prejsnji proces..."
        fuser -k "${BACKEND_PORT}/tcp" 2>/dev/null || true
        sleep 2
    fi

    if lsof -i ":${FRONTEND_PORT}" &>/dev/null 2>&1; then
        log_warn "Port ${FRONTEND_PORT} je ze zaseden. Ustavljam prejsnji proces..."
        fuser -k "${FRONTEND_PORT}/tcp" 2>/dev/null || true
        sleep 2
    fi

    # Zazeni backend
    log_info "Zaganjam backend server na portu ${BACKEND_PORT}..."
    poetry run uvicorn opendevin.server.listen:app --host 0.0.0.0 --port "${BACKEND_PORT}" \
        > "${SCRIPT_DIR}/logs/backend.log" 2>&1 &
    BACKEND_PID=$!
    log_info "Backend PID: ${BACKEND_PID}"

    # Pocakaj da se backend zazene
    log_info "Cakam da se backend zazene..."
    for i in $(seq 1 60); do
        if curl -sf "http://localhost:${BACKEND_PORT}/api/litellm-models" &>/dev/null; then
            break
        fi
        if ! kill -0 $BACKEND_PID 2>/dev/null; then
            log_err "Backend se je ustavil. Preverite logs/backend.log"
            cat "${SCRIPT_DIR}/logs/backend.log" | tail -20
            exit 1
        fi
        sleep 1
    done

    if ! curl -sf "http://localhost:${BACKEND_PORT}/api/litellm-models" &>/dev/null; then
        log_err "Backend se ni zagnal v 60s. Preverite logs/backend.log"
        exit 1
    fi
    log_ok "Backend tece na http://localhost:${BACKEND_PORT}"

    # Zazeni frontend
    log_info "Zaganjam frontend na portu ${FRONTEND_PORT}..."
    cd "${SCRIPT_DIR}/frontend"
    BACKEND_HOST="127.0.0.1:${BACKEND_PORT}" FRONTEND_PORT="${FRONTEND_PORT}" \
        npm run start > "${SCRIPT_DIR}/logs/frontend.log" 2>&1 &
    FRONTEND_PID=$!
    cd "$SCRIPT_DIR"
    log_info "Frontend PID: ${FRONTEND_PID}"

    # Pocakaj da se frontend zazene
    log_info "Cakam da se frontend zazene..."
    for i in $(seq 1 30); do
        if curl -sf "http://localhost:${FRONTEND_PORT}" &>/dev/null; then
            break
        fi
        sleep 1
    done

    log_ok "Frontend tece na http://localhost:${FRONTEND_PORT}"

    # Shrani PID-je za kasnejse ustavljanje
    echo "${BACKEND_PID}" > "${SCRIPT_DIR}/.backend.pid"
    echo "${FRONTEND_PID}" > "${SCRIPT_DIR}/.frontend.pid"

    # Odpri brskalnik
    echo ""
    echo -e "${BOLD}${GREEN}=================================================${RESET}"
    echo -e "${BOLD}${GREEN}  OpenDevin je zagnan!${RESET}"
    echo -e "${BOLD}${GREEN}=================================================${RESET}"
    echo ""
    echo -e "  ${CYAN}UI:${RESET}       http://localhost:${FRONTEND_PORT}"
    echo -e "  ${CYAN}Backend:${RESET}  http://localhost:${BACKEND_PORT}"
    echo -e "  ${CYAN}Ollama:${RESET}   ${OLLAMA_HOST}"
    echo -e "  ${CYAN}Model:${RESET}    ${DEFAULT_LLM_MODEL}"
    echo -e "  ${CYAN}GPU:${RESET}      $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | paste -sd', ' || echo 'N/A')"
    echo -e "  ${CYAN}Workspace:${RESET} ${WORKSPACE_DIR}"
    echo ""
    echo -e "  ${YELLOW}Logi:${RESET} logs/backend.log, logs/frontend.log"
    echo -e "  ${YELLOW}Ustavi:${RESET} ./start.sh --stop"
    echo ""

    # Odpri brskalnik
    if command_exists xdg-open; then
        sleep 2
        xdg-open "http://localhost:${FRONTEND_PORT}" 2>/dev/null &
    fi

    # Pocakaj na CTRL+C
    log_info "Pritisni CTRL+C za ustavitev..."
    wait
}

# ======================== STOP ========================
stop_app() {
    log_info "Ustavljam OpenDevin..."

    if [[ -f "${SCRIPT_DIR}/.backend.pid" ]]; then
        BPID=$(cat "${SCRIPT_DIR}/.backend.pid")
        if kill -0 "$BPID" 2>/dev/null; then
            kill "$BPID"
            log_ok "Backend ustavljen (PID: $BPID)"
        fi
        rm -f "${SCRIPT_DIR}/.backend.pid"
    fi

    if [[ -f "${SCRIPT_DIR}/.frontend.pid" ]]; then
        FPID=$(cat "${SCRIPT_DIR}/.frontend.pid")
        if kill -0 "$FPID" 2>/dev/null; then
            kill "$FPID"
            log_ok "Frontend ustavljen (PID: $FPID)"
        fi
        rm -f "${SCRIPT_DIR}/.frontend.pid"
    fi

    # Ustavi morebitne osirotele procese
    fuser -k "${BACKEND_PORT}/tcp" 2>/dev/null || true
    fuser -k "${FRONTEND_PORT}/tcp" 2>/dev/null || true

    log_ok "OpenDevin ustavljen."
}

# ======================== STATUS ========================
status_app() {
    echo -e "${BOLD}OpenDevin Status${RESET}"
    echo ""

    # Ollama
    if curl -sf "${OLLAMA_HOST}/api/tags" &>/dev/null; then
        log_ok "Ollama: tece na ${OLLAMA_HOST}"
        echo "  Modeli:"
        ollama list 2>/dev/null | head -10 || true
    else
        log_err "Ollama: ne tece"
    fi
    echo ""

    # Backend
    if curl -sf "http://localhost:${BACKEND_PORT}/api/litellm-models" &>/dev/null; then
        log_ok "Backend: tece na portu ${BACKEND_PORT}"
    else
        log_err "Backend: ne tece"
    fi

    # Frontend
    if curl -sf "http://localhost:${FRONTEND_PORT}" &>/dev/null; then
        log_ok "Frontend: tece na portu ${FRONTEND_PORT}"
    else
        log_err "Frontend: ne tece"
    fi
    echo ""

    # GPU
    if command_exists nvidia-smi; then
        echo -e "${BOLD}GPU:${RESET}"
        nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu \
            --format=csv,noheader 2>/dev/null || true
    fi
}

# ======================== MAIN ========================
main() {
    echo -e "${BOLD}${CYAN}"
    echo "  ___                   ____            _       "
    echo " / _ \ _ __   ___ _ __ |  _ \  _____  _(_)_ __  "
    echo "| | | | '_ \ / _ \ '_ \| | | |/ _ \ \/ / | '_ \ "
    echo "| |_| | |_) |  __/ | | | |_| |  __/>  <| | | | |"
    echo " \___/| .__/ \___|_| |_|____/ \___/_/\_\_|_| |_|"
    echo "      |_|                                        "
    echo -e "${RESET}"
    echo -e "${BOLD}  Lokalni zagon z Ollama + GPU${RESET}"
    echo ""

    case "${1:-}" in
        --stop|-s)
            stop_app
            exit 0
            ;;
        --status)
            status_app
            exit 0
            ;;
        --help|-h)
            echo "Uporaba: ./start.sh [OPCIJA]"
            echo ""
            echo "Opcije:"
            echo "  (brez)         Zazeni OpenDevin (preveri, namesti, zazeni)"
            echo "  --stop, -s     Ustavi OpenDevin"
            echo "  --status       Pokazi status"
            echo "  --rebuild      Ponovi gradnjo (frontend + deps)"
            echo "  --force-config Ponovno ustvari .env in config.toml"
            echo "  --clean        Izbrisi vse stanje in zacni znova"
            echo "  --help, -h     Pokazi to pomoc"
            echo ""
            echo "Spremenljivke okolja:"
            echo "  LLM_MODEL       Model za LLM (privzeto: ollama/qwen3-coder:30b)"
            echo "  OLLAMA_MODEL    Ollama model za prenos (privzeto: qwen3-coder:30b)"
            echo "  BACKEND_PORT    Port za backend (privzeto: 3000)"
            echo "  FRONTEND_PORT   Port za frontend (privzeto: 3001)"
            exit 0
            ;;
        --rebuild)
            state_init
            state_clear_all
            install_project_deps
            build_project
            log_ok "Ponovna gradnja koncana!"
            exit 0
            ;;
        --force-config)
            rm -f "${SCRIPT_DIR}/.env" "${SCRIPT_DIR}/config.toml"
            setup_config
            log_ok "Konfiguracija ponovno ustvarjena!"
            exit 0
            ;;
        --clean)
            log_warn "Brisem vse stanje..."
            state_clear_all
            rm -f "${SCRIPT_DIR}/.env" "${SCRIPT_DIR}/config.toml"
            rm -rf "${SCRIPT_DIR}/frontend/build" "${SCRIPT_DIR}/frontend/node_modules"
            rm -f "${SCRIPT_DIR}/.backend.pid" "${SCRIPT_DIR}/.frontend.pid"
            log_ok "Vse stanje izbrisano. Zazeni ./start.sh za svez zacetek."
            exit 0
            ;;
    esac

    state_init
    check_system
    check_gpu
    install_dependencies
    setup_ollama
    setup_config
    install_project_deps
    build_project
    start_app
}

main "$@"
