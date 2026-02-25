#!/usr/bin/env bash
# ============================================
# generate-env.sh — Generiranje .env datoteke
# ============================================
# Generira .env iz .env.example z varnimi
# nakljucnimi vrednostmi za skrivnosti.
# Ce .env ze obstaja, doda samo manjkajoce kljuce.
# ============================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_EXAMPLE="${PROJECT_ROOT}/.env.example"
ENV_FILE="${PROJECT_ROOT}/.env"

generate_secret() {
    openssl rand -hex 32
}

if [[ ! -f "${ENV_EXAMPLE}" ]]; then
    echo "[NAPAKA] .env.example ne obstaja: ${ENV_EXAMPLE}" >&2
    exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "[INFO] Ustvarjam .env iz .env.example ..."
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
fi

# Generiranje manjkajocih skrivnosti
set_if_empty() {
    local key="$1"
    local value="$2"
    if grep -q "^${key}=$" "${ENV_FILE}" 2>/dev/null; then
        sed -i "s|^${key}=$|${key}=${value}|" "${ENV_FILE}"
        echo "[INFO] Generiran: ${key}"
    elif ! grep -q "^${key}=" "${ENV_FILE}" 2>/dev/null; then
        echo "${key}=${value}" >> "${ENV_FILE}"
        echo "[INFO] Dodan: ${key}"
    fi
}

# Generiranje varnih vrednosti
set_if_empty "JWT_SECRET" "$(generate_secret)"

# LLM konfiguracija (Qwen3-Coder:30B prek Ollama — fiksno)
set_if_empty "LLM_MODEL" "ollama/qwen3-coder:30b"
set_if_empty "LLM_API_KEY" "local-key"
set_if_empty "LLM_BASE_URL" "http://host.docker.internal:11434"

# Nastavi WORKSPACE_BASE ce ni nastavljen
set_if_empty "WORKSPACE_BASE" "${PROJECT_ROOT}/workspace"

# Nastavi SANDBOX_RUNTIME_CONTAINER_IMAGE ce ni nastavljen
set_if_empty "SANDBOX_RUNTIME_CONTAINER_IMAGE" "docker.openhands.dev/openhands/runtime:0.62-nikolaik"

# Nastavi privzeti port
set_if_empty "OPENHANDS_PORT" "3000"

# Nastavi LOG_ALL_EVENTS
set_if_empty "LOG_ALL_EVENTS" "true"

# Nastavi ENABLE_GPU
set_if_empty "ENABLE_GPU" "auto"

# Dodaj manjkajoce kljuce iz .env.example (brez prepisovanja obstojecih)
while IFS= read -r line; do
    if [[ "${line}" =~ ^[A-Z_][A-Z0-9_]*= ]]; then
        key="${line%%=*}"
        if ! grep -q "^${key}=" "${ENV_FILE}" 2>/dev/null; then
            echo "${line}" >> "${ENV_FILE}"
            echo "[INFO] Dodan iz example: ${key}"
        fi
    fi
done < "${ENV_EXAMPLE}"

echo "[OK] .env je pripravljen: ${ENV_FILE}"
