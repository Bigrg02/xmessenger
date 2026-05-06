# Working Notes

This document is the local onboarding/reference guide for active development in this repo. It is intentionally short and biased toward the things that help us start work safely.

## Purpose

`xmessenger` is a personal AI character messaging app with an iMessage-style UI. The app combines:

- Character-based chat over a vanilla JS frontend
- Session and message persistence in SQLite
- LLM responses from OpenRouter
- Optional side effects from Lovense, ComfyUI, and Whisper
- A built-in admin/settings flow for managing characters and the image system

## Stack Snapshot

- Runtime: Node.js 20
- Server: Express
- Database: `better-sqlite3`
- Frontend: static HTML, CSS, and vanilla JS in `public/`
- Realtime updates: Server-Sent Events
- Deployment: Docker / docker-compose

## Important Paths

- Entry point: `server.js`
- Backend routes: `src/routes/`
- Service modules: `src/modules/`
- Database layer: `src/db/index.js`
- Frontend shell: `public/index.html`
- Frontend logic: `public/js/`
- Frontend styles: `public/css/styles.css`
- Character assets and cards: `characters/<slug>/`
- Runtime data: `data/`

## Main Runtime Flow

1. The user opens the SPA from `public/index.html`.
2. The frontend loads the character list from `GET /api/characters`.
3. Opening a chat creates or resumes a session through `src/routes/sessions.js`.
4. The frontend opens an SSE stream at `GET /api/sessions/:id/events`.
5. Sending a message posts to `POST /api/sessions/:id/messages`.
6. The backend stores the user message, emits it via SSE, and shows typing.
7. `sessionManager.buildContext()` loads recent history and optional summary context.
8. `llmClient.chat()` calls OpenRouter and expects strict JSON output.
9. The assistant reply is stored, emitted over SSE, and may trigger:
10. Device updates through `deviceManager`
11. Audio playback through `audioManager`
12. Device-phase handoff
13. Async image generation through `imageGenerator`

## Data Model

SQLite lives at `data/xmessenger.db`.

Current tables:

- `sessions`
- `messages`
- `images`

Key details:

- Sessions track `character_name`, `phase`, timestamps, an optional summary, and current outfit continuity.
- Messages store `role`, `content`, and optional JSON `metadata`.
- Assistant side effects are reconstructed largely from `metadata`.

## Backend Responsibilities

### `src/routes/characters.js`

- Lists characters for the inbox view
- Loads `card.json` files from `characters/`
- Combines character cards with recent session preview data

### `src/routes/sessions.js`

- Creates new sessions
- Resumes existing sessions by character
- Injects the character `first_message` when needed

### `src/routes/messages.js`

- Owns the main chat pipeline
- Handles immediate voice intent routing in device phase
- Persists user and assistant messages
- Broadcasts typing, message, image, audio, phase, and error SSE events
- Runs manual scene-image generation
- Handles image regenerate-in-place flows

### `src/routes/admin.js`

- Powers the settings/admin UI
- Lists and edits characters
- Uploads portrait and full-body reference images
- Pulls a live model catalog from OpenRouter
- Runs one-off model test prompts
- Manages the in-app ComfyUI image-system setup surface
- Uploads/replaces the shared workflow JSON
- Runs dry validation of server, workflow, bindings, and character reference readiness

### `src/modules/llmClient.js`

- Builds prompts from character cards
- Calls OpenRouter
- Retries malformed output once with a JSON correction prompt
- Summarizes older sessions when context gets long
- Derives per-turn tone routing such as reply/image/control modes
- Keeps `core_desires` in the always-on relationship layer
- Uses `turn_ons` / `kinks` more as recurring motifs during warm or explicit scenes
- Builds manual image prompts from recent chat context

### `src/modules/deviceManager.js`

- Manages Lovense pairing and toy session state
- Tracks armed toys, roles, caps, and autonomy
- Queues structured toy-control actions
- Sends Lovense commands directly through the LAN API
- Exposes status, pairing, polling-refresh, and emergency stop helpers

### `src/modules/imageGenerator.js`

- Loads the shared ComfyUI API workflow from `workflows/comfyui/workflow.json`
- Injects prompt text into configured `CLIPTextEncode` nodes
- Uploads the selected character reference image into the configured image node
- Randomizes configured or auto-detected seed-bearing nodes on every image run
- Submits jobs to ComfyUI and polls history
- Downloads the first generated image into `data/images/`
- Normalizes clothing/action phrasing for cleaner Flux-style generations
- Adds fallback pose, facing, framing, and expression details when the model underspecifies them

### `src/modules/comfyuiSettings.js`

- Stores app-managed image-system settings in `data/comfyui-settings.json`
- Normalizes active ComfyUI server URL plus prompt-node, reference-image-node, and seed-node ID lists
- Tracks the last dry-validation result
- Lists workflow nodes and workflow metadata for the settings UI

## Frontend Responsibilities

### `public/js/app.js`

- Owns top-level screen navigation
- Opens chats and SSE connections
- Refreshes the character list

### `public/js/chat.js`

- Renders message history and new SSE-delivered messages
- Sends user text messages
- Enters device mode UI state
- Owns the Lovense QR pairing panel and app-state polling
- Owns manual scene-image generation from both the `Scene` button and avatar/header tap
- Shows the small header spinner while manual photo generation is in flight

### `public/js/ptt.js`

- Records push-to-talk audio
- Uploads audio to `/api/stt`
- Sends the returned transcript back through the normal chat route

### `public/js/settings.js`

- Drives the settings screens
- Fetches model options from `/api/admin/models`
- Creates, updates, tests, and deletes characters
- Loads and saves the full in-app image-system settings
- Uploads/downloads the shared workflow JSON
- Renders workflow node quick-pick actions
- Runs dry image-system validation against the active ComfyUI server

## Character Contract

Each character folder is expected to contain at least:

- `card.json`
- `reference.png`

Common optional files:

- `reference_full.png`
- `audio/<category>/...`

The card fields that matter most to the runtime are:

- `name`
- `avatar`
- `model`
- `personality`
- `texting_style`
- `scenario`
- `first_message`
- `appearance_prompt`
- `accent_color`

Expanded adult-profile fields are actively used now:

- `core_desires`
- `sexual_personality`
- `her_desires` — what she craves and might initiate/ask for; gives her conversational agency
- `turn_ons`
- `kinks`
- `aftercare_style`
- `pet_names`
- `relationship_to_user`
- `backstory`

Current prompting model:

- `core_desires` shapes the ongoing emotional feel of the relationship all the time
- `sexual_personality` influences both subtle chemistry and explicit scene style
- `her_desires` surfaces every 3–5 exchanges in warm/explicit mode — she asks for something, redirects, or expresses what she wants rather than always reacting
- `turn_ons` and `kinks` should surface as repeated themes in warm/explicit chats, image offers, and toy-control flavor
- explicitness is no longer meant to stick forever just because an older part of the thread was hot

## App Settings (runtime config)

All settings are editable in-app at **Settings → APP SETTINGS**. Stored in `data/app-settings.json`.
In-app values take precedence over `.env` fallbacks.

Key settings:
- API keys (OpenRouter, Lovense) — override `.env`
- External service URLs (Whisper, Intiface)
- LLM temperature + max tokens
- Device intent levels (neutral/teasing/building/intense/cooling → 0–1 range)
- Silence check-in delay, manual override duration
- Image gen timeout, default location fallback

## Local Commands

Install dependencies:

```powershell
npm install
```

Run in watch mode:

```powershell
npm run dev
```

Run normally:

```powershell
npm start
```

Build a new character scaffold:

```powershell
node scripts/build-character.js --name "Sara"
```

Test candidate OpenRouter models:

```powershell
node scripts/test-models.js --models "openai/gpt-4o,openai/gpt-4o-mini"
```

Run the automated test suite:

```powershell
npm test
```

## Environment

Defined in `.env.example`:

- `OPENROUTER_API_KEY`
- `COMFYUI_BASE_URL`
- `LOVENSE_DEVELOPER_TOKEN`
- `LOVENSE_PLATFORM_NAME`
- `WHISPER_API_URL`
- `PORT`

Notes:

- The active ComfyUI server URL is now app-managed first and can target any reachable LAN server.
- `COMFYUI_BASE_URL` is now a fallback only when no saved in-app image server URL exists.
- The app degrades when external services are missing, but chat quality depends on OpenRouter and some flows only appear during device phase.

## Current Lovense State

- The repo is now Lovense-only for toy control; Intiface has been removed from app code, config, and UI.
- Pairing is QR-based from the toy sheet in chat.
- After scan, the frontend polls Lovense app state with `/api/devices/lovense/pairing/apps` so linked toys can appear even if socket events are delayed.
- Manual toy control is working through direct backend calls to the Lovense LAN command API.
- Manual steady-state commands are intentionally long-running now, so slider changes hold until another command or stop arrives.
- Character control still requires the chat session to be in actual `device` phase. A linked/armed toy alone does not imply autonomy is active.

## Current Working Assumptions

- The repo has an automated Node test suite via `npm test`, but no dedicated lint script.
- The app is integration-heavy, so some validation will still be manual even with tests.
- `characters/sara/card.json` currently has an uncommitted user edit and should be treated carefully.
- `data/` contains runtime state and should not be treated as source-of-truth code.
- ComfyUI is intended to use a single shared workflow file rather than per-character workflow JSON.

## Known Sharp Edges

- `src/routes/admin.js` permanently deletes character folders with `DELETE /api/admin/characters/:slug`.
- Session summaries are generated lazily only after the message count exceeds the recent-context limit.
- Session reload now intentionally shows the newest 100 messages, not the oldest 100. Older context is still available to the model through recent-window plus summary logic, but not all old messages are rendered in the UI at once.
- The LLM contract is strict JSON, but `llmClient` now extracts the first complete JSON object before parse to survive some trailing model junk. Badly malformed replies can still fail after retry.
- Image auto-triggering is now more intent-aware, but it still depends on prompt/routing heuristics rather than a large persistent conversation-state machine.
- SSE state is kept in memory only, so reconnect behavior matters during browser refreshes or server restarts.
- Frontend and backend both assume character folder names line up with lowercased character names.
- The toy sheet can be fully linked and show live toy state while still saying setup-only if the current session has not entered device mode.
- Lovense preset/downloaded pattern-library integration is not implemented yet; current control is structured action based (`set_level`, `ramp`, `pulse`, `hold`, `cooldown`, `stop`, `focus`, `alternate`).
- The shared ComfyUI workflow is still a template until you replace [workflows/comfyui/workflow.json](/C:/dev/Xmessenger/workflows/comfyui/workflow.json) with your actual exported workflow, but upload/replacement can now be done entirely from the app.
- Shared ComfyUI bindings are now primarily node-ID based. If prompt or reference injection stops working after a workflow export, check the node IDs shown in Settings before changing code.
- The image setup screen now includes a dry validation panel. It checks server reachability, workflow presence, node binding resolution, character reference images, and prompt assembly without requiring a real render.
- Flux-style image models still need clean, non-ambiguous clothing language. The image generator now rewrites "peek" or layered half-visible underwear states into either clearly hidden or clearly exposed phrasing before generation.
- Image action prompts now require pose, facing direction, framing, and facial expression. The backend adds a fallback expression if the model leaves the face emotionally blank.

## Good First Places To Change Code

- UI behavior and layout: `public/js/` and `public/css/styles.css`
- Character/session API behavior: `src/routes/`
- Model prompt or parsing behavior: `src/modules/llmClient.js`
- Persistence changes: `src/db/index.js`
- Service integrations: `src/modules/deviceManager.js`, `src/modules/imageGenerator.js`, `src/routes/stt.js`

## Suggested Next Docs

If we keep working in this repo, the next most useful docs would be:

- A lightweight API reference for all `/api/*` routes
- A manual QA checklist for core chat, settings, and device-mode flows
- A character card schema reference with required vs optional fields
