# RUNTIME_EXECUTOR.md — Kako OpenHands izvrsuje ukaze

## Dvokomponentna arhitektura

OpenHands v0.62.0 ima **2 loceni runtime komponenti** (ne eno):

```
+-------------------------------+
|  1. APP CONTAINER             |
|     (openhands:0.62)          |
|                               |
|  - Frontend UI (port 3000)    |       Docker Socket
|  - Agent Logic (CodeActAgent) | =========================>  ustvari/upravlja
|  - Tool Registry              |                              efemerne sandbox-e
|  - LLM Client                 |
|  - Config Loader              |
|  - Container Lifecycle Mgr    |
+-------------------------------+
        |           ^
        | HTTP      | HTTP (port 11434)
        | WebSocket |
        v           v
+-------------------------------+    +-------------------+
|  2. EXECUTION CONTAINER(S)    |    |  Ollama Server    |
|     (runtime:0.62-nikolaik)   |    |  (host machine)   |
|     ** EFEMEREN — per-session  |    |  - qwen3-coder:30b|
|                               |    +-------------------+
|  - Runtime API Server         |
|  - /bin/bash                  |
|  - Python 3.12 + pip          |
|  - Node.js 22 + npm           |
|  - Playwright + Chromium      |
|  - Jupyter kernel             |
|  - Git                        |
|  - agent_skills plugin        |
+-------------------------------+
```

### Kljucna razlika

- **App container** je **staticen** — vedno tece (docker-compose.yml)
- **Execution container(i)** so **efemerni** — ustvarijo se per-task ali per-session
- Lahko jih je **vec hkrati** (vec uporabnikov, vec sej)
- **Lifecycle upravlja OpenHands backend** (ne Docker Compose)

To pomeni:
- **Cleanup**: Ko se seja konca, se execution container odstrani (razen ce `keep_runtime_alive = true`)
- **Volume mapping**: Workspace se montira v vsak execution container
- **State persistence**: Stanje je v app container-ju in workspace volumnu, ne v execution container-ju

## Runtime Image

### Kaj je `runtime:0.62-nikolaik`?

To je **uradni OpenHands runtime image**, zgrajen s strani OpenHands build sistema:

- **Base layer**: `nikolaik/python-nodejs:python3.12-nodejs22` (Python + Node.js)
- **OpenHands runtime layer**: Runtime API server, agent_skills, tool execution engine
- **Ni samo nikolaik image** — vsebuje celoten OpenHands runtime stack

Ce bi uporabili zgolj `nikolaik/python-nodejs` (brez OpenHands layer-ja):
- agent_skills ne bi delovali
- Runtime API ne bi obstajal
- WebSocket kanal ne bi bil vzpostavljen
- Tools se ne bi registrirali

Zato je `runtime:0.62-nikolaik` **obvezen** — to je uradni image s celotnim runtime stackom.

## Runtime API Handshake (KLJUCNO)

### Zakaj je handshake najpomembnejsi del?

Ko OpenHands ustvari execution container, se mora zgoditi **runtime API handshake**.
To je dejanski moment, ko execution zacne delovati.

### Koraki handshake-a

```
1. App container ustvari execution container prek Docker socket-a
2. Execution container se zazene
3. Runtime server ZNOTRAJ container-ja se inicializira
4. Runtime server odpre HTTP endpoint (interni port)
5. Runtime server registrira orodja (bash, editor, jupyter, browser, ...)
6. Runtime server poslje READY signal
7. App container prejme READY signal
8. WebSocket kanal med app in execution container se odpre
9. Izvrsevanje je pripravljeno
```

### Ce handshake ne uspe

Agent **vidi runtime**, ampak **execution ne deluje**.

To je **najpogostejsi razlog**, zakaj agent ne izvaja ukazov.

Preverjanje:
```bash
# Preveri loge app container-ja za handshake napake
docker logs openbuild-openhands 2>&1 | grep -i "runtime\|handshake\|ready\|timeout\|error"

# Preveri ali se execution container ustvari
docker ps -a | grep "openhands-runtime\|openhands-sandbox"

# Preveri loge execution container-ja
docker logs $(docker ps -a --filter "name=openhands" --format "{{.Names}}" | grep -v openbuild) 2>&1 | tail -20
```

Pogosti razlogi za neuspesen handshake:
- Runtime image ni prenesena (`docker pull` jo prenese)
- Docker socket ni dosegljiv v app container-ju
- Premalo RAM-a za zagon novega container-ja
- Port konflikti na internem omrezju
- Timeout pretek (privzeto 120s za lokalni runtime)

## 8 pogojev za izvrsevanje (VSI morajo biti resnični hkrati)

OpenHands lahko izvrsuje ukaze **SAMO** ce so **vsi** naslednji pogoji resnični hkrati:

| # | Pogoj                                        | Kako preveriti                                          | Konfiguracija                           |
|---|----------------------------------------------|---------------------------------------------------------|-----------------------------------------|
| 1 | Docker socket dosegljiv v app container-ju   | `docker exec openbuild-openhands ls /var/run/docker.sock` | docker-compose.yml: volume mount      |
| 2 | Execution container se ustvari               | `docker ps -a \| grep openhands`                         | runtime image prenesena                |
| 3 | Runtime server v execution container-ju se inicializira | `docker logs <exec-container>`                  | `initialize_plugins = true`            |
| 4 | Orodja registrirana (tools registry)         | config.toml: `enable_cmd`, `enable_editor`, itd.       | `[agent]` sekcija v config.toml        |
| 5 | WebSocket med app in execution container odprt | app container logi                                     | omrezna povezljivost                   |
| 6 | Workspace zapisljiv (writable)               | `docker exec <exec-container> touch /workspace/test`    | volume mount z rw pravicami            |
| 7 | LLM vrne action (ne samo text)               | model mora podpirati function calling                   | Qwen3-Coder:30B prek Ollama           |
| 8 | Confirmation mode izklopljen                 | config.toml: `confirmation_mode = false`                | `[security]` sekcija                   |

**Ce manjka SAMO ENA tocka, execution pade.**

## Trije implicitni execution state-i

OpenHands v0.62.0 formalno **nima** planning/execution flag-a.
Ampak v praksi obstajajo **3 implicitni execution state-i**:

### 1. POLNO IZVRSEVANJE (execution)
- Pogoji: Tools enabled + Runtime OK + LLM vraca actions
- Agent generira `CmdRunAction` → ukaz se izvrsi → rezultat se vrne
- **To je cilj nase konfiguracije**

### 2. PSEUDO PLANNING (tools enabled, runtime mrtev)
- Pogoji: Tools enabled + Runtime dead/unreachable
- Agent generira `CmdRunAction`, ampak **se nic ne zgodi**
- Izgleda kot da agent "razmislja" — v resnici execution ne deluje
- **Najpogostejsi failure mode** — tezko za diagnozo

### 3. REASONING ONLY (tools disabled)
- Pogoji: Tools disabled v config.toml
- Agent ne more generirati action-ov — samo text
- Uporabno samo za analizo, ne za izvrsevanje

### Kako prepoznati pseudo-planning state?

```bash
# V app container logih iscite:
docker logs openbuild-openhands 2>&1 | grep -i "action\|execute\|runtime\|error\|timeout"

# Znaki pseudo-planning:
# - Agent generira ukaze, a rezultatov ni
# - "RuntimeError" ali "ConnectionError" v logih
# - "Timeout waiting for runtime" v logih
# - Execution container ni viden v `docker ps`
```

## Orodja (Tooling Layer)

### Registrirana orodja

| Orodje                | Config kljuc          | Opis                                        | Zahteva runtime? |
|-----------------------|-----------------------|---------------------------------------------|-------------------|
| Shell/Bash            | `enable_cmd`          | Izvrsevanje ukazov v `/bin/bash`            | DA                |
| Urejevalnik datotek   | `enable_editor`       | Urejanje datotek (str_replace_editor)       | DA                |
| Brskalnik             | `enable_browsing`     | Brskanje po spletu (Playwright/BrowserGym)  | DA                |
| Jupyter/IPython       | `enable_jupyter`      | Interaktivno Python izvrsevanje             | DA                |
| Think                 | `enable_think`        | Razmisljanje brez akcije                    | NE                |
| Finish                | `enable_finish`       | Zakljucitev naloge                          | NE                |
| MCP                   | `enable_mcp`          | Model Context Protocol orodja               | DA                |

### Pomembno: `enable_cmd = true` NE pomeni da execution deluje

`enable_cmd = true` **samo omogoci orodje v agentu** (tool registry).
Ne pomeni, da agent dejansko **lahko** izvrsi ukaz.

Za dejansko izvrsevanje mora obstajati:
1. Runtime API endpoint (v execution container-ju)
2. Container lifecycle manager (v app container-ju)
3. WebSocket command bridge (med app in execution container-jem)

Ce runtime API ne odgovarja:
- Agent bo generiral `CmdRunAction`
- Ampak se **ne bo nic zgodilo**
- To je "pseudo-planning" state (opisano zgoraj)

## Pravice in politike (Permission/Policy)

### Confirmation mode

```toml
[security]
confirmation_mode = false    # Agent izvrsuje BREZ vprasevanja
```

Ce je `confirmation_mode = true`, mora uporabnik potrditi vsako akcijo v UI.
Za avtonomno delovanje MORA biti `false`.

**Dodatna opomba**: Tudi ce je `confirmation_mode = false`, lahko akcije se vedno blokira:
- Reverse proxy, ki filtrira WebSocket prometa
- CSP (Content Security Policy) na frontend-u, ki blokira runtime klic
- Neveljaven session token
- Omrezna politika (firewall med app in execution container-jem)

To ni config problem, ampak **network/runtime policy problem**.

### Workspace pravice in UID/GID

```yaml
volumes:
  - ./workspace:/opt/workspace_base    # Zapisljiv
```

**KRITICNA PODROBNOST**: Workspace mount deluje **samo ce**:
1. **UID/GID** v execution container-ju ustreza host UID/GID
2. **Filesystem** podpira inode locking (ext4: da, NFS: morda ne)
3. **SELinux/AppArmor** ne blokira dostopa

Ce UID/GID ne ustreza, se zgodijo:
- `permission denied` napake
- `git` ukazi ne delujejo
- `pip install` ne deluje
- Datoteke so ustvarjene z napacnim lastnikom

**Resitev** (v nasi konfiguraciji):
```toml
[core]
run_as_openhands = true              # Uporabi openhands uporabnika v sandbox-u

[sandbox]
user_id = 1000                        # Nastavi na vas host UID
```

`start.sh` avtomatsko zazna host UID in ga nastavi v konfiguraciji.

Za produkcijsko okolje je priporocen **named volume** namesto bind mount-a:
```yaml
volumes:
  openhands-workspace:
    name: openbuild-workspace
```

## Execution container lifecycle

### Ustvarjanje

1. Uporabnik zacne novo sejo v UI
2. App container prebere config.toml
3. Prek Docker socket-a ustvari nov execution container iz `runtime:0.62-nikolaik`
4. Montira workspace volumen
5. Inicializira plugine
6. Runtime API handshake (opisano zgoraj)
7. Seja je pripravljena

### Med sejo

- Execution container tece neprekinjeno
- Agent poslje ukaze prek WebSocket-a
- Runtime server v execution container-ju izvrsi ukaze
- Rezultati se vrnejo prek WebSocket-a

### Koncanje

- `keep_runtime_alive = false` (privzeto): Container se odstrani ob koncu seje
- `keep_runtime_alive = true`: Container ostane (za debugging)
- `pause_closed_runtimes = true`: Container se pavzira (ne odstrani)
- `close_delay = 3600`: Zakasnitev pred odstranitvijo (sekunde)

### Cleanup

```bash
# Preveri ali so ostali stari execution container-ji
docker ps -a | grep "openhands"

# Rocno ciscenje
docker rm -f $(docker ps -a --filter "name=openhands-runtime" -q) 2>/dev/null
docker rm -f $(docker ps -a --filter "name=openhands-sandbox" -q) 2>/dev/null
```

## Pogosti problemi in resitve

### 1. Agent ne izvrsuje ukazov (najpogostejsi problem)

**Vzrok**: Runtime API handshake ni uspel.

**Diagnostika**:
```bash
# 1. Preveri ali Docker socket deluje v app container-ju
docker exec openbuild-openhands ls /var/run/docker.sock

# 2. Preveri ali se execution container ustvari
docker ps -a | grep "openhands"

# 3. Preveri app container loge za handshake napake
docker logs openbuild-openhands 2>&1 | grep -i "runtime\|handshake\|ready\|error\|timeout"

# 4. Ce execution container obstaja, preveri njegove loge
EXEC_CONTAINER=$(docker ps -a --filter "name=openhands" --format "{{.Names}}" | grep -v openbuild | head -1)
if [[ -n "${EXEC_CONTAINER}" ]]; then
    docker logs "${EXEC_CONTAINER}" 2>&1 | tail -30
fi
```

**Resitve**:
1. Preveri Docker socket mount: `/var/run/docker.sock` v docker-compose.yml
2. Prenesi runtime image: `docker pull docker.openhands.dev/openhands/runtime:0.62-nikolaik`
3. Preveri RAM: execution container potrebuje vsaj 1-2 GiB
4. Preveri `[sandbox]` nastavitve v config.toml

### 2. Agent vidi okolje, a nima dovoljenja

**Vzrok**: Orodja niso omogocena v config.toml ALI runtime ni dosegljiv.

**Diagnostika**:
```bash
# Preveri config.toml
grep -E 'enable_(cmd|editor|browsing|jupyter|mcp)' config/config.toml

# Preveri ali je runtime dosegljiv
docker logs openbuild-openhands 2>&1 | grep -i "runtime\|connect"
```

### 3. Pseudo-planning state (agent "razmislja", a nic ne izvaja)

**Vzrok**: Tools so enabled, ampak runtime je mrtev.

**Diagnostika**: Glej "Kako prepoznati pseudo-planning state?" zgoraj.

**Resitev**: Ponastavi sejo, preveri runtime handshake.

### 4. Permission denied v workspace-u

**Vzrok**: UID/GID mismatch med host-om in execution container-jem.

**Diagnostika**:
```bash
# Na hostu
ls -la workspace/
id

# V app container-ju
docker exec openbuild-openhands id
```

**Resitev**: Nastavi `user_id` v config.toml na vas host UID (privzeto: 1000).

### 5. Sandbox timeout

**Vzrok**: Runtime image ni prenesena ali ni dovolj virov.

**Diagnostika**:
```bash
docker images | grep runtime
free -h
docker system df
```

**Resitev**: `docker pull docker.openhands.dev/openhands/runtime:0.62-nikolaik`

### 6. Brskalnik ne deluje

**Preverjanje**:
```bash
grep 'enable_browsing' config/config.toml
grep 'enable_browser' config/config.toml
```

Oba morata biti `true`:
```toml
[core]
enable_browser = true

[agent]
enable_browsing = true
```

### 7. Ollama ni dosegljiv iz container-ja

**Diagnostika**:
```bash
# Na hostu
curl http://localhost:11434/api/tags

# Iz app container-ja
docker exec openbuild-openhands curl -s http://host.docker.internal:11434/api/tags
```

**Resitev**:
1. Preveri da Ollama tece: `ollama serve`
2. Preveri `extra_hosts` v docker-compose.yml: `host.docker.internal:host-gateway`
3. Preveri model: `ollama pull qwen3-coder:30b`

### 8. WebSocket prekinitev

**Vzrok**: Reverse proxy ali firewall blokira WebSocket promet.

**Diagnostika**:
```bash
docker logs openbuild-openhands 2>&1 | grep -i "websocket\|ws\|disconnect"
```

**Resitev**: Preveri da nobena omrezna komponenta ne filtrira WebSocket prometa.
