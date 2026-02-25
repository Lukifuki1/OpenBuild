# RUNTIME_EXECUTOR.md — Kako OpenHands izvrsuje ukaze

## Arhitektura

OpenHands v0.62.0 uporablja **client-server arhitekturo** za izvrsevanje ukazov:

```
+-------------------+       Docker Socket        +---------------------+
|  OpenHands App    | =========================> |  Sandbox Container  |
|  (openhands:0.62) |       ustvari/upravlja     |  (runtime:0.62-     |
|                   |                             |   nikolaik)         |
|  - Frontend UI    |       HTTP/WebSocket        |                     |
|  - Agent Server   | <========================> |  - /bin/bash        |
|  - LLM Client     |       ukazi/rezultati       |  - Python 3.12     |
|  - Config Loader  |                             |  - Node.js 22      |
+-------------------+                             |  - Playwright       |
        |                                         |  - Jupyter          |
        | HTTP (port 11434)                       |  - Git              |
        v                                         +---------------------+
+-------------------+
|  Ollama Server    |
|  (host machine)   |
|  - qwen3-coder:30b|
+-------------------+
```

### Tok izvrsevanja

1. Uporabnik poslje nalogo prek UI (port 3000)
2. Agent Server poslje prompt na LLM (Ollama/Qwen3-Coder:30B)
3. LLM vrne akcijo (npr. `CmdRunAction`, `FileEditAction`, `BrowseURLAction`)
4. Agent Server poslje akcijo na **Sandbox Container** prek runtime API
5. Sandbox Container izvrsi akcijo in vrne rezultat
6. Agent Server poslje rezultat nazaj LLM-ju
7. Cikel se ponavlja do zakljucka naloge

## Runtime Executor (Sandbox)

### Kaj je runtime executor?

Runtime executor je **sandbox kontejner**, ki ga OpenHands ustvari prek Docker socket-a.
Ta kontejner vsebuje celotno izvrsevalno okolje za agenta:

- `/bin/bash` — shell za izvrsevanje ukazov
- Python 3.12 + pip — za Python projekte
- Node.js 22 + npm — za JavaScript projekte
- Git — za verzioniranje
- Playwright + Chromium — za brskanje po spletu
- Jupyter kernel — za interaktivno Python izvrsevanje

### Kako se ustvari?

1. OpenHands App prebere konfiguracijo iz `config.toml`
2. Prek Docker socket-a (`/var/run/docker.sock`) ustvari nov kontejner
3. Uporabi image: `docker.openhands.dev/openhands/runtime:0.62-nikolaik`
4. Montira workspace volumen
5. Inicializira plugine (Jupyter, agent_skills)
6. Vzpostavi HTTP/WebSocket povezavo za komunikacijo

### Kljucne nastavitve v config.toml

```toml
[core]
runtime = "docker"                    # Uporabi Docker za sandbox
run_as_openhands = true               # Pravilne pravice v sandbox-u

[sandbox]
base_container_image = "nikolaik/python-nodejs:python3.12-nodejs22"
initialize_plugins = true             # Inicializiraj Jupyter, agent_skills
timeout = 120                         # Timeout za posamezno akcijo (sekunde)
```

## Orodja (Tooling Layer)

### Registrirana orodja

OpenHands v0.62.0 ima naslednja orodja, ki jih agent lahko uporabi:

| Orodje                | Config kljuc          | Opis                                        |
|-----------------------|-----------------------|---------------------------------------------|
| Shell/Bash            | `enable_cmd`          | Izvrsevanje ukazov v `/bin/bash`            |
| Urejevalnik datotek   | `enable_editor`       | Urejanje datotek (str_replace_editor)       |
| Brskalnik             | `enable_browsing`     | Brskanje po spletu (Playwright/BrowserGym)  |
| Jupyter/IPython       | `enable_jupyter`      | Interaktivno Python izvrsevanje             |
| Think                 | `enable_think`        | Razmisljanje brez akcije                    |
| Finish                | `enable_finish`       | Zakljucitev naloge                          |
| MCP                   | `enable_mcp`          | Model Context Protocol orodja               |

### Kako so orodja registrirana?

Orodja so registrirana v `[agent]` sekciji config.toml:

```toml
[agent]
enable_cmd = true          # Shell/Bash
enable_editor = true       # Urejevalnik datotek
enable_browsing = true     # Brskalnik
enable_jupyter = true      # Jupyter/IPython
enable_think = true        # Razmisljanje
enable_finish = true       # Zakljucitev
enable_mcp = true          # MCP orodja
```

Ce orodje ni omogoceno, agent **vidi okolje, ampak nima dovoljenja za akcijo**.

## Pravice in politike (Permission/Policy)

### Execution mode

OpenHands v0.62.0 **nima** posebnega "planning mode" ali "analysis-only mode" na ravni runtime-a.
Agent privzeto deluje v **polnem execution mode**.

### Confirmation mode

```toml
[security]
confirmation_mode = false    # Agent izvrsuje BREZ vprasevanja
```

Ce je `confirmation_mode = true`, mora uporabnik potrditi vsako akcijo v UI.
Za avtonomno delovanje MORA biti `false`.

### Varnostni analizator

```toml
[security]
# security_analyzer = ""    # Brez omejitev
```

Moznosti:
- `""` ali odsotno — brez omejitev (polne pravice)
- `"invariant"` — invariant analyzer (blokira nevarne akcije)

Za polno izvrsevanje pustite prazno ali ne nastavite.

### Workspace pravice

Workspace volumen je montiran z `rw` pravicami:
```yaml
volumes:
  - ./workspace:/opt/workspace_base    # Zapisljiv
```

Agent lahko:
- Ustvarja, ureja, brise datoteke
- Namesca pakete
- Zaganja projekte
- Uporablja git

## Pogosti problemi in resitve

### Agent ne izvrsuje ukazov

**Vzrok**: Runtime executor (sandbox kontejner) se ne ustvari.

**Preverjanje**:
```bash
# Preveri ali Docker socket deluje
docker exec openbuild-openhands ls /var/run/docker.sock

# Preveri loge
docker logs openbuild-openhands
```

**Resitev**: Preveri da je `/var/run/docker.sock` montiran v docker-compose.yml.

### Agent vidi okolje, a nima dovoljenja

**Vzrok**: Orodja niso omogocena v config.toml.

**Preverjanje**:
```bash
# Preveri config.toml
grep 'enable_cmd' config/config.toml
grep 'enable_editor' config/config.toml
```

**Resitev**: Nastavi vsa `enable_*` polja na `true` v `[agent]` sekciji.

### Agent je v "planning mode"

**Vzrok**: `confirmation_mode = true` v `[security]` sekciji.

**Resitev**:
```toml
[security]
confirmation_mode = false
```

### Sandbox se ne zazene (timeout)

**Vzrok**: Runtime image ni prenesena ali Docker nima dovolj virov.

**Preverjanje**:
```bash
# Preveri ali image obstaja
docker images | grep runtime

# Prenesi ce manjka
docker pull docker.openhands.dev/openhands/runtime:0.62-nikolaik
```

### Brskalnik ne deluje

**Vzrok**: `enable_browsing` ali `enable_browser` ni nastavljen na `true`.

**Preverjanje**:
```bash
grep 'enable_browsing' config/config.toml
grep 'enable_browser' config/config.toml
```

**Resitev**: Oba morata biti `true`:
```toml
[core]
enable_browser = true

[agent]
enable_browsing = true
```

### Ollama ni dosegljiv iz kontejnerja

**Vzrok**: `host.docker.internal` ne deluje ali Ollama ne tece.

**Preverjanje**:
```bash
# Na hostu
curl http://localhost:11434/api/tags

# Iz kontejnerja
docker exec openbuild-openhands curl http://host.docker.internal:11434/api/tags
```

**Resitev**:
1. Preveri da Ollama tece: `ollama serve`
2. Preveri da je `extra_hosts` nastavljen v docker-compose.yml
3. Preveri da je model prisoten: `ollama pull qwen3-coder:30b`
