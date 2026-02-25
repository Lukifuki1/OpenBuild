#!/usr/bin/env bash
# ============================================
# OpenBuild — start.sh
# En ukaz do stabilnega OpenHands v0.62.0
# ============================================
# Uporaba: ./start.sh
# ============================================
set -euo pipefail

# ---- CLI argumenti ----
MODE="smart"  # smart (privzeto), restart, full
for arg in "$@"; do
    case "${arg}" in
        --restart|-r)
            MODE="restart"
            ;;
        --full|-f)
            MODE="full"
            ;;
        --help|-h)
            echo "Uporaba: ./start.sh [OPCIJA]"
            echo ""
            echo "Opcije:"
            echo "  (brez)       Pametni nacin: preveri okolje, namesti manjkajoce,"
            echo "               preskoci docker pull ce image ze obstaja lokalno."
            echo "  --restart    Hitri restart: preveri okolje, preskoci pull/build,"
            echo "               samo zaženi/restartaj kontejnerje."
            echo "  --full       Polni zagon: preveri okolje, namesti vse,"
            echo "               prisili docker pull in rebuild."
            echo "  --help       Pokazi to pomoc."
            exit 0
            ;;
        *)
            echo "Neznana opcija: ${arg}. Uporabi --help za pomoc."
            exit 1
            ;;
    esac
done

# ---- Barve za izpis ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # brez barve

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/start.log"

# ---- Funkcije ----
log_info()  { echo -e "${GREEN}[INFO]${NC}  $*" | tee -a "${LOG_FILE}"; }
log_warn()  { echo -e "${YELLOW}[OPOZORILO]${NC} $*" | tee -a "${LOG_FILE}"; }
log_error() { echo -e "${RED}[NAPAKA]${NC} $*" | tee -a "${LOG_FILE}" >&2; }
log_step()  { echo -e "${CYAN}[KORAK]${NC} $*" | tee -a "${LOG_FILE}"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*" | tee -a "${LOG_FILE}"; }

separator() {
    echo -e "${BLUE}============================================${NC}" | tee -a "${LOG_FILE}"
}

fail() {
    log_error "$@"
    exit 1
}

# ---- Inicializacija loga ----
: > "${LOG_FILE}"
separator
log_info "OpenBuild + OpenHands v0.62.0 — Start $(date -u '+%Y-%m-%d %H:%M:%S UTC') [nacin: ${MODE}]"
separator

# ============================================
# 1. SISTEMSKI PREGLED (System Readiness Check)
# ============================================
log_step "1/10 — Sistemski pregled"

# OS + Kernel
OS_INFO="$(uname -srm)"
log_info "OS: ${OS_INFO}"

if [[ "$(uname -s)" != "Linux" ]]; then
    fail "Podprt je samo Linux. Zaznano: $(uname -s)"
fi

KERNEL_VERSION="$(uname -r)"
log_info "Kernel: ${KERNEL_VERSION}"

# CPU
if command -v lscpu &>/dev/null; then
    CPU_MODEL="$(lscpu | grep 'Model name' | sed 's/.*:\s*//' | xargs)"
    CPU_CORES="$(lscpu | grep '^CPU(s):' | awk '{print $2}')"
    log_info "CPU: ${CPU_MODEL} (${CPU_CORES} niti)"
else
    log_warn "lscpu ni na voljo, preskakujem CPU info"
fi

# RAM
TOTAL_RAM_KB="$(grep MemTotal /proc/meminfo | awk '{print $2}')"
TOTAL_RAM_GB="$(( TOTAL_RAM_KB / 1024 / 1024 ))"
FREE_RAM_KB="$(grep MemAvailable /proc/meminfo | awk '{print $2}')"
FREE_RAM_GB="$(( FREE_RAM_KB / 1024 / 1024 ))"
log_info "RAM: ${TOTAL_RAM_GB} GiB skupno, ${FREE_RAM_GB} GiB prosto"

if (( TOTAL_RAM_GB < 4 )); then
    fail "Premalo RAM-a: ${TOTAL_RAM_GB} GiB. Potrebnih je vsaj 4 GiB."
fi

# Disk
DISK_FREE_KB="$(df -k "${SCRIPT_DIR}" | tail -1 | awk '{print $4}')"
DISK_FREE_GB="$(( DISK_FREE_KB / 1024 / 1024 ))"
log_info "Disk prost: ${DISK_FREE_GB} GiB (na $(df -h "${SCRIPT_DIR}" | tail -1 | awk '{print $6}'))"

if (( DISK_FREE_GB < 10 )); then
    fail "Premalo prostora na disku: ${DISK_FREE_GB} GiB. Potrebnih je vsaj 10 GiB."
fi

# Filesystem
FS_TYPE="$(df -T "${SCRIPT_DIR}" | tail -1 | awk '{print $2}')"
log_info "Datotecni sistem: ${FS_TYPE}"

# ============================================
# 2. PREVERJANJE ODVISNOSTI
# ============================================
log_step "2/10 — Preverjanje odvisnosti"

# Obvezni ukazi za delovanje
REQUIRED_CMDS=(git curl jq openssl docker python3 make)
MISSING_CMDS=()

for cmd in "${REQUIRED_CMDS[@]}"; do
    if ! command -v "${cmd}" &>/dev/null; then
        MISSING_CMDS+=("${cmd}")
    fi
done

# Preveri ca-certificates
if [[ ! -d /etc/ssl/certs ]] || [[ ! -f /etc/ssl/certs/ca-certificates.crt ]]; then
    MISSING_CMDS+=("ca-certificates")
fi

# Preveri pip/pip3
if ! command -v pip3 &>/dev/null && ! command -v pip &>/dev/null; then
    MISSING_CMDS+=("pip3")
fi

# Preveri build-essential (gcc kot indikator)
if ! command -v gcc &>/dev/null; then
    MISSING_CMDS+=("build-essential")
fi

# Preveri gpg (potreben za NVIDIA repo dodajanje)
if ! command -v gpg &>/dev/null; then
    MISSING_CMDS+=("gpg")
fi

# Preveri ss/netstat (port check)
if ! command -v ss &>/dev/null && ! command -v netstat &>/dev/null; then
    MISSING_CMDS+=("ss")
fi

# Preslikava ukazov v apt pakete
declare -A CMD_TO_PKG=(
    [git]="git"
    [curl]="curl"
    [jq]="jq"
    [openssl]="openssl"
    [docker]="docker.io"
    [python3]="python3"
    [pip3]="python3-pip"
    [make]="make"
    [build-essential]="build-essential"
    [gpg]="gnupg"
    [ss]="iproute2"
    [ca-certificates]="ca-certificates"
)

if (( ${#MISSING_CMDS[@]} > 0 )); then
    log_warn "Manjkajoci paketi: ${MISSING_CMDS[*]}"
    log_info "Namescanje manjkajocih paketov ..."

    PKGS_TO_INSTALL=()
    for cmd in "${MISSING_CMDS[@]}"; do
        pkg="${CMD_TO_PKG[${cmd}]:-${cmd}}"
        PKGS_TO_INSTALL+=("${pkg}")
    done

    if command -v apt-get &>/dev/null; then
        sudo apt-get update -qq
        sudo apt-get install -y -qq "${PKGS_TO_INSTALL[@]}"
    else
        fail "apt-get ni na voljo. Prosim namesti rocno: ${MISSING_CMDS[*]}"
    fi

    # Ponovno preveri obvezne ukaze
    for cmd in "${REQUIRED_CMDS[@]}"; do
        command -v "${cmd}" &>/dev/null || fail "Ukaz '${cmd}' se vedno ni na voljo po namestitvi."
    done
fi

for cmd in "${REQUIRED_CMDS[@]}"; do
    log_ok "${cmd}: $(command -v "${cmd}")"
done

# Dodatni paketi — preveri in namesti ce manjkajo
if command -v pip3 &>/dev/null; then
    log_ok "pip3: $(command -v pip3)"
elif command -v pip &>/dev/null; then
    log_ok "pip: $(command -v pip)"
fi

if command -v gcc &>/dev/null; then
    log_ok "build-essential: $(gcc --version | head -1)"
fi

# Python verzija
PYTHON_VERSION="$(python3 --version 2>/dev/null | awk '{print $2}')"
log_info "Python: ${PYTHON_VERSION}"
PY_MAJOR="$(echo "${PYTHON_VERSION}" | cut -d. -f1)"
PY_MINOR="$(echo "${PYTHON_VERSION}" | cut -d. -f2)"
if (( PY_MAJOR < 3 )) || (( PY_MAJOR == 3 && PY_MINOR < 8 )); then
    log_warn "Python verzija ${PYTHON_VERSION} je prestara. Priporocena je vsaj 3.8+."
fi

# ---- Docker verzija ----
DOCKER_VERSION="$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 'ni-dosegljiv')"
log_info "Docker verzija: ${DOCKER_VERSION}"

if [[ "${DOCKER_VERSION}" == "ni-dosegljiv" ]]; then
    fail "Docker daemon ni dosegljiv. Ali tecete brez sudo? Preverite 'docker info'."
fi

# ---- Docker Compose ----
COMPOSE_CMD=""
if docker compose version &>/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
    COMPOSE_VERSION="$(docker compose version --short 2>/dev/null || docker compose version)"
    log_info "Docker Compose (plugin): ${COMPOSE_VERSION}"
elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
    COMPOSE_VERSION="$(docker-compose version --short 2>/dev/null)"
    log_info "Docker Compose (standalone): ${COMPOSE_VERSION}"
else
    log_warn "Docker Compose ni najden. Namescanje ..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get update -qq
        sudo apt-get install -y -qq docker-compose-plugin 2>/dev/null || sudo apt-get install -y -qq docker-compose
    fi
    if docker compose version &>/dev/null 2>&1; then
        COMPOSE_CMD="docker compose"
    elif command -v docker-compose &>/dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        fail "Docker Compose namestitev ni uspela. Prosim namesti rocno."
    fi
fi

log_ok "Docker Compose: ${COMPOSE_CMD}"

# ---- Preverjanje portov ----
OPENHANDS_PORT="${OPENHANDS_PORT:-3000}"
PORT_IN_USE=false
PORT_BY_OWN_CONTAINER=false

if command -v ss &>/dev/null; then
    if ss -tlnp 2>/dev/null | grep -q ":${OPENHANDS_PORT} "; then
        PORT_IN_USE=true
    fi
elif command -v netstat &>/dev/null; then
    if netstat -tlnp 2>/dev/null | grep -q ":${OPENHANDS_PORT} "; then
        PORT_IN_USE=true
    fi
fi

# Ce port zaseden, preveri ali je to nas lastni OpenHands kontejner
if [[ "${PORT_IN_USE}" == "true" ]]; then
    # Preveri ali docker compose ze tece z nasim stack-om
    if docker compose ps --format '{{.State}}' openhands 2>/dev/null | grep -qi 'running'; then
        PORT_BY_OWN_CONTAINER=true
        log_info "Port ${OPENHANDS_PORT} zaseden z nasim OpenHands kontejnerjem (restart nacin)"
    elif docker-compose ps --format '{{.State}}' openhands 2>/dev/null | grep -qi 'running'; then
        PORT_BY_OWN_CONTAINER=true
        log_info "Port ${OPENHANDS_PORT} zaseden z nasim OpenHands kontejnerjem (restart nacin)"
    fi

    if [[ "${PORT_BY_OWN_CONTAINER}" == "false" ]]; then
        fail "Port ${OPENHANDS_PORT} je ze zaseden z drugim procesom. Spremenite OPENHANDS_PORT v .env ali ustavite servis na tem portu."
    fi
else
    log_ok "Port ${OPENHANDS_PORT} je prost"
fi

# ---- iptables/nftables stanje ----
if command -v iptables &>/dev/null; then
    IPTABLES_RULES="$(sudo iptables -L -n 2>/dev/null | wc -l || echo '0')"
    log_info "iptables: ${IPTABLES_RULES} pravil"
fi
if command -v nft &>/dev/null; then
    NFT_RULES="$(sudo nft list ruleset 2>/dev/null | wc -l || echo '0')"
    log_info "nftables: ${NFT_RULES} vrstic"
fi

# ============================================
# 3. GPU ZAZNAVA
# ============================================
log_step "3/10 — GPU zaznava"

GPU_AVAILABLE=false
GPU_TYPE="none"

# NVIDIA GPU
if command -v nvidia-smi &>/dev/null; then
    if nvidia-smi &>/dev/null; then
        GPU_COUNT="$(nvidia-smi -L 2>/dev/null | wc -l)"
        if (( GPU_COUNT > 0 )); then
            GPU_TYPE="nvidia"
            log_info "NVIDIA GPU zaznana: ${GPU_COUNT} naprav(e)"
            nvidia-smi -L 2>/dev/null | while read -r line; do log_info "  ${line}"; done

            # Preveri nvidia-container-toolkit
            if dpkg -l nvidia-container-toolkit &>/dev/null 2>&1 || command -v nvidia-container-runtime &>/dev/null; then
                log_ok "nvidia-container-toolkit je namescen"

                # Preveri ali docker vidi GPU (lahka preverba prek docker info)
                if docker info 2>/dev/null | grep -qi 'nvidia'; then
                    GPU_AVAILABLE=true
                    log_ok "Docker runtime podpira NVIDIA GPU"
                else
                    # Fallback: preveri nvidia runtime v docker config
                    if docker info 2>/dev/null | grep -qi 'Runtimes.*nvidia'; then
                        GPU_AVAILABLE=true
                        log_ok "Docker nvidia runtime zaznan"
                    else
                        log_warn "Docker ne vidi NVIDIA runtime-a. Preveri nvidia-container-toolkit konfiguracijo."
                        log_warn "Nadaljujem v CPU nacinu."
                    fi
                fi
            else
                log_warn "nvidia-container-toolkit ni namescen."
                log_info "Poskusam namestiti nvidia-container-toolkit ..."
                if command -v apt-get &>/dev/null; then
                    # Dodaj nvidia container toolkit repo ce ni prisoten
                    if ! apt-cache policy nvidia-container-toolkit 2>/dev/null | grep -q 'Candidate'; then
                        log_info "Dodajam NVIDIA container toolkit repozitorij ..."
                        curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null || true
                        curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
                            sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
                            sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null 2>/dev/null || true
                        sudo apt-get update -qq 2>/dev/null || true
                    fi
                    if sudo apt-get install -y -qq nvidia-container-toolkit 2>/dev/null; then
                        sudo nvidia-ctk runtime configure --runtime=docker 2>/dev/null || true
                        sudo systemctl restart docker 2>/dev/null || true
                        log_ok "nvidia-container-toolkit namescen in konfiguriran"
                        # Ponovno preveri
                        if docker info 2>/dev/null | grep -qi 'nvidia'; then
                            GPU_AVAILABLE=true
                            log_ok "Docker runtime podpira NVIDIA GPU po namestitvi toolkit-a"
                        else
                            log_warn "Docker se vedno ne vidi NVIDIA runtime-a po namestitvi. Morda je potreben ponovni zagon Docker-ja."
                        fi
                    else
                        log_warn "Namestitev nvidia-container-toolkit ni uspela."
                        log_warn "Za rocno namestitev: sudo apt-get install -y nvidia-container-toolkit"
                        log_warn "Nadaljujem v CPU nacinu."
                    fi
                else
                    log_warn "apt-get ni na voljo. Namesti rocno: nvidia-container-toolkit"
                    log_warn "Nadaljujem v CPU nacinu."
                fi
            fi
        fi
    fi
fi

# AMD GPU (ROCm)
if [[ "${GPU_TYPE}" == "none" ]] && [[ -d /dev/dri ]]; then
    if command -v rocm-smi &>/dev/null; then
        GPU_TYPE="amd-rocm"
        log_info "AMD GPU z ROCm zaznana"
        log_warn "ROCm podpora v OpenHands ni uradna. Nadaljujem v CPU nacinu."
    elif ls /dev/dri/render* &>/dev/null 2>&1; then
        log_info "GPU render naprave zaznane v /dev/dri, a brez ROCm"
        log_info "Nadaljujem v CPU nacinu"
    fi
fi

if [[ "${GPU_AVAILABLE}" == "true" ]]; then
    log_ok "GPU nacin: AKTIVIRAN (${GPU_TYPE})"
else
    log_info "GPU nacin: IZKLOPLJEN — deluje v CPU nacinu"
fi

# ============================================
# 4. GENERIRANJE .env
# ============================================
log_step "4/10 — Generiranje .env konfiguracije"

chmod +x "${SCRIPT_DIR}/config/generate-env.sh"
if [[ "${MODE}" == "restart" ]] && [[ -f "${SCRIPT_DIR}/.env" ]]; then
    log_info "Restart nacin: .env ze obstaja — preskakujem generate-env.sh"
else
    bash "${SCRIPT_DIR}/config/generate-env.sh"
fi

# Nalozi .env
set -a
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/.env"
set +a

log_ok ".env nalozen"

# ---- UID/GID zaznava za sandbox pravice ----
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"
log_info "Host UID/GID: ${HOST_UID}/${HOST_GID}"

# Nastavi SANDBOX_USER_ID v .env ce ni ze nastavljen ali je prazen
if grep -q "^SANDBOX_USER_ID=$" "${SCRIPT_DIR}/.env" 2>/dev/null || ! grep -q "^SANDBOX_USER_ID=" "${SCRIPT_DIR}/.env" 2>/dev/null; then
    if grep -q "^SANDBOX_USER_ID=" "${SCRIPT_DIR}/.env" 2>/dev/null; then
        sed -i "s|^SANDBOX_USER_ID=.*|SANDBOX_USER_ID=${HOST_UID}|" "${SCRIPT_DIR}/.env"
    else
        echo "SANDBOX_USER_ID=${HOST_UID}" >> "${SCRIPT_DIR}/.env"
    fi
    log_info "SANDBOX_USER_ID nastavljen na ${HOST_UID} (host UID)"
fi

# Ponovno nalozi .env z SANDBOX_USER_ID
set -a
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/.env"
set +a

# ============================================
# 5. PRIPRAVA DIREKTORIJEV
# ============================================
log_step "5/10 — Priprava direktorijev in volumnov"

WORKSPACE_DIR="${WORKSPACE_BASE:-${SCRIPT_DIR}/workspace}"

# Ustvari potrebne direktorije
mkdir -p "${WORKSPACE_DIR}"
mkdir -p "${SCRIPT_DIR}/data"

# Nastavi pravilne pravice (uporabi host UID)
chown -R "${HOST_UID}:${HOST_GID}" "${WORKSPACE_DIR}" 2>/dev/null || true
chmod 755 "${WORKSPACE_DIR}"
chmod 755 "${SCRIPT_DIR}/data"

# Ustvari ~/.openhands ce ne obstaja (za lokalno stanje)
mkdir -p "${HOME}/.openhands"
chmod 755 "${HOME}/.openhands"

# Generiraj privzeti settings.json, da API smoke test lahko ustvari conversation brez ročnega klikanja v UI
SETTINGS_FILE="${HOME}/.openhands/settings.json"
if [[ ! -f "${SETTINGS_FILE}" ]]; then
    log_info "Generiram privzeti settings.json (LLM + confirmation_mode=false)"

    SETTINGS_LLMMODEL="${LLM_MODEL:-ollama/qwen3-coder:30b}"
    SETTINGS_LLMBASE="${LLM_BASE_URL:-http://host.docker.internal:11434}"
    SETTINGS_LLMKEY="${LLM_API_KEY:-local-key}"

    cat > "${SETTINGS_FILE}" <<EOF
{
  "language": "sl",
  "confirmation_mode": false,
  "llm_model": "${SETTINGS_LLMMODEL}",
  "llm_base_url": "${SETTINGS_LLMBASE}",
  "llm_api_key": "${SETTINGS_LLMKEY}",
  "sandbox_runtime_container_image": "${SANDBOX_RUNTIME_CONTAINER_IMAGE:-}"
}
EOF
fi

log_ok "Direktoriji pripravljeni:"
log_info "  Workspace: ${WORKSPACE_DIR} (lastnik: ${HOST_UID}:${HOST_GID})"
log_info "  Data:      ${SCRIPT_DIR}/data"
log_info "  State:     ${HOME}/.openhands"

# ============================================
# 5b. PREVERJANJE CONFIG.TOML (Runtime, Orodja, Pravice)
# ============================================
log_step "5b/10 — Preverjanje config.toml (runtime, orodja, pravice)"

CONFIG_FILE="${SCRIPT_DIR}/config/config.toml"

if [[ ! -f "${CONFIG_FILE}" ]]; then
    fail "config/config.toml ne obstaja! Runtime executor, orodja in pravice NE bodo nastavljene."
fi

if [[ ! -r "${CONFIG_FILE}" ]]; then
    fail "config/config.toml ni berljiv. Preveri pravice datoteke."
fi

log_ok "config/config.toml obstaja in je berljiv"

# --- Preveri runtime nastavitev ---
if grep -q 'runtime.*=.*"docker"' "${CONFIG_FILE}"; then
    log_ok "Runtime: docker (agent bo ustvarjal sandbox kontejnerje)"
else
    log_warn "Runtime ni nastavljen na 'docker' v config.toml — sandbox kontejnerji morda ne bodo delovali"
fi

# --- Preveri orodja (tooling layer) ---
TOOLS_OK=true

check_tool_enabled() {
    local tool_name="$1"
    local config_key="$2"
    if grep -q "${config_key}.*=.*true" "${CONFIG_FILE}"; then
        log_ok "Orodje omogoceno: ${tool_name}"
    else
        log_warn "Orodje NI omogoceno: ${tool_name} (${config_key})"
        TOOLS_OK=false
    fi
}

check_tool_enabled "Shell/Bash (izvrsevanje ukazov)"     "enable_cmd"
check_tool_enabled "Urejevalnik datotek"                  "enable_editor"
check_tool_enabled "Brskalnik (Playwright/BrowserGym)"    "enable_browsing"
check_tool_enabled "Jupyter/IPython"                      "enable_jupyter"
check_tool_enabled "MCP orodja"                           "enable_mcp"
check_tool_enabled "Think (razmisljanje)"                 "enable_think"
check_tool_enabled "Finish (zakljucitev naloge)"          "enable_finish"

if [[ "${TOOLS_OK}" == "true" ]]; then
    log_ok "Vsa orodja so pravilno omogocena"
else
    log_warn "Nekatera orodja niso omogocena — agent morda ne bo mogel izvrsevati vseh akcij"
fi

# --- Preveri pravice (permission/policy) ---
if grep -q 'confirmation_mode.*=.*false' "${CONFIG_FILE}"; then
    log_ok "Pravice: confirmation_mode = false (agent izvrsuje brez vprasevanja)"
else
    log_warn "confirmation_mode ni nastavljen na false — agent bo vpraseval pred vsako akcijo"
fi

# --- Preveri brskalnik ---
if grep -q 'enable_browser.*=.*true' "${CONFIG_FILE}"; then
    log_ok "Brskalnik omogocen v [core] sekciji"
else
    log_warn "enable_browser ni nastavljen na true — brskanje po spletu morda ne bo delovalo"
fi

# --- Preveri inicializacijo pluginov ---
if grep -q 'initialize_plugins.*=.*true' "${CONFIG_FILE}"; then
    log_ok "Inicializacija pluginov omogocena (Jupyter, agent_skills)"
else
    log_warn "initialize_plugins ni nastavljen na true — plugini morda ne bodo inicializirani"
fi

log_ok "Preverjanje config.toml zakljuceno"

# ============================================
# 6. DOCKER IMAGE-JI
# ============================================
# ============================================
# 6. PREVERJANJE OLLAMA POVEZLJIVOSTI
# ============================================
log_step "6/10 — Preverjanje Ollama povezljivosti"

# Ollama URL (iz .env ali privzeto)
OLLAMA_HOST="${LLM_BASE_URL:-http://localhost:11434}"
# Pretvori host.docker.internal v localhost za host-side preverjanje
OLLAMA_CHECK_URL="$(echo "${OLLAMA_HOST}" | sed 's|host\.docker\.internal|localhost|g')"

log_info "Preverjam Ollama na: ${OLLAMA_CHECK_URL}"

OLLAMA_REACHABLE=false
OLLAMA_HTTP_CODE="$(curl -sf -o /dev/null -w '%{http_code}' "${OLLAMA_CHECK_URL}" 2>/dev/null || echo '000')"

if [[ "${OLLAMA_HTTP_CODE}" == "200" ]]; then
    # Ollama vraca 200 na root — preverimo se /api/tags
    OLLAMA_TAGS_CODE="$(curl -sf -o /dev/null -w '%{http_code}' "${OLLAMA_CHECK_URL}/api/tags" 2>/dev/null || echo '000')"
    if [[ "${OLLAMA_TAGS_CODE}" == "200" ]]; then
        OLLAMA_REACHABLE=true
        log_ok "Ollama dosegljiv na ${OLLAMA_CHECK_URL}"

        # Preveri ali je qwen3-coder:30b model prisoten
        MODEL_NAME="${LLM_MODEL:-ollama/qwen3-coder:30b}"
        # Odstrani "ollama/" prefix za iskanje
        MODEL_SHORT="$(echo "${MODEL_NAME}" | sed 's|^ollama/||')"
        if curl -sf "${OLLAMA_CHECK_URL}/api/tags" 2>/dev/null | jq -r '.models[].name' 2>/dev/null | grep -qi "${MODEL_SHORT}"; then
            log_ok "Model '${MODEL_SHORT}' je prisoten v Ollama"
        else
            log_warn "Model '${MODEL_SHORT}' NI najden v Ollama. Prenesi ga z: ollama pull ${MODEL_SHORT}"
            log_warn "Agent ne bo deloval dokler model ni prisoten!"
        fi
    fi
fi

if [[ "${OLLAMA_REACHABLE}" == "false" ]]; then
    if [[ "${OLLAMA_HTTP_CODE}" == "000" ]]; then
        log_warn "Ollama NI dosegljiv (connection refused / DNS fail / timeout) na ${OLLAMA_CHECK_URL}"
    else
        log_warn "Ollama vrnil nepricakovan HTTP ${OLLAMA_HTTP_CODE} na ${OLLAMA_CHECK_URL}"
    fi
    log_warn "Zazeni Ollama z: ollama serve"
    log_warn "OpenHands bo zagnan, a agent ne bo mogel generirati odgovorov brez LLM!"
fi

# ============================================
# 7. DOCKER IMAGE-JI
# ============================================
log_step "7/10 — Docker image-ji"

OPENHANDS_APP_IMAGE="docker.openhands.dev/openhands/openhands:0.62"
# Runtime image je opcijski: ce tag ni objavljen ali ni kompatibilen, OpenHands runtime lahko zgradi sam.
OPENHANDS_RUNTIME_IMAGE="${SANDBOX_RUNTIME_CONTAINER_IMAGE:-}"
RUNTIME_PULLED=false

# --- Pametna logika: preskoci pull ce image ze obstaja lokalno ---
APP_IMAGE_EXISTS=false
RUNTIME_IMAGE_EXISTS=false

if docker image inspect "${OPENHANDS_APP_IMAGE}" &>/dev/null; then
    APP_IMAGE_EXISTS=true
fi

if [[ -n "${OPENHANDS_RUNTIME_IMAGE}" ]] && docker image inspect "${OPENHANDS_RUNTIME_IMAGE}" &>/dev/null; then
    RUNTIME_IMAGE_EXISTS=true
fi

SKIP_PULL=false
if [[ "${MODE}" == "restart" ]]; then
    # Restart nacin: vedno preskoci pull
    if [[ "${APP_IMAGE_EXISTS}" == "true" ]]; then
        SKIP_PULL=true
        log_info "Restart nacin: app image ze obstaja lokalno, preskakujem pull"
    else
        log_warn "Restart nacin, a app image ne obstaja lokalno — moram narediti pull"
    fi
elif [[ "${MODE}" == "smart" ]]; then
    # Smart nacin: preskoci pull ce image ze obstaja
    if [[ "${APP_IMAGE_EXISTS}" == "true" ]]; then
        SKIP_PULL=true
        log_info "App image ze obstaja lokalno — preskakujem pull (uporabi --full za prisilen pull)"
    fi
else
    # Full nacin: vedno naredi pull
    log_info "Full nacin: prisilen docker pull"
fi

if [[ "${SKIP_PULL}" == "false" ]]; then
    log_info "Prenasam: ${OPENHANDS_APP_IMAGE}"
    if ! docker pull "${OPENHANDS_APP_IMAGE}" 2>&1 | tee -a "${LOG_FILE}"; then
        fail "Docker pull neuspesen za app image: ${OPENHANDS_APP_IMAGE}"
    fi

    if [[ -n "${OPENHANDS_RUNTIME_IMAGE}" ]]; then
        log_info "Preverjam obstoj runtime image (manifest): ${OPENHANDS_RUNTIME_IMAGE}"
        if docker manifest inspect "${OPENHANDS_RUNTIME_IMAGE}" &>/dev/null; then
            log_info "Prenasam: ${OPENHANDS_RUNTIME_IMAGE}"
            if docker pull "${OPENHANDS_RUNTIME_IMAGE}" 2>&1 | tee -a "${LOG_FILE}"; then
                RUNTIME_PULLED=true
            else
                log_warn "Docker pull neuspesen za runtime image: ${OPENHANDS_RUNTIME_IMAGE}"
                log_warn "OpenHands bo runtime zgradil sam ob prvem zagonu (pocasneje)."
                log_warn "Ce agent generira akcije, ki se ne izvedejo: najprej preveri runtime image + handshake (RUNTIME_EXECUTOR.md)."
            fi
        else
            log_warn "Runtime image tag ni na voljo v registry: ${OPENHANDS_RUNTIME_IMAGE}"
            log_warn "OpenHands bo runtime zgradil sam ob prvem zagonu (pocasneje)."
            OPENHANDS_RUNTIME_IMAGE=""
        fi
    else
        log_info "SANDBOX_RUNTIME_CONTAINER_IMAGE ni nastavljen — runtime bo zgrajen iz uradnega Dockerfile (reproducible)"
    fi
else
    log_ok "Docker pull preskocen (image-ji ze obstajajo lokalno)"
    if [[ "${RUNTIME_IMAGE_EXISTS}" == "true" ]]; then
        RUNTIME_PULLED=true
    fi
fi

# Zabelezi digest-e
APP_DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "${OPENHANDS_APP_IMAGE}" 2>/dev/null || echo 'lokalni-image')"
RUNTIME_DIGEST="ni-dosegljiv"
if [[ "${RUNTIME_PULLED}" == "true" ]] && [[ -n "${OPENHANDS_RUNTIME_IMAGE}" ]]; then
    RUNTIME_DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "${OPENHANDS_RUNTIME_IMAGE}" 2>/dev/null || echo 'lokalni-image')"
fi

log_ok "Image-ji pripravljeni:"
log_info "  App:     ${APP_DIGEST}"
log_info "  Runtime: ${RUNTIME_DIGEST}"

# ============================================
# 7. ZAGON DOCKER COMPOSE
# ============================================
log_step "8/10 — Zagon Docker Compose stack-a"

cd "${SCRIPT_DIR}"

# Sestavi compose ukaz
COMPOSE_FILES="-f docker-compose.yml"

if [[ "${GPU_AVAILABLE}" == "true" ]]; then
    COMPOSE_FILES="${COMPOSE_FILES} -f docker-compose.gpu.yml"
    log_info "GPU override aktiviran"
fi

# --- Restart / full logika ---
if [[ "${MODE}" == "full" ]]; then
    # Full: ustavi in ponovno zgradi/zazeni
    ${COMPOSE_CMD} down --remove-orphans 2>/dev/null || true
    log_info "Full nacin: zaganjam servise (down + up -d) ..."
    # shellcheck disable=SC2086
    ${COMPOSE_CMD} ${COMPOSE_FILES} up -d
else
    # Smart/Restart: brez down — samo up -d (idempotent)
    log_info "${MODE} nacin: zaganjam/posodabljam servise (up -d brez down) ..."
    # shellcheck disable=SC2086
    ${COMPOSE_CMD} ${COMPOSE_FILES} up -d
fi

# Cakaj na healthcheck
log_info "Cakam na healthcheck (do 120s) ..."
TIMEOUT=120
ELAPSED=0
INTERVAL=5

# Pridobi container ID prek compose (ne hardkodirano ime)
OH_CONTAINER_ID="$(${COMPOSE_CMD} ${COMPOSE_FILES} ps -q openhands 2>/dev/null || echo '')" 
if [[ -z "${OH_CONTAINER_ID}" ]]; then
    fail "OpenHands kontejner se ni zagnal. Preveri: ${COMPOSE_CMD} ps"
fi
log_info "OpenHands container ID: ${OH_CONTAINER_ID:0:12}"

while (( ELAPSED < TIMEOUT )); do
    HEALTH="$(docker inspect --format='{{.State.Health.Status}}' "${OH_CONTAINER_ID}" 2>/dev/null || echo 'starting')"

    if [[ "${HEALTH}" == "healthy" ]]; then
        break
    fi

    if [[ "${HEALTH}" == "unhealthy" ]]; then
        log_error "Kontejner je unhealthy. Logi:"
        ${COMPOSE_CMD} ${COMPOSE_FILES} logs --tail=50 openhands 2>&1 | tee -a "${LOG_FILE}"
        fail "OpenHands kontejner ni uspel zagnati."
    fi

    sleep "${INTERVAL}"
    ELAPSED=$(( ELAPSED + INTERVAL ))
    echo -ne "\r  Cakam ... ${ELAPSED}s / ${TIMEOUT}s (status: ${HEALTH})"
done
echo ""

if (( ELAPSED >= TIMEOUT )); then
    log_error "Timeout po ${TIMEOUT}s. Logi:"
    # shellcheck disable=SC2086
    ${COMPOSE_CMD} ${COMPOSE_FILES} logs --tail=50 openhands 2>&1 | tee -a "${LOG_FILE}"
    fail "Healthcheck ni uspel v ${TIMEOUT}s."
fi

log_ok "Kontejner je zdrav (healthy)"

# ============================================
# 8. SMOKE TEST
# ============================================
log_step "9/10 — Smoke test"

HEALTH_URL="http://localhost:${OPENHANDS_PORT:-3000}/"
HTTP_CODE="$(curl -sf -o /dev/null -w '%{http_code}' "${HEALTH_URL}" 2>/dev/null || echo '000')"

if [[ "${HTTP_CODE}" == "200" ]] || [[ "${HTTP_CODE}" == "302" ]]; then
    log_ok "Smoke test uspesen (HTTP ${HTTP_CODE})"
else
    log_error "Smoke test neuspesen: HTTP ${HTTP_CODE} na ${HEALTH_URL}"
    # shellcheck disable=SC2086
    ${COMPOSE_CMD} ${COMPOSE_FILES} logs --tail=30 openhands 2>&1 | tee -a "${LOG_FILE}"
    fail "OpenHands UI ni dosegljiv."
fi

# ============================================
# 10. RUNTIME EXECUTOR VALIDACIJA
# ============================================
log_step "10/10 — Runtime executor validacija"

# Uporabi container ID iz compose (ne hardkodirano ime)
# OH_CONTAINER_ID je ze nastavljen iz healthcheck faze

# --- 1. Docker socket ---
RUNTIME_CHECK="$(docker exec "${OH_CONTAINER_ID}" ls /var/run/docker.sock 2>/dev/null && echo 'ok' || echo 'fail')"
if echo "${RUNTIME_CHECK}" | grep -q 'ok'; then
    log_ok "Docker socket dosegljiv v kontejnerju (agent lahko ustvarja sandbox-e)"
else
    log_warn "Docker socket NI dosegljiv v kontejnerju — sandbox-i ne bodo delovali"
fi

# --- 2. Config montiran ---
CONFIG_CHECK="$(docker exec "${OH_CONTAINER_ID}" test -f /.openhands/config.toml && echo 'ok' || echo 'fail')"
if [[ "${CONFIG_CHECK}" == "ok" ]]; then
    log_ok "config.toml je pravilno montiran v kontejner (/.openhands/config.toml)"
else
    log_warn "config.toml NI najden v kontejnerju — orodja in pravice morda niso pravilno nastavljene"
fi

# --- 3. Workspace zapisljiv ---
WS_CHECK="$(docker exec "${OH_CONTAINER_ID}" test -w /opt/workspace_base && echo 'ok' || echo 'fail')"
if [[ "${WS_CHECK}" == "ok" ]]; then
    log_ok "Workspace /opt/workspace_base je zapisljiv (agent lahko ureja datoteke)"
else
    log_warn "Workspace NI zapisljiv — agent ne bo mogel ustvarjati datotek"
fi

# --- 4. Runtime image validacija ---
# Preveri ali runtime image vsebuje OpenHands runtime API (ne samo nikolaik base)
log_info "Preverjam runtime image za OpenHands runtime API ..."
RT_IMG="${SANDBOX_RUNTIME_CONTAINER_IMAGE:-}"
if [[ -n "${RT_IMG}" ]] && docker image inspect "${RT_IMG}" &>/dev/null; then
    # Preveri ali image vsebuje /openhands ali /app (runtime server)
    RT_HAS_RUNTIME="$(docker run --rm --entrypoint /bin/sh "${RT_IMG}" -lc 'test -d /openhands || test -d /app/openhands' 2>/dev/null && echo 'ok' || echo 'fail')"
    if echo "${RT_HAS_RUNTIME}" | grep -q 'ok'; then
        log_ok "Runtime image vsebuje OpenHands runtime API (/openhands)"
    else
        log_warn "Runtime image morda NIMA OpenHands runtime API."
        log_warn "Ce agent generira akcije, ki se ne izvedejo: to je verjetno razlog."
        log_warn "Glej RUNTIME_EXECUTOR.md > Troubleshooting > 'Runtime image brez API'"
    fi
else
    log_warn "Runtime image '${RT_IMG}' ni lokalno — bo zgrajen ob prvi seji."
fi

# --- 5. Pravi smoke test: runtime API endpoint ---
# OpenHands API ima /api/options endpoint ki potrdi da je app server pripravljen
API_URL="http://localhost:${OPENHANDS_PORT:-3000}/api/options/config"
API_CODE="$(curl -sf -o /dev/null -w '%{http_code}' "${API_URL}" 2>/dev/null || echo '000')"
if [[ "${API_CODE}" == "200" ]]; then
    log_ok "OpenHands API endpoint dosegljiv (HTTP ${API_CODE}) — app server je pripravljen"
else
    log_warn "OpenHands API endpoint ni vrnil 200 (HTTP ${API_CODE}) — app server morda se inicializira"
    log_warn "Ce agent ne dela po zagonu, pocakaj 30s in preveri znova: curl ${API_URL}"
fi

# --- 6. Pravi execution smoke test (API -> sandbox) ---
if [[ "${MODE}" == "restart" ]]; then
    log_info "Restart nacin: preskakujem execution smoke test (conversation + runtime_id)"
else
    log_info "Execution smoke test: ustvarjam novo conversation prek API ..."
    SMOKE_API_BASE="http://localhost:${OPENHANDS_PORT:-3000}"
    SMOKE_CONV_RESP="$(curl -sf -H 'Content-Type: application/json' -d '{"initial_user_msg":"SMOKE_TEST: samo izvedi ukaz: echo SMOKE_OK"}' "${SMOKE_API_BASE}/api/conversations" 2>/dev/null || true)"
    SMOKE_CONV_ID="$(echo "${SMOKE_CONV_RESP}" | jq -r '.conversation_id // empty' 2>/dev/null || true)"

    if [[ -z "${SMOKE_CONV_ID}" ]]; then
        log_warn "Smoke test ni uspel ustvariti conversation prek API. Odgovor: ${SMOKE_CONV_RESP:-<prazen>}"
        log_warn "To lahko pomeni: settings.json manjka ali je neveljaven, ali pa API zahteva dodatno avtentikacijo."
    else
        log_ok "Conversation ustvarjen: ${SMOKE_CONV_ID}"

        # Pocakaj, da runtime (sandbox) vrne runtime_id prek /config
        SMOKE_TIMEOUT=180
        SMOKE_ELAPSED=0
        SMOKE_INTERVAL=5
        SMOKE_RUNTIME_ID=""

        while (( SMOKE_ELAPSED < SMOKE_TIMEOUT )); do
            SMOKE_CFG_JSON="$(curl -sf "${SMOKE_API_BASE}/api/conversations/${SMOKE_CONV_ID}/config" 2>/dev/null || true)"
            SMOKE_RUNTIME_ID="$(echo "${SMOKE_CFG_JSON}" | jq -r '.runtime_id // empty' 2>/dev/null || true)"

            if [[ -n "${SMOKE_RUNTIME_ID}" ]] && [[ "${SMOKE_RUNTIME_ID}" != "null" ]]; then
                break
            fi

            sleep "${SMOKE_INTERVAL}"
            SMOKE_ELAPSED=$(( SMOKE_ELAPSED + SMOKE_INTERVAL ))
        done

        if [[ -z "${SMOKE_RUNTIME_ID}" ]] || [[ "${SMOKE_RUNTIME_ID}" == "null" ]]; then
            log_error "Sandbox runtime se ni inicializiral v ${SMOKE_TIMEOUT}s (runtime_id je prazen)"
            log_error "To je tipicen 'pseudo-planning' failure mode: agent generira akcije, a runtime API handshake ne uspe."
            ${COMPOSE_CMD} ${COMPOSE_FILES} logs --tail=120 openhands 2>&1 | tee -a "${LOG_FILE}"
            fail "Execution smoke test ni uspel."
        fi

        log_ok "Sandbox runtime READY: ${SMOKE_RUNTIME_ID}"

        # Preveri da sandbox container obstaja
        if docker ps --format '{{.Names}}' | grep -q "^${SMOKE_RUNTIME_ID}$"; then
            log_ok "Sandbox container tece: ${SMOKE_RUNTIME_ID}"
        else
            if docker ps --format '{{.Names}}' | grep -q '^oh-agent-server-'; then
                log_ok "Sandbox container(ji) zaznani (oh-agent-server-*)"
            else
                log_warn "Ne vidim oh-agent-server container-ja v 'docker ps' — lahko je ugasnjen/paused ali pa runtime uporablja drug nacin."
            fi
        fi

        # Cleanup: ustavi conversation
        curl -sf -X POST "${SMOKE_API_BASE}/api/conversations/${SMOKE_CONV_ID}/stop" 2>/dev/null || true
    fi
fi

# --- 7. Diagnostika execution state-a ---
log_info "Diagnostika execution state:"
log_info "  Docker socket v kontejnerju:  $(echo "${RUNTIME_CHECK}" | tail -1)"
log_info "  Config montiran:              ${CONFIG_CHECK}"
log_info "  Workspace zapisljiv:          ${WS_CHECK}"
log_info "  App API pripravljen:          HTTP ${API_CODE}"
log_info "  Ollama dosegljiv:             ${OLLAMA_REACHABLE}"
if [[ "${OLLAMA_REACHABLE}" == "true" ]] && echo "${RUNTIME_CHECK}" | grep -q 'ok' && [[ "${CONFIG_CHECK}" == "ok" ]] && [[ "${WS_CHECK}" == "ok" ]] && [[ "${API_CODE}" == "200" ]]; then
    log_ok "Osnovni pogoji za execution so izpolnjeni"
else
    log_warn "Nekateri pogoji za execution niso izpolnjeni — glej zgoraj"
    log_warn "Agent bo morda v PSEUDO-PLANNING stanju (generira akcije, ki se ne izvedejo)"
    log_warn "Glej RUNTIME_EXECUTOR.md za diagnostiko in resitve"
fi

log_ok "Runtime executor validacija zakljucena"

# ============================================
# KONCNI IZPIS
# ============================================
separator
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  OpenBuild + OpenHands v0.62.0${NC}"
echo -e "${GREEN}  SISTEM JE PRIPRAVLJEN${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  ${CYAN}UI:${NC}          http://localhost:${OPENHANDS_PORT:-3000}"
echo -e "  ${CYAN}LLM:${NC}         Qwen3-Coder:30B (Ollama)"
echo -e "  ${CYAN}Ollama:${NC}      ${OLLAMA_CHECK_URL}"
echo -e "  ${CYAN}GPU:${NC}         ${GPU_AVAILABLE} (${GPU_TYPE})"
echo -e "  ${CYAN}Workspace:${NC}   ${WORKSPACE_DIR}"
echo -e "  ${CYAN}Config:${NC}      ${CONFIG_FILE}"
echo ""
echo -e "  ${YELLOW}Naslednji koraki:${NC}"
echo -e "    1. Preveri da Ollama tece: ollama serve"
echo -e "    2. Preveri da model obstaja: ollama pull qwen3-coder:30b"
echo -e "    3. Odpri http://localhost:${OPENHANDS_PORT:-3000} v brskalniku"
echo -e "    4. Zacni nov pogovor z agentom"
echo ""
echo -e "  ${YELLOW}Zmoznosti agenta (vse konfigurirane):${NC}"
echo -e "    - Shell/Bash izvrsevanje ukazov (enable_cmd=true)"
echo -e "    - Urejanje in ustvarjanje datotek (enable_editor=true)"
echo -e "    - Brskanje po spletu — Playwright/BrowserGym (enable_browsing=true)"
echo -e "    - Jupyter/IPython izvrsevanje (enable_jupyter=true)"
echo -e "    - MCP orodja (enable_mcp=true)"
echo -e "    - Docker-in-Docker (Docker socket montiran)"
echo -e "    - Polne pravice — brez confirmation mode, brez read-only"
echo ""
echo -e "  ${YELLOW}Ustavitev:${NC} cd ${SCRIPT_DIR} && ${COMPOSE_CMD} down"
echo ""
separator

log_info "Log shranjen v: ${LOG_FILE}"
exit 0
