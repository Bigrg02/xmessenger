# xMessage

Personal AI character texting app. iMessage aesthetic. Runs on Unraid, accessed on iPhone via Tailscale.

**GitHub**: https://github.com/Bigrg02/xmessenger (private)

---

## What It Does

- Opens to a character list that looks exactly like iOS Messages
- Tap a character to open a conversation — chat bubbles, typing indicator, timestamps
- LLM (via OpenRouter) responds as the character in structured JSON that drives all side effects
- Async image generation via ComfyUI — images arrive in the thread when ready
- Device control via Intiface Central — vibration intensity maps to conversation tone
- Phase handover: conversation can transition to a device-control mode with push-to-talk voice input
- Audio clips play from per-character libraries based on the moment
- Emergency STOP button always visible; also triggered by Escape key

---

## Stack

- **Backend**: Node.js + Express
- **Database**: SQLite (better-sqlite3)
- **Frontend**: Vanilla JS, mobile-first CSS (no frameworks)
- **LLM**: OpenRouter API (model configurable per character)
- **Images**: ComfyUI (async, character workflow per card)
- **Devices**: Intiface Central via raw WebSocket (Buttplug protocol)
- **STT**: faster-whisper-server (OpenAI-compatible API)
- **Deployment**: Docker on Unraid

---

## Prerequisites

These services need to be running (on the same machine or reachable on your network):

| Service | Default URL | Purpose |
|---|---|---|
| [Intiface Central](https://intiface.com/central/) | `ws://localhost:12345` | Device control (Edge 2, Gush 2) |
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI) | `http://localhost:8188` | Image generation |
| [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) | `http://localhost:8000` | Speech-to-text (push-to-talk) |
| [OpenRouter](https://openrouter.ai) | API key in `.env` | LLM backend |

xMessage runs fine without any of these — it degrades gracefully:
- No Intiface → device features disabled, everything else works
- No ComfyUI → no image generation, conversation continues
- No Whisper → PTT button doesn't appear, text input still works
- No OpenRouter key → messages send but get an error response

---

## Running Locally

```bash
git clone https://github.com/Bigrg02/xmessenger.git
cd xmessenger

npm install

cp .env.example .env
# Edit .env — at minimum set OPENROUTER_API_KEY

node scripts/build-character.js --name "YourCharacter"
# Fill in characters/yourcharacter/card.json

npm start
# → http://localhost:3000
```

Open in any browser. On your phone (same WiFi), go to `http://YOUR_PC_IP:3000`.

---

## Deploying to Unraid

### Step 1 — SSH into Unraid and clone the repo

```bash
cd /mnt/user/appdata
git clone https://github.com/Bigrg02/xmessenger.git xmessenger
cd xmessenger
```

### Step 2 — Create your .env

```bash
cp .env.example .env
nano .env
```

Fill in your real values:
```
OPENROUTER_API_KEY=sk-or-v1-your-key-here
COMFYUI_BASE_URL=http://YOUR_UNRAID_IP:8188
INTIFACE_WS_URL=ws://YOUR_UNRAID_IP:12345
WHISPER_API_URL=http://YOUR_UNRAID_IP:8000
PORT=3000
```

> Use your Unraid server's LAN IP (e.g. `192.168.1.x`) for the service URLs, not `localhost` — the Docker container can't reach `localhost` on the host.

### Step 3 — Build the Docker image

```bash
docker build -t xmessenger:latest .
```

This takes 2–4 minutes the first time (compiles native SQLite module).

### Step 4 — Add as an Unraid Docker container (UI method)

1. Unraid UI → **Docker** tab → **Add Container**
2. Fill in these fields:

   | Field | Value |
   |---|---|
   | Name | `xmessenger` |
   | Repository | `xmessenger:latest` |
   | Network Type | `Bridge` |
   | Extra Parameters | `--add-host=host.docker.internal:host-gateway` |

3. Click **Add another Path, Port, Variable, Label or Device** for each of these:

   **Ports:**
   | Config Type | Name | Host Port | Container Port |
   |---|---|---|---|
   | Port | Web UI | 3000 | 3000 |

   **Paths:**
   | Config Type | Name | Host Path | Container Path |
   |---|---|---|---|
   | Path | Characters | `/mnt/user/appdata/xmessenger/characters` | `/app/characters` |
   | Path | Data | `/mnt/user/appdata/xmessenger/data` | `/app/data` |

   **Variables:**
   | Config Type | Name | Key | Value |
   |---|---|---|---|
   | Variable | OpenRouter Key | `OPENROUTER_API_KEY` | your key |
   | Variable | ComfyUI URL | `COMFYUI_BASE_URL` | `http://YOUR_UNRAID_IP:8188` |
   | Variable | Intiface URL | `INTIFACE_WS_URL` | `ws://YOUR_UNRAID_IP:12345` |
   | Variable | Whisper URL | `WHISPER_API_URL` | `http://YOUR_UNRAID_IP:8000` |

4. Click **Apply**

### Step 4 (alternative) — Run directly with docker run

```bash
docker run -d \
  --name xmessenger \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file /mnt/user/appdata/xmessenger/.env \
  -v /mnt/user/appdata/xmessenger/characters:/app/characters \
  -v /mnt/user/appdata/xmessenger/data:/app/data \
  --add-host=host.docker.internal:host-gateway \
  xmessenger:latest
```

### Step 5 — Copy your characters over

```bash
# From your PC, copy the characters folder to Unraid via SCP:
scp -r ./characters/yourcharacter root@UNRAID_IP:/mnt/user/appdata/xmessenger/characters/

# Or map a share in Windows Explorer and drag/drop:
# \\UNRAID_IP\appdata\xmessenger\characters\
```

---

## Updating (after pushing changes from your PC)

```bash
# On your PC — make changes, then:
git add -A && git commit -m "your changes"
git push

# On Unraid (SSH):
cd /mnt/user/appdata/xmessenger
git pull
docker build -t xmessenger:latest .
docker restart xmessenger
```

Takes about 60 seconds total after the first build (layer caching).

---

## Accessing on iPhone via Tailscale

1. Install [Tailscale](https://tailscale.com/) on your Unraid server and your iPhone
2. Log in to the same Tailscale account on both
3. On iPhone, open Safari → `http://UNRAID-TAILSCALE-IP:3000`
4. Tap **Share → Add to Home Screen** — it will behave like a native app

> **Tip**: Enable MagicDNS in the Tailscale admin console so you can use a hostname like `http://unraid:3000` instead of the IP.

---

## Creating a Character

```bash
node scripts/build-character.js --name "Sara" --images ./reference-photos/
```

Creates `characters/sara/` with the full directory structure. Then edit `characters/sara/card.json`:

```json
{
  "name": "Sara",
  "avatar": "reference.png",
  "accent_color": "#ff6b9d",
  "model": "openai/gpt-4o",
  "personality": "...",
  "texting_style": "...",
  "scenario": "...",
  "first_message": "...",
  "appearance_prompt": "ComfyUI positive prompt describing her appearance",
  "comfyui_workflow": "comfyui/workflow.json",
  "device_phase_style": "Short reactive texts only, max 6 words."
}
```

**Required fields:**
- `personality` — who she is, how she relates to the user, specific traits
- `texting_style` — sentence length, emoji use, punctuation habits, energy
- `scenario` — current situation, relationship context
- `first_message` — her opening text when a new conversation starts
- `appearance_prompt` — ComfyUI prompt for image generation (describe her appearance)
- `model` — OpenRouter model ID (run the model tester first)
- `accent_color` — hex color used for her chat bubbles

**Audio clips** — drop MP3/WAV files into `characters/sara/audio/{category}/`. See `characters/sara/audio/README.md` for what goes in each folder.

**ComfyUI workflow** — export your workflow from ComfyUI as API format (Workflow menu → Export API), replace `characters/sara/comfyui/workflow.json`. The app injects the character's `appearance_prompt` + scene description into any `CLIPTextEncode` node whose title contains "positive" or "prompt".

---

## Testing Models

Before your first real session, find out which OpenRouter model works best:

```bash
node scripts/test-models.js --models "openai/gpt-4o,anthropic/claude-3-haiku-20240307,mistralai/mistral-7b-instruct"
```

Sends 3 escalating prompts to each model, scores them on:
- **JSON compliance** (1–5) — critical, the whole system depends on this
- **Quality** (1–5)
- **Disclaimer count** — how often it refuses or adds warnings

Saves full results to `test-results.json`.

---

## How the LLM Response Works

Every message from the character must be valid JSON:

```json
{
  "message": "her text here",
  "image_request": { "send": false, "scene": "" },
  "device_intent": "neutral",
  "audio_category": "none",
  "phase_trigger": null
}
```

| Field | Options | Effect |
|---|---|---|
| `device_intent` | `neutral` `teasing` `building` `intense` `cooling` | Sets vibration intensity |
| `audio_category` | `encouragement` `reactive` `checking_in` `edging` `climax` `aftercare` `none` | Plays random clip from that folder |
| `image_request.send` | `true` / `false` | Triggers async ComfyUI generation |
| `phase_trigger` | `"handover"` / `null` | Transitions to device phase |

---

## Device Intensity Map

| Intent | Edge 2 | Gush 2 |
|---|---|---|
| `neutral` | 20% | 15% |
| `teasing` | 35% | 30% |
| `building` | 55% | 50% |
| `intense` | 80% | 75% |
| `cooling` | 10% | 10% |

Transitions are smoothed over 3 seconds. The STOP button (or Escape key) immediately zeros both devices.

---

## Voice Commands (Device Phase)

During device phase, voice input is processed for intent *before* the LLM call so devices respond immediately:

| You say | Effect |
|---|---|
| "more", "harder", "up" | +15% intensity on both |
| "less", "softer", "down" | −15% intensity on both |
| "cock", "front" | target Gush 2 specifically |
| "ass", "plug", "back" | target Edge 2 specifically |
| "stop", "pause" | immediate stop |
| "too much", "too intense" | switch to cooling intent |
| "close", "so close" | no device change (LLM reacts) |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | **required** | From openrouter.ai |
| `COMFYUI_BASE_URL` | `http://localhost:8188` | ComfyUI server |
| `INTIFACE_WS_URL` | `ws://localhost:12345` | Intiface Central |
| `WHISPER_API_URL` | `http://localhost:8000` | faster-whisper server |
| `PORT` | `3000` | App port |

---

## Troubleshooting

**Intiface not connecting**
- Open Intiface Central and make sure the server is started (green Start button)
- Default port is 12345 — confirm it matches `INTIFACE_WS_URL`
- From Docker, use `ws://host.docker.internal:12345` not `ws://localhost:12345`
- xMessage retries every 15 seconds — watch server logs for `[devices]` lines

**ComfyUI not generating images**
- Images are async and can take up to 3 minutes — check `[images]` in server logs
- Workflow must be exported as **API format** from ComfyUI (not the default export)
- Confirm your workflow has a `CLIPTextEncode` node with "positive" or "prompt" in its title
- Test ComfyUI directly at `http://YOUR_IP:8188` to confirm it's reachable

**Whisper / PTT not working**
- PTT only appears in device phase — it won't show during normal text chat
- Test Whisper: `curl -X POST http://localhost:8000/v1/audio/transcriptions -F file=@test.mp3 -F model=whisper-1`
- Browser must have microphone permission — tap Allow when prompted

**No LLM response / messages stuck**
- Check `OPENROUTER_API_KEY` is correct and has credits at openrouter.ai
- The `model` field in `card.json` must be a valid OpenRouter model ID
- Run `node scripts/test-models.js` to confirm a model works before using it in a session

**Character not showing in list**
- `characters/{name}/card.json` must exist and be valid JSON
- All required fields must be present: `name`, `avatar`, `model`, `personality`, `first_message`
- Restart the server after adding a new character

**Docker can't reach Intiface/ComfyUI/Whisper**
- Add `--add-host=host.docker.internal:host-gateway` to your docker run command
- Use `host.docker.internal` instead of `localhost` in all service URLs in `.env`

---

## Project Structure

```
xmessenger/
├── server.js                    # Entry point
├── src/
│   ├── db/index.js              # SQLite schema + all queries
│   ├── modules/
│   │   ├── llmClient.js         # OpenRouter API, prompt building, JSON parsing
│   │   ├── sessionManager.js    # Context window, summarization trigger
│   │   ├── deviceManager.js     # Intiface WebSocket, smooth transitions, stop
│   │   ├── imageGenerator.js    # ComfyUI submit → poll → download → serve
│   │   ├── audioManager.js      # Random clip selection, no-repeat logic
│   │   ├── intentDetector.js    # Voice command parsing (no LLM needed)
│   │   └── sseManager.js        # Server-sent events registry
│   └── routes/
│       ├── characters.js        # GET /api/characters, /api/characters/:name/card
│       ├── sessions.js          # POST/GET /api/sessions
│       ├── messages.js          # POST /api/sessions/:id/messages + SSE stream
│       ├── devices.js           # POST /api/devices/stop, /intent
│       ├── audio.js             # GET /api/audio/:character/:category/random
│       └── stt.js               # POST /api/stt (Whisper proxy)
├── public/
│   ├── index.html               # Single-page app shell
│   ├── css/styles.css           # iMessage aesthetic, dark mode, safe areas
│   └── js/
│       ├── app.js               # Screen routing, character list, SSE client
│       ├── chat.js              # Bubble rendering, send logic, phase UI
│       └── ptt.js               # MediaRecorder, hold-to-talk, Whisper upload
├── characters/{name}/
│   ├── card.json                # Character definition
│   ├── reference.png            # Avatar image
│   ├── audio/{category}/*.mp3   # Pre-baked audio clips
│   └── comfyui/workflow.json    # ComfyUI API-format workflow
├── scripts/
│   ├── build-character.js       # Scaffolds a new character directory
│   └── test-models.js           # Benchmarks OpenRouter models
├── data/                        # Runtime data (gitignored)
│   ├── xmessenger.db            # SQLite database
│   └── images/                  # Generated images served to frontend
├── Dockerfile
├── docker-compose.yml
└── .env.example
```
