# xMessage

Personal AI character texting app — iMessage aesthetic, runs on Unraid, accessible via Tailscale on iPhone.

---

## Prerequisites

These services must be running on the same machine as xMessage (or reachable on your network):

| Service | Default URL | Purpose |
|---|---|---|
| [Intiface Central](https://intiface.com/central/) | `ws://localhost:12345` | Device control (Edge 2, Gush 2) |
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI) | `http://localhost:8188` | AI image generation |
| [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) | `http://localhost:8000` | Speech-to-text for push-to-talk |
| [OpenRouter](https://openrouter.ai) | API key required | LLM backend |

---

## Quick Start (local)

```bash
cp .env.example .env
# Edit .env with your OPENROUTER_API_KEY and service URLs

npm install
node scripts/build-character.js --name "Sara"
# Fill in characters/sara/card.json

npm start
# Open http://localhost:3000 in browser
```

---

## Docker (Unraid)

### Build and run

```bash
cp .env.example .env
# Edit .env

docker compose up -d
```

### Manual Docker run

```bash
docker build -t xmessenger .

docker run -d \
  --name xmessenger \
  --restart unless-stopped \
  -p 3000:3000 \
  -v /mnt/user/appdata/xmessenger/characters:/app/characters \
  -v /mnt/user/appdata/xmessenger/data:/app/data \
  -e OPENROUTER_API_KEY=sk-or-v1-... \
  -e COMFYUI_BASE_URL=http://YOUR_UNRAID_IP:8188 \
  -e INTIFACE_WS_URL=ws://YOUR_UNRAID_IP:12345 \
  -e WHISPER_API_URL=http://YOUR_UNRAID_IP:8000 \
  --add-host=host.docker.internal:host-gateway \
  xmessenger
```

---

## Adding to Unraid Community Applications (Custom App)

1. In Unraid, go to **Apps** → **Install** → scroll to bottom → **Click here to get more results from DockerHub** (or use the XML method below)

2. Go to **Docker** tab → **Add Container** and fill in:

   | Field | Value |
   |---|---|
   | Name | xmessenger |
   | Repository | your-dockerhub-user/xmessenger (or local image name) |
   | Network Type | Bridge |
   | Port | Host: `3000` → Container: `3000` |
   | Volume 1 | Host: `/mnt/user/appdata/xmessenger/characters` → Container: `/app/characters` |
   | Volume 2 | Host: `/mnt/user/appdata/xmessenger/data` → Container: `/app/data` |

3. Add environment variables (click **Add another Path, Port, Variable, Label or Device**):
   - `OPENROUTER_API_KEY` = your key
   - `COMFYUI_BASE_URL` = `http://YOUR_UNRAID_IP:8188`
   - `INTIFACE_WS_URL` = `ws://YOUR_UNRAID_IP:12345`
   - `WHISPER_API_URL` = `http://YOUR_UNRAID_IP:8000`

4. Click **Apply**

---

## Accessing via Tailscale on iPhone

1. Install [Tailscale](https://tailscale.com/) on both your Unraid server and iPhone
2. Log in to the same Tailscale account on both devices
3. In Tailscale, find your Unraid machine's Tailscale IP (e.g. `100.x.x.x`)
4. On iPhone, open Safari and go to `http://100.x.x.x:3000`
5. Tap **Share → Add to Home Screen** for an app-like experience

> **Tip**: In Tailscale admin console, enable MagicDNS so you can use `http://unraid:3000` instead of the IP.

---

## Creating Your First Character

```bash
node scripts/build-character.js --name "Sara" --images ./sara-photos/
```

This creates `characters/sara/` with:
- `card.json` — fill in all TODO fields
- `comfyui/workflow.json` — replace with your exported ComfyUI workflow (API format)
- `audio/` — drop MP3 clips into each category folder (see `audio/README.md`)
- `reference.png` — your character's reference image

**Required card.json fields to fill:**
- `personality` — who she is, how she talks, her relationship with the user
- `texting_style` — sentence length, emoji use, abbreviations, tone
- `scenario` — the current situation/context
- `first_message` — her opening text
- `appearance_prompt` — ComfyUI positive prompt for image generation
- `model` — OpenRouter model ID (run model tester first)
- `accent_color` — hex color for her chat bubbles

---

## Running the Model Tester

Before your first session, test which model works best for your character:

```bash
node scripts/test-models.js --models "openai/gpt-4o,anthropic/claude-3-haiku-20240307,mistralai/mistral-7b-instruct"
```

This sends 3 escalating test prompts to each model and scores:
- **JSON compliance** (1–5): Does it output valid JSON every time?
- **Quality** (1–5): Are the responses good?
- **Disclaimers** (0–3): How often does it refuse or add warnings?

Results are printed as a table and saved to `test-results.json`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | required | Your OpenRouter API key from openrouter.ai |
| `COMFYUI_BASE_URL` | `http://localhost:8188` | ComfyUI server URL for image generation |
| `INTIFACE_WS_URL` | `ws://localhost:12345` | Intiface Central WebSocket URL |
| `WHISPER_API_URL` | `http://localhost:8000` | faster-whisper server base URL |
| `PORT` | `3000` | HTTP port the app listens on |

---

## Troubleshooting

### Intiface not connecting
- Make sure Intiface Central is running and the server is started (green play button inside the app)
- Check the WebSocket port (default 12345) matches `INTIFACE_WS_URL`
- If running in Docker, use `ws://host.docker.internal:12345` instead of `localhost`
- xMessage will retry the connection every 15 seconds automatically — check server logs

### ComfyUI not generating images
- Verify ComfyUI is running and `COMFYUI_BASE_URL` is correct
- Check that the character's `comfyui/workflow.json` is valid API-format JSON (export via Workflow → Export API in ComfyUI, not the regular export)
- Image generation is async — it will appear in the chat when done (up to 3 minutes)
- Check server logs for `[images]` lines to see progress

### Whisper STT errors
- faster-whisper-server must expose an OpenAI-compatible API at `/v1/audio/transcriptions`
- Test it: `curl -X POST http://localhost:8000/v1/audio/transcriptions -F file=@test.mp3 -F model=whisper-1`
- PTT requires microphone permission — tap **Allow** when the browser asks

### Messages stuck / no response
- Check server logs for `[messages]` errors
- Verify `OPENROUTER_API_KEY` is set and has credits
- The model in `card.json` must be a valid OpenRouter model ID

### Character not appearing in list
- Verify `characters/{name}/card.json` exists and is valid JSON
- Check all required fields are present (name, avatar, model, personality)
- Server logs will show any character load errors on startup

---

## Session Flow

1. **Text Phase** — Normal conversation. Devices run at neutral/teasing intensity based on `device_intent` in LLM responses. Images arrive as photo attachments.

2. **Device Phase** — Triggered when LLM outputs `"phase_trigger": "handover"`. Push-to-talk button appears. Voice input is transcribed and sent as messages. Device intensity is driven by both LLM `device_intent` and immediate voice command detection (no LLM round-trip needed for "more", "stop", etc.).

3. **STOP button** — Always visible during device phase. Immediately zeros all devices. Keyboard shortcut: **Escape**.
