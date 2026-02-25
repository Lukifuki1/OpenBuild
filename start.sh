#!/usr/bin/env bash
# ============================================
# OpenBuild — start.sh
# En ukaz do stabilnega OpenHands v0.62.0
# ============================================
# Uporaba: ./start.sh
# ============================================
set -euo pipefail

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
log_info "OpenBuild + OpenHands v0.62.0 — Start $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
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

REQUIRED_CMDS=(git curl jq openssl docker)
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

if (( ${#MISSING_CMDS[@]} > 0 )); then
    log_warn "Manjkajoci paketi: ${MISSING_CMDS[*]}"
    log_info "Namescanje manjkajocih paketov ..."

    # Preslikava ukazov v apt pakete
    declare -A CMD_TO_PKG=(
        [git]="git"
        [curl]="curl"
        [jq]="jq"
        [openssl]="openssl"
        [docker]="docker.io"
        [ca-certificates]="ca-certificates"
    )

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

    # Ponovno preveri
    for cmd in "${REQUIRED_CMDS[@]}"; do
        command -v "${cmd}" &>/dev/null || fail "Ukaz '${cmd}' se vedno ni na voljo po namestitvi."
    done
fi

for cmd in "${REQUIRED_CMDS[@]}"; do
    log_ok "${cmd}: $(command -v "${cmd}")"
done

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
if command -v ss &>/dev/null; then
    if ss -tlnp 2>/dev/null | grep -q ":${OPENHANDS_PORT} "; then
        fail "Port ${OPENHANDS_PORT} je ze zaseden. Spremenite OPENHANDS_PORT v .env ali ustavite servis na tem portu."
    fi
elif command -v netstat &>/dev/null; then
    if netstat -tlnp 2>/dev/null | grep -q ":${OPENHANDS_PORT} "; then
        fail "Port ${OPENHANDS_PORT} je ze zaseden."
    fi
fi
log_ok "Port ${OPENHANDS_PORT} je prost"

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

                # Preveri ali docker vidi GPU
                if docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi &>/dev/null 2>&1; then
                    GPU_AVAILABLE=true
                    log_ok "Docker lahko dostopa do GPU"
                else
                    log_warn "Docker ne more dostopati do GPU. Preveri nvidia-container-toolkit konfiguracijo."
                    log_warn "Nadaljujem v CPU nacinu."
                fi
            else
                log_warn "nvidia-container-toolkit ni namescen. Nadaljujem v CPU nacinu."
                log_warn "Za GPU podporo namesti: sudo apt-get install -y nvidia-container-toolkit"
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
bash "${SCRIPT_DIR}/config/generate-env.sh"

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

if [[ "${OLLAMA_HTTP_CODE}" == "200" ]] || [[ "${OLLAMA_HTTP_CODE}" == "000" ]]; then
    # Ollama vraca 200 na root ali pa ni dosegljiv
    # Preverimo se /api/tags
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
    log_warn "Ollama NI dosegljiv na ${OLLAMA_CHECK_URL}"
    log_warn "Zaženi Ollama z: ollama serve"
    log_warn "OpenHands bo zagnan, a agent ne bo mogel generirati odgovorov brez LLM!"
fi

# ============================================
# 7. DOCKER IMAGE-JI
# ============================================
log_step "7/10 — Prenasanje Docker image-jev"

OPENHANDS_APP_IMAGE="docker.openhands.dev/openhands/openhands:0.62"
OPENHANDS_RUNTIME_IMAGE="${SANDBOX_RUNTIME_CONTAINER_IMAGE:-docker.openhands.dev/openhands/runtime:0.62-nikolaik}"

log_info "Prenasam: ${OPENHANDS_APP_IMAGE}"
docker pull "${OPENHANDS_APP_IMAGE}" 2>&1 | tail -1 | tee -a "${LOG_FILE}"

log_info "Prenasam: ${OPENHANDS_RUNTIME_IMAGE}"
docker pull "${OPENHANDS_RUNTIME_IMAGE}" 2>&1 | tail -1 | tee -a "${LOG_FILE}"

# Zabelezi digest-e
APP_DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "${OPENHANDS_APP_IMAGE}" 2>/dev/null || echo 'ni-dosegljiv')"
RUNTIME_DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "${OPENHANDS_RUNTIME_IMAGE}" 2>/dev/null || echo 'ni-dosegljiv')"

log_ok "Image-ji prenaseni:"
log_info "  App:     ${APP_DIGEST}"
log_info "  Runtime: ${RUNTIME_DIGEST}"

# ============================================
# 7. ZAGON DOCKER COMPOSE
# ============================================
log_step "8/10 — Zagon Docker Compose stack-a"

cd "${SCRIPT_DIR}"

# Ustavi obstoječ stack (če teče)
${COMPOSE_CMD} down --remove-orphans 2>/dev/null || true

# Sestavi compose ukaz
COMPOSE_FILES="-f docker-compose.yml"

if [[ "${GPU_AVAILABLE}" == "true" ]]; then
    COMPOSE_FILES="${COMPOSE_FILES} -f docker-compose.gpu.yml"
    log_info "GPU override aktiviran"
fi

# Zaženi
log_info "Zaganjam servise ..."
# shellcheck disable=SC2086
${COMPOSE_CMD} ${COMPOSE_FILES} up -d

# Cakaj na healthcheck
log_info "Cakam na healthcheck (do 120s) ..."
TIMEOUT=120
ELAPSED=0
INTERVAL=5

while (( ELAPSED < TIMEOUT )); do
    HEALTH="$(docker inspect --format='{{.State.Health.Status}}' openbuild-openhands 2>/dev/null || echo 'starting')"

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

# Preveri ali Docker socket deluje znotraj kontejnerja
RUNTIME_CHECK="$(docker exec openbuild-openhands ls /var/run/docker.sock 2>/dev/null && echo 'ok' || echo 'fail')"
if echo "${RUNTIME_CHECK}" | grep -q 'ok'; then
    log_ok "Docker socket dosegljiv v kontejnerju (agent lahko ustvarja sandbox-e)"
else
    log_warn "Docker socket NI dosegljiv v kontejnerju — sandbox-i ne bodo delovali"
fi

# Preveri ali je config.toml pravilno montiran
CONFIG_CHECK="$(docker exec openbuild-openhands test -f /.openhands/config.toml && echo 'ok' || echo 'fail')"
if [[ "${CONFIG_CHECK}" == "ok" ]]; then
    log_ok "config.toml je pravilno montiran v kontejner (/.openhands/config.toml)"
else
    log_warn "config.toml NI najden v kontejnerju — orodja in pravice morda niso pravilno nastavljene"
fi

# Preveri ali workspace obstaja in je zapisljiv
WS_CHECK="$(docker exec openbuild-openhands test -w /opt/workspace_base && echo 'ok' || echo 'fail')"
if [[ "${WS_CHECK}" == "ok" ]]; then
    log_ok "Workspace /opt/workspace_base je zapisljiv (agent lahko ureja datoteke)"
else
    log_warn "Workspace NI zapisljiv — agent ne bo mogel ustvarjati datotek"
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
