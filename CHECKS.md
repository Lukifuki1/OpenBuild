# CHECKS.md — Kaj start.sh preverja

## Pregled sistemskih preverjanj

`start.sh` izvede naslednja preverjanja pred zagonom OpenHands v0.62.0.
Vsako preverjanje, ki ne uspe, povzroci takojsnji izhod z napako (exit code != 0).

## 1. Sistemski pregled

| Preverjanje               | Opis                                                | Kriticno |
|---------------------------|-----------------------------------------------------|----------|
| OS                        | Preveri da je Linux (uname -s)                      | Da       |
| Kernel verzija            | Zabeleži kernel verzijo (uname -r)                  | Ne       |
| CPU info                  | Model, stevilo niti (lscpu)                         | Ne       |
| RAM                       | Skupni in prosti RAM; minimum 4 GiB                 | Da       |
| Disk prostor              | Prosti prostor na particiji; minimum 10 GiB         | Da       |
| Datotecni sistem          | Zabeleži tip FS (ext4, btrfs, ...)                  | Ne       |

## 2. Odvisnosti

| Odvisnost                 | Preverjanje                                         | Avto-namestitev |
|---------------------------|-----------------------------------------------------|-----------------|
| git                       | `command -v git`                                    | Da (apt)        |
| curl                      | `command -v curl`                                   | Da (apt)        |
| jq                        | `command -v jq`                                     | Da (apt)        |
| openssl                   | `command -v openssl`                                | Da (apt)        |
| ca-certificates           | Obstoj `/etc/ssl/certs/ca-certificates.crt`         | Da (apt)        |
| docker                    | `command -v docker` + daemon dosegljivost           | Da (apt)        |
| docker compose            | Plugin (`docker compose`) ali standalone             | Da (apt)        |

## 3. Omrezje

| Preverjanje               | Opis                                                | Kriticno |
|---------------------------|-----------------------------------------------------|----------|
| Port konflikti            | Preveri ali je port 3000 (ali OPENHANDS_PORT) prost | Da       |
| iptables pravila          | Zabeleži stevilo pravil                             | Ne       |
| nftables pravila          | Zabeleži stevilo pravil                             | Ne       |

## 4. GPU zaznava

| Preverjanje               | Opis                                                | Kriticno |
|---------------------------|-----------------------------------------------------|----------|
| NVIDIA: nvidia-smi        | Zazna prisotnost NVIDIA GPU                         | Ne       |
| NVIDIA: container-toolkit | Preveri nvidia-container-toolkit namestitev          | Ne       |
| NVIDIA: Docker GPU test   | `docker run --gpus all nvidia/cuda:...`             | Ne       |
| AMD: /dev/dri             | Zazna render naprave                                | Ne       |
| AMD: rocm-smi             | Preveri ROCm namestitev                             | Ne       |
| Fallback                  | Ce GPU ni na voljo, deluje v CPU nacinu             | -        |

## 5. Konfiguracija

| Preverjanje               | Opis                                                | Kriticno |
|---------------------------|-----------------------------------------------------|----------|
| .env generiranje          | Ustvari .env iz .env.example z varnimi skrivnostmi  | Da       |
| JWT_SECRET                | Generira z `openssl rand -hex 32`                   | Da       |
| LLM nastavitve            | Nastavi Ollama/Qwen3-Coder:30B privzete vrednosti   | Da       |
| .env nalaganje            | Source .env v okolje                                 | Da       |

## 5b. config.toml validacija (Runtime, Orodja, Pravice)

| Preverjanje               | Opis                                                | Kriticno |
|---------------------------|-----------------------------------------------------|----------|
| config.toml obstaja       | Preveri obstoj in berljivost datoteke               | Da       |
| runtime = "docker"        | Preveri da je runtime nastavljen na docker           | Da       |
| enable_cmd                | Shell/Bash orodje omogoceno                          | Da       |
| enable_editor             | Urejevalnik datotek omogocen                         | Da       |
| enable_browsing           | Brskalnik (Playwright) omogocen                      | Da       |
| enable_jupyter            | Jupyter/IPython omogocen                             | Da       |
| enable_mcp                | MCP orodja omogocena                                 | Da       |
| enable_think              | Think orodje omogoceno                               | Da       |
| enable_finish             | Finish orodje omogoceno                              | Da       |
| confirmation_mode         | Mora biti false (polno izvrsevanje)                  | Da       |
| enable_browser            | Brskalnik v [core] sekciji omogocen                  | Da       |
| initialize_plugins        | Inicializacija pluginov omogocena                    | Da       |

## 6. Ollama povezljivost

| Preverjanje               | Opis                                                | Kriticno |
|---------------------------|-----------------------------------------------------|----------|
| Ollama dosegljivost       | HTTP request na Ollama /api/tags endpoint            | Ne*      |
| Model prisotnost          | Preveri ali qwen3-coder:30b obstaja v Ollama        | Ne*      |

\* Opozorilo, ne blokira zagon. Agent ne bo deloval brez Ollama/modela.

## 7. Direktoriji in volumni

| Preverjanje               | Opis                                                | Kriticno |
|---------------------------|-----------------------------------------------------|----------|
| workspace/                | Ustvari ce ne obstaja, chmod 755                    | Da       |
| data/                     | Ustvari ce ne obstaja, chmod 755                    | Da       |
| ~/.openhands/             | Ustvari ce ne obstaja, chmod 755                    | Da       |

## 8. Docker Image-ji

| Image                     | Akcija                                              | Kriticno |
|---------------------------|-----------------------------------------------------|----------|
| openhands:0.62            | `docker pull` + zabeleži digest                     | Da       |
| runtime:0.62-nikolaik     | `docker pull` + zabeleži digest                     | Da       |

## 9. Docker Compose zagon + Smoke test

| Preverjanje               | Opis                                                | Kriticno |
|---------------------------|-----------------------------------------------------|----------|
| Stack zagon               | `docker compose up -d`                              | Da       |
| Healthcheck               | Caka do 120s za "healthy" status                    | Da       |
| Unhealthy zaznava         | Izpise loge in zakljuci ce "unhealthy"              | Da       |
| HTTP endpoint             | `curl` na http://localhost:3000/                    | Da       |
| Pricakovani HTTP kodi     | 200 ali 302 = uspeh                                 | Da       |

## 10. Runtime executor validacija

| Preverjanje               | Opis                                                | Kriticno |
|---------------------------|-----------------------------------------------------|----------|
| Docker socket v kontejnerju | `docker exec` preveri /var/run/docker.sock         | Ne*      |
| config.toml montiran      | Preveri /.openhands/config.toml v kontejnerju        | Ne*      |
| Workspace zapisljiv       | Preveri /opt/workspace_base zapisljivost             | Ne*      |

\* Opozorilo, ne blokira zagon. Agent morda ne bo mogel izvrsevati vseh akcij.

## Exit kode

| Koda | Pomen                                    |
|------|------------------------------------------|
| 0    | Vse uspesno, sistem je pripravljen       |
| 1    | Napaka — preveri izpis in start.log      |
