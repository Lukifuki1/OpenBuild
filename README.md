# OpenBuild — OpenHands z Ollama

Avtomatski setup za [OpenHands](https://github.com/OpenHands/OpenHands) z lokalno Ollama + GPU podporo.

## Zahteve

- **Ubuntu** 22.04+ (testirano na 24.04)
- **Docker** (z Docker socket dostopom)
- **Ollama** z modelom `qwen3-coder:30b`
- **NVIDIA GPU** (priporoceno za hitrejse delovanje)

## Hitri zagon

```bash
git clone git@github.com:Lukifuki1/OpenBuild.git
cd OpenBuild
chmod +x start.sh
./start.sh
```

Skript bo:
1. Preveril Docker in Ollama
2. Prenesel model ce manjka
3. Namestil `uv` in `openhands` (samo prvic)
4. Zagnal OpenHands na **http://localhost:3000**

## Prvic: Nastavitve v UI

1. Odpri http://localhost:3000
2. Klikni **Settings** (zobnik ikona)
3. Vklopi **Advanced** stikalo
4. Nastavi:
   - **Custom Model:** `openai/qwen3-coder:30b`
   - **Base URL:** `http://host.docker.internal:11434/v1`
   - **API Key:** `dummy`
5. Shrani nastavitve

## Ukazi

| Ukaz | Opis |
|------|------|
| `./start.sh` | Zazeni OpenHands |
| `./start.sh --stop` | Ustavi OpenHands |
| `./start.sh --upgrade` | Posodobi na najnovejso verzijo |
| `./start.sh --clean` | Odstrani vse (openhands, state) |

## Ollama kontekst

OpenHands zahteva velik kontekst. Ce agent ne deluje pravilno:

```bash
# Ustavi Ollamo in jo ponovno zazeni z vecjim kontekstom:
sudo systemctl stop ollama
OLLAMA_CONTEXT_LENGTH=32768 OLLAMA_HOST=0.0.0.0:11434 OLLAMA_KEEP_ALIVE=-1 ollama serve
```

## Workspace

Datoteke ki jih agent ustvari so v `~/workspace/`.
