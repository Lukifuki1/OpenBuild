# OpenBuild + OpenHands v0.62.0

Integracija [OpenHands](https://github.com/All-Hands-AI/OpenHands) v0.62.0 z Docker Compose bootstrapom.
En ukaz (`./start.sh`) pripelje sistem iz nic v stabilno operativno stanje.

## Zmoznosti

- **AI-driven razvoj** — OpenHands agent lahko pise kodo, zaganja ukaze, ureja datoteke
- **Docker sandbox** — Agent ustvarja in zaganja Docker kontejnerje za izolacijo
- **Brskalnik** — Agent ima dostop do brskalnika (Playwright/BrowserGym) za spletno brskanje
- **Zagon projektov** — Agent lahko zaganja in testira projekte znotraj sandbox-a
- **GPU podpora** — Avtomatska zaznava NVIDIA GPU z nvidia-container-toolkit
- **CLI + SDK** — OpenHands CLI in SDK (openhands-ai, openhands-sdk) sta vkljucena
- **LLM** — Qwen3-Coder:30B prek Ollama serverja (fiksno nastavljeno)
- **Polne pravice** — Vsa orodja omogocena, brez confirmation mode, polno izvrsevanje

## Predpogoji

- **OS**: Linux (testiran na Ubuntu 22.04+)
- **Docker**: >= 20.10 z Docker Compose v2 pluginom
- **RAM**: >= 4 GiB (priporoceno >= 8 GiB)
- **Disk**: >= 10 GiB prostega prostora
- **Ollama**: Namescen in zagnan na gostitelju z modelom `qwen3-coder:30b`

Sledece se namesti avtomatsko (ce manjka): `git`, `curl`, `jq`, `openssl`, `ca-certificates`, `docker`, `docker-compose-plugin`

## Hiter zagon

```bash
# 1. Kloniraj repozitorij
git clone --recurse-submodules git@github.com:Lukifuki1/OpenBuild.git
cd OpenBuild

# 2. Preveri da Ollama tece in ima model
ollama serve &   # ce se ne tece
ollama pull qwen3-coder:30b

# 3. Pozeni bootstrap
chmod +x start.sh
./start.sh

# 4. Odpri v brskalniku
#    http://localhost:3000
```

## Struktura

```
OpenBuild/
├── start.sh                    # Glavni bootstrap skript (10 korakov)
├── docker-compose.yml          # Docker Compose konfiguracija
├── docker-compose.gpu.yml      # GPU override (NVIDIA)
├── .env.example                # Primer okolja (brez skrivnosti)
├── .gitignore                  # Izlocitve za git
├── config/
│   ├── config.toml             # OpenHands konfiguracija (runtime, orodja, pravice)
│   └── generate-env.sh         # Generiranje .env z varnimi skrivnostmi
├── data/                       # Podatki (gitignored)
├── workspace/                  # Workspace za agenta (gitignored)
├── third_party/
│   └── openhands/              # OpenHands v0.62.0 (git submodule)
├── scripts/                    # Pomozni skripti
├── VERSION_MANIFEST.md         # Pinned verzije in digesti
├── CHECKS.md                   # Dokumentacija preverjanj start.sh
├── RUNTIME_EXECUTOR.md         # Dokumentacija runtime executorja
└── README.md                   # Ta datoteka
```

## Konfiguracija

### Okolje (.env)

`start.sh` avtomatsko generira `.env` iz `.env.example`. Kljucne spremenljivke:

| Spremenljivka                     | Opis                                      | Privzeto                      |
|-----------------------------------|--------------------------------------------|-------------------------------|
| `LLM_MODEL`                       | Model LLM                                 | `ollama/qwen3-coder:30b`     |
| `LLM_API_KEY`                     | API kljuc za LLM                          | `local-key`                   |
| `LLM_BASE_URL`                    | URL za Ollama server                      | `http://host.docker.internal:11434` |
| `OPENHANDS_PORT`                  | Port za UI                                | `3000`                        |
| `WORKSPACE_BASE`                  | Pot do workspace-a                        | `./workspace`                 |
| `SANDBOX_RUNTIME_CONTAINER_IMAGE` | Runtime Docker image                      | `...runtime:0.62-nikolaik`    |
| `SANDBOX_VOLUMES`                 | Volumni za mount v sandbox                | (prazno)                      |
| `ENABLE_GPU`                      | GPU podpora (auto/true/false)             | `auto`                        |

### GPU podpora

`start.sh` avtomatsko zazna NVIDIA GPU:
1. Preveri `nvidia-smi`
2. Preveri `nvidia-container-toolkit`
3. Testira Docker GPU dostop
4. Ce vse deluje, aktivira `docker-compose.gpu.yml` override

Za rucno izklopitev GPU: nastavi `ENABLE_GPU=false` v `.env`.

### LLM (Qwen3-Coder:30B prek Ollama)

Privzeto je konfiguriran **Qwen3-Coder:30B** prek lokalnega Ollama serverja.

```bash
# Preveri da Ollama tece
ollama serve

# Prenesi model (ce se ni prisoten)
ollama pull qwen3-coder:30b

# Preveri da model deluje
ollama run qwen3-coder:30b "Hello"
```

Za oblacne LLM ponudnike spremeni v `.env`:
```bash
LLM_MODEL=gpt-4o
LLM_API_KEY=tvoj-api-kljuc
LLM_BASE_URL=
```

### Mount lokalnega projekta

```bash
# V .env nastavi:
SANDBOX_VOLUMES=/pot/do/projekta:/workspace:rw
```

## Docker-in-Docker

OpenHands v0.62.0 ustvarja sandbox kontejnerje za agenta. To deluje prek:

1. **Docker socket mount** — `/var/run/docker.sock` je montiran v OpenHands kontejner
2. **Runtime image** — `runtime:0.62-nikolaik` se uporabi za sandbox kontejnerje
3. **host.docker.internal** — Omogoca komunikacijo med kontejnerji
4. **Workspace mount** — Agentov workspace je dosegljiv na hostu

Agent lahko znotraj sandbox-a:
- Izvrsuje shell ukaze
- Ureja in ustvarja datoteke
- Zaganja in ustavlja projekte (npm, python, docker, ...)
- Brska po spletu (Playwright/BrowserGym)
- Namesca pakete in orodja

## Odpravljanje tezav

### Port je ze zaseden
```bash
# Spremeni port v .env
OPENHANDS_PORT=3001
```

### Docker daemon ni dosegljiv
```bash
# Dodaj uporabnika v docker skupino
sudo usermod -aG docker $USER
# Nato se odjavi in prijavi ali:
newgrp docker
```

### GPU ni zaznana
```bash
# Namesti nvidia-container-toolkit
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker
```

### Sandbox se ne zazene
```bash
# Preveri docker loge
docker logs openbuild-openhands
# Preveri ali runtime image obstaja
docker images | grep runtime
```

### Ponastavi stanje
```bash
# Ustavi vse
docker compose down -v
# Izbrisi stanje
rm -rf workspace/ data/ .env
# Ponovno pozeni
./start.sh
```

## Runtime Executor

Glej [RUNTIME_EXECUTOR.md](RUNTIME_EXECUTOR.md) za podrobno dokumentacijo:
- Kako agent izvrsuje ukaze (client-server arhitektura)
- Katera orodja so registrirana in kako delujejo
- Kako so pravice nastavljene
- Odpravljanje tezav z izvrsevanjem

## Konfiguracija orodij (config/config.toml)

Vsa orodja so eksplicitno omogocena v `config/config.toml`:

| Orodje                | Nastavitev              | Vrednost |
|-----------------------|------------------------|---------|
| Shell/Bash            | `enable_cmd`           | `true`  |
| Urejevalnik datotek   | `enable_editor`        | `true`  |
| Brskalnik             | `enable_browsing`      | `true`  |
| Jupyter/IPython       | `enable_jupyter`       | `true`  |
| MCP orodja            | `enable_mcp`           | `true`  |
| Think                 | `enable_think`         | `true`  |
| Finish                | `enable_finish`        | `true`  |
| Confirmation mode     | `confirmation_mode`    | `false` |
| Browser               | `enable_browser`       | `true`  |

## Ustavitev

```bash
docker compose down
```

## Verzije

Glej [VERSION_MANIFEST.md](VERSION_MANIFEST.md) za tocne verzije vseh komponent.

## Preverjanja

Glej [CHECKS.md](CHECKS.md) za podroben opis vseh preverjanj, ki jih izvede `start.sh`.
