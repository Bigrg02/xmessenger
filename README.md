# xMessage

Personal AI character texting app with an iMessage-style UI, OpenRouter-backed chat, optional image generation, and Lovense-controlled device mode.

## What It Does

- Character list styled like iOS Messages
- Persistent chat sessions stored in SQLite
- Structured JSON LLM responses that drive text, audio, images, and toy control
- Adult-profile-led personality, where `core_desires` shape relationship tone and `turn_ons` / `kinks` influence warm or explicit scenes
- Async image generation through ComfyUI
- Push-to-talk voice input in device mode through Whisper
- Lovense pairing flow inside the chat UI, with QR linking through Lovense Remote or Lovense Connect
- Guided autonomy so the character can control linked toys within live caps and manual overrides
- One shared ComfyUI workflow for all characters, with per-character `appearance_prompt` data

## Stack

- Backend: Node.js + Express
- Database: SQLite via `better-sqlite3`
- Frontend: vanilla JS + mobile-first CSS
- LLM: OpenRouter
- Images: ComfyUI
- Voice input: faster-whisper-server
- Toy integration: Lovense Web API + Lovense Remote/Connect
- Deployment: Docker / Unraid-friendly

## Requirements

Required:

- Node.js 20+
- `OPENROUTER_API_KEY`

Optional but supported:

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) at `http://localhost:8188`
- [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) at `http://localhost:8000`
- [Lovense Remote](https://www.lovense.com/remote) or Lovense Connect for toy pairing
- `LOVENSE_DEVELOPER_TOKEN` for the Lovense web pairing flow

The app degrades gracefully:

- No Lovense token or app: chat works, toy features stay unavailable
- No ComfyUI: chat works, image generation is skipped
- No Whisper: text chat still works, push-to-talk stays hidden

## Local Setup

```bash
git clone https://github.com/Bigrg02/xmessenger.git
cd xmessenger
npm install
cp .env.example .env
```

Set at least:

```env
OPENROUTER_API_KEY=sk-or-v1-...
```

If you want Lovense control, also set:

```env
LOVENSE_DEVELOPER_TOKEN=your-lovense-developer-token
LOVENSE_PLATFORM_NAME=xMessage
```

Then run:

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Lovense Flow

This build no longer uses Intiface.

Toy setup is now:

1. Open a chat.
2. Tap `Toys`.
3. Tap `Connect Lovense`.
4. Scan the QR code from Lovense Remote or Lovense Connect.
5. When toys appear, assign a body zone and leave them armed.
6. Enter device mode so the character can drive structured toy actions.

Important current behavior:

- Linking is QR-based and the app polls Lovense for linked-app and toy state after scan.
- Manual slider control is working and now sends long-running commands instead of 3-second bursts.
- Character-led toy actions are still gated by actual device mode. If the session has not entered device mode yet, the control sheet can be linked and armed but still show setup-only text.
- The backend now sends Lovense commands directly over the LAN API. The browser Socket.IO path is still present for pairing and compatibility, but control no longer depends on it.

The app keeps full manual control available:

- Global intensity cap
- Per-toy cap
- Arm/disarm per toy
- Manual level slider
- Pause character control
- Emergency stop

## Docker Notes

The app container does not need direct toy hardware access.

Use Lovense Remote/Connect outside the container, and give the container:

```env
OPENROUTER_API_KEY=...
COMFYUI_BASE_URL=http://host.docker.internal:8188
WHISPER_API_URL=http://host.docker.internal:8000
LOVENSE_DEVELOPER_TOKEN=...
LOVENSE_PLATFORM_NAME=xMessage
PORT=3000
```

Example:

```bash
docker compose up -d --build
```

## Character Files

Each character lives in `characters/<slug>/` and usually includes:

- `card.json`
- `reference.png`
- optional `reference_full.png`
- optional `audio/<category>/...`

Important card fields:

- `name`
- `avatar`
- `model`
- `personality`
- `texting_style`
- `scenario`
- `first_message`
- `appearance_prompt`
- `accent_color`

The app also supports expanded adult-profile fields such as `backstory`, `relationship_to_user`, `sexual_personality`, `turn_ons`, `kinks`, `limits`, `aftercare_style`, and `example_dialogue`.

## Character Tone Model

Character tone is no longer driven only by “was the recent chat explicit.” The runtime now separates:

- always-on relationship feel, led by `core_desires`
- warm/explicit scene expression, influenced by `sexual_personality`, `turn_ons`, `kinks`, and `aftercare_style`
- latest-turn intent, so real questions still get real answers even after a hot stretch

In practice this means:

- `core_desires` should shape the emotional feel of the relationship all the time
- `turn_ons` and `kinks` show up more as recurring motifs in warm or explicit scenes
- practical questions after explicit messages should still be answered directly, with only light chemistry layered in when appropriate
- image and toy behavior now follow the same tone-routing logic instead of staying “hot forever”

## Shared ComfyUI Workflow

Image generation now uses one shared workflow file:

- [workflows/comfyui/workflow.json](/C:/dev/Xmessenger/workflows/comfyui/workflow.json)

The app injects each character's `appearance_prompt` plus the scene request into matching `CLIPTextEncode` nodes, and uploads the character reference image into the configured workflow image-loader node.

ComfyUI bindings are now configurable from Settings:

- `Prompt Node IDs`
- `Reference Image Node IDs`
- `Seed Node IDs`

Those values should use the exported ComfyUI node IDs from your shared workflow. The workflow settings screen also shows a live list of titled nodes and IDs found in the current shared workflow so you can target them without editing code.
If `Seed Node IDs` is left blank, xMessage will still try to auto-randomize common `seed` or `noise_seed` inputs it finds, so regenerate runs do not keep producing the same image.

Backward compatibility:

- If the shared workflow file is missing, the app still falls back to an old character-specific workflow path if one exists.
- New character scaffolds no longer create per-character ComfyUI workflow folders by default.

## Main API Surfaces

- `GET /api/characters`
- `POST /api/sessions`
- `GET /api/sessions/:id/events`
- `POST /api/sessions/:id/messages`
- `POST /api/sessions/:id/messages/photo`
- `GET /api/devices/status`
- `POST /api/devices/lovense/pairing/start`
- `GET /api/devices/lovense/pairing/apps`
- `POST /api/devices/lovense/pairing/disconnect`
- `GET /api/admin/comfyui-settings`
- `PATCH /api/admin/comfyui-settings`

## Development Notes

- Device state is pushed to the frontend over SSE as `device_state`.
- Toy commands are emitted as `device_command`, but the backend also sends Lovense LAN API commands directly so control does not depend on browser socket delivery.
- The LLM still returns the same high-level JSON contract, with structured `toy_control` added for device-mode choreography.
- The JSON parser in `llmClient` now extracts the first complete JSON object from model output so device-mode replies with trailing junk do not break chat.
- Adult profile is now split internally into an always-on relationship desire layer and a warm/explicit scene escalation layer.
- Automatic image sending is gated by the current turn’s inferred tone, so visual requests still trigger easily while normal-topic turns suppress stray photo sends.
- Session reload now restores the newest 100 messages in chronological order rather than the oldest 100, so late-thread messages persist visibly after refresh.

## Known Limits

- The current toy panel is stable for linking and manual control, but character autonomy still depends on the chat session actually entering device mode.
- We support structured action types like `pulse`, `ramp`, `hold`, and `alternate`, but we do not yet expose Lovense preset-pattern selection or downloadable pattern-library import in the UI.
- Lovense app-library patterns are not currently imported directly. The next practical upgrade would be named presets plus custom pattern definitions stored in this app.

## Tests

```bash
npm test
```
