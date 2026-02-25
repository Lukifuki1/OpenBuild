# VERSION_MANIFEST.md — OpenBuild + OpenHands v0.62.0

## Pinned Versions

| Komponenta                    | Verzija / Tag           | Commit / Digest                                    |
|-------------------------------|-------------------------|----------------------------------------------------|
| OpenHands (submodule)         | 0.62.0                  | `7fbb48c40679afd674970966b96185657d92a487`         |
| OpenHands App Docker Image    | 0.62                    | `docker.openhands.dev/openhands/openhands:0.62`    |
| OpenHands Runtime Image       | 0.62-nikolaik           | `docker.openhands.dev/openhands/runtime:0.62-nikolaik` |
| openhands-ai (PyPI)           | 0.62.0                  | Vkljucen v App Docker Image                        |
| openhands-sdk (PyPI)          | 1.0.0a6                 | Vkljucen v App Docker Image                        |
| openhands-agent-server (PyPI) | 1.0.0a6                 | Vkljucen v App Docker Image                        |
| openhands-tools (PyPI)        | 1.0.0a6                 | Vkljucen v App Docker Image                        |
| openhands-aci (PyPI)          | 0.3.2                   | Vkljucen v App Docker Image                        |
| browsergym-core (PyPI)        | 0.13.3                  | Vkljucen v Runtime Docker Image                    |
| playwright (PyPI)             | ^1.55.0                 | Vkljucen v Runtime Docker Image                    |
| Docker Compose                | v2 (plugin)             | Zaznana ob zagonu                                  |

## Docker Image Registry

Vse slike so dostopne prek registra: `docker.openhands.dev`

- **App image**: `docker.openhands.dev/openhands/openhands:0.62`
  - Vsebuje: OpenHands app server, frontend UI (port 3000), CLI, SDK, agent server
  - Base: Python 3.12

- **Runtime image**: `docker.openhands.dev/openhands/runtime:0.62-nikolaik`
  - Vsebuje: Sandbox runtime, Python, Node.js, browsergym, playwright
  - Base: nikolaik/python-nodejs:python3.12-nodejs22
  - Namenjeno: ustvarjanje sandbox kontejnerjev za agenta

## Submodule

```
[submodule "third_party/openhands"]
    path = third_party/openhands
    url = https://github.com/All-Hands-AI/OpenHands.git
    branch = main
    # Pinned to tag 0.62.0, commit 7fbb48c40679afd674970966b96185657d92a487
```

## Python paket kompatibilnost

OpenHands v0.62.0 zahteva:
- Python >= 3.12, < 3.14
- Poetry >= 2.1.2 (za razvoj)

Za produkcijsko uporabo se uporabljajo Docker image-ji, ki ze vsebujejo vse odvisnosti.

## Posodobitev

Za posodobitev na novo verzijo OpenHands:
1. Posodobi submodule: `cd third_party/openhands && git fetch && git checkout <novi-tag>`
2. Posodobi image tage v `docker-compose.yml` in `.env.example`
3. Posodobi ta manifest
4. Pozeni `./start.sh` za validacijo
