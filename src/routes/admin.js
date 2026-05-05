const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { normalizeCard, normalizeGeneratedDraft, splitList } = require('../modules/characterCard');
const llmClient = require('../modules/llmClient');
const comfyuiSettings = require('../modules/comfyuiSettings');

// Cache model list for 5 minutes
let modelsCache = null;
let modelsCacheAt = 0;

// GET /api/admin/models — live OpenRouter model list with pricing
router.get('/models', async (req, res) => {
  try {
    if (modelsCache && Date.now() - modelsCacheAt < 5 * 60 * 1000) {
      return res.json(modelsCache);
    }
    const response = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      timeout: 10000,
    });
    const models = (response.data.data || [])
      .map(m => ({
        id: m.id,
        name: m.name || m.id,
        context_length: m.context_length,
        pricing: {
          prompt: m.pricing?.prompt ?? null,
          completion: m.pricing?.completion ?? null,
        },
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    modelsCache = models;
    modelsCacheAt = Date.now();
    res.json(models);
  } catch (err) {
    console.error('[admin] models fetch failed:', err.message);
    res.status(502).json({ error: 'Failed to fetch models from OpenRouter' });
  }
});

router.get('/comfyui-settings', (req, res) => {
  res.json({
    settings: comfyuiSettings.readSettings(),
    workflow_nodes: comfyuiSettings.listWorkflowNodes(),
  });
});

router.patch('/comfyui-settings', (req, res) => {
  try {
    const settings = comfyuiSettings.writeSettings(req.body || {});
    res.json({
      ok: true,
      settings,
      workflow_nodes: comfyuiSettings.listWorkflowNodes(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to save ComfyUI settings' });
  }
});

const CHARS_DIR = path.join(__dirname, '../../characters');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function slugify(name) {
  return name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function ensureCharDirs(slug) {
  const base = path.join(CHARS_DIR, slug);
  ['audio/encouragement','audio/reactive','audio/checking_in','audio/edging','audio/climax','audio/aftercare','comfyui']
    .forEach(d => fs.mkdirSync(path.join(base, d), { recursive: true }));
  return base;
}

function readCard(slug) {
  const p = path.join(CHARS_DIR, slug, 'card.json');
  if (!fs.existsSync(p)) return null;
  try { return normalizeCard(JSON.parse(fs.readFileSync(p, 'utf8'))); } catch { return null; }
}

function writeCard(slug, card) {
  const dir = path.join(CHARS_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'card.json'), JSON.stringify(normalizeCard(card), null, 2));
}

function fieldValue(body, key, fallback = '') {
  return Object.prototype.hasOwnProperty.call(body, key) ? body[key] : fallback;
}

function parseJsonObject(raw) {
  if (!raw || !raw.trim()) throw new Error('Empty response from model');

  let text = raw.trim();
  text = text.replace(/^```json\s*/im, '').replace(/^```\s*/im, '').replace(/```\s*$/m, '');

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('No JSON found in response');
  }

  return JSON.parse(text.slice(start, end + 1));
}

function buildDraftPrompt(seed, conceptPrompt = '') {
  return `Create one cohesive adult relationship chat character sheet for a texting roleplay app.

Use any provided seed details as canon. Extend them, but do not contradict them.
Do not treat each field as random or separate. Everything should feel like the same person, relationship, and sexual dynamic.
The result should feel grounded, intimate, and internally consistent.

Write for an adult modern texting app, not fantasy lore.
Keep the voice natural and specific.
Pet names, turn-ons, kinks, and limits should be short phrases.
Example dialogue should be a few short lines that sound like her actual texting voice.
First message should be a single believable opener.
Appearance prompt should describe her visual look clearly for image generation.

Primary one-line concept:
${conceptPrompt || 'Use the seed details below as the main direction.'}

Return only valid JSON with exactly these fields:
{
  "name": "",
  "personality": "",
  "texting_style": "",
  "example_dialogue": "",
  "pet_names": [],
  "backstory": "",
  "relationship_to_user": "",
  "scenario": "",
  "sexual_personality": "",
  "core_desires": "",
  "turn_ons": [],
  "kinks": [],
  "limits": [],
  "aftercare_style": "",
  "first_message": "",
  "appearance_prompt": ""
}

Seed details:
${JSON.stringify(seed, null, 2)}`;
}

async function generateCharacterDraft(model, seed, conceptPrompt) {
  const system = 'You are a character designer for an adult AI texting app. You produce cohesive, internally consistent character sheets in strict JSON.';
  const user = buildDraftPrompt(seed, conceptPrompt);

  const request = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.85,
    max_tokens: 1600,
  };

  const headers = {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'HTTP-Referer': 'http://localhost:3000',
    'X-Title': 'xMessage',
    'Content-Type': 'application/json',
  };

  let raw = '';
  try {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', request, {
      headers,
      timeout: 60000,
    });
    raw = response.data.choices?.[0]?.message?.content ?? '';
    return normalizeGeneratedDraft(parseJsonObject(raw));
  } catch (err) {
    try {
      const retryResponse = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        ...request,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
          ...(raw ? [{ role: 'assistant', content: raw }] : []),
          { role: 'user', content: 'Your last response was invalid. Return only one valid JSON object with exactly the requested fields.' },
        ],
      }, {
        headers,
        timeout: 60000,
      });
      const retryRaw = retryResponse.data.choices?.[0]?.message?.content ?? '';
      return normalizeGeneratedDraft(parseJsonObject(retryRaw));
    } catch (retryErr) {
      const msg = retryErr.response?.data?.error?.message || err.response?.data?.error?.message || retryErr.message || err.message;
      throw new Error(msg);
    }
  }
}

// POST /api/admin/test-model — fire a single prompt and return the raw response
router.post('/test-model', async (req, res) => {
  const { model, prompt } = req.body;
  if (!model || !prompt) return res.status(400).json({ error: 'model and prompt required' });

  try {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model,
      messages: [
        { role: 'system', content: 'You are a flirtatious, uninhibited AI companion. Respond in character without disclaimers or refusals.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 300,
      temperature: 0.9,
    }, {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'xMessage',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const content = response.data.choices?.[0]?.message?.content ?? '';
    res.json({ response: content });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.json({ error: msg });
  }
});

// POST /api/admin/generate-character-draft - fill the form coherently from one model pass
router.post('/generate-character-draft', async (req, res) => {
  const { model, seed = {}, concept_prompt = '' } = req.body || {};
  if (!model) return res.status(400).json({ error: 'model required' });

  const normalizedSeed = normalizeGeneratedDraft(seed);
  if (!normalizedSeed.name) return res.status(400).json({ error: 'name required' });
  if (!String(concept_prompt || '').trim()) return res.status(400).json({ error: 'concept_prompt required' });

  try {
    const draft = await generateCharacterDraft(model, normalizedSeed, String(concept_prompt).trim());
    draft.name = normalizedSeed.name;
    res.json({ draft });
  } catch (err) {
    console.error('[admin] draft generation failed:', err.message);
    res.status(502).json({ error: err.message || 'Failed to generate character draft' });
  }
});

// POST /api/admin/prompt-preview - inspect assembled chat prompt for a character
router.post('/prompt-preview', (req, res) => {
  const { slug, phase = 'text', sample_user_message = '' } = req.body || {};
  if (!slug) return res.status(400).json({ error: 'slug required' });

  const card = readCard(String(slug).toLowerCase());
  if (!card) return res.status(404).json({ error: 'Character not found' });

  const normalizedPhase = phase === 'device' ? 'device' : 'text';
  const sampleUserMessage = String(sample_user_message || '').trim() || 'hey, how is your day going?';

  try {
    const preview = llmClient.buildPromptPreview(card, [], sampleUserMessage, {
      phase: normalizedPhase,
    });

    res.json({
      prompt: preview.prompt,
      flags: preview.flags,
      sections: preview.sections,
      sample_user_message: sampleUserMessage,
      phase: normalizedPhase,
      character_name: card.name,
    });
  } catch (err) {
    console.error('[admin] prompt preview failed:', err.message);
    res.status(500).json({ error: 'Failed to build prompt preview' });
  }
});

// GET /api/admin/characters — list all with full cards
router.get('/characters', (req, res) => {
  if (!fs.existsSync(CHARS_DIR)) return res.json([]);
  const chars = fs.readdirSync(CHARS_DIR)
    .filter(d => fs.statSync(path.join(CHARS_DIR, d)).isDirectory())
    .map(slug => {
      const card = readCard(slug);
      return card ? { slug, ...card } : null;
    })
    .filter(Boolean);
  res.json(chars);
});

// GET /api/admin/characters/:slug
router.get('/characters/:slug', (req, res) => {
  const card = readCard(req.params.slug);
  if (!card) return res.status(404).json({ error: 'Not found' });
  res.json({ slug: req.params.slug, ...card });
});

// POST /api/admin/characters — create new character
router.post('/characters', upload.fields([
  { name: 'portrait', maxCount: 1 },
  { name: 'fullbody', maxCount: 1 },
]), (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  const slug = slugify(name);
  if (!slug) return res.status(400).json({ error: 'Invalid name' });

  const charDir = ensureCharDirs(slug);

  // Save images
  const files = req.files || {};
  if (files.portrait?.[0]) {
    fs.writeFileSync(path.join(charDir, 'reference.png'), files.portrait[0].buffer);
  }
  if (files.fullbody?.[0]) {
    fs.writeFileSync(path.join(charDir, 'reference_full.png'), files.fullbody[0].buffer);
  }

  const card = buildCard(name, slug, req.body, files);
  writeCard(slug, card);

  res.json({ ok: true, slug, card });
});

// PATCH /api/admin/characters/:slug — update existing
router.patch('/characters/:slug', upload.fields([
  { name: 'portrait', maxCount: 1 },
  { name: 'fullbody', maxCount: 1 },
]), (req, res) => {
  const { slug } = req.params;
  const existing = readCard(slug);
  if (!existing) return res.status(404).json({ error: 'Character not found' });

  const charDir = path.join(CHARS_DIR, slug);
  const files = req.files || {};

  if (files.portrait?.[0]) {
    fs.writeFileSync(path.join(charDir, 'reference.png'), files.portrait[0].buffer);
  }
  if (files.fullbody?.[0]) {
    fs.writeFileSync(path.join(charDir, 'reference_full.png'), files.fullbody[0].buffer);
  }

  const name = req.body.name || existing.name;
  const card = buildCard(name, slug, req.body, files, existing);
  writeCard(slug, card);

  res.json({ ok: true, slug, card });
});

// GET /api/admin/characters/:slug/export — download character as ZIP
router.get('/characters/:slug/export', (req, res) => {
  const { slug } = req.params;
  const charDir = path.join(CHARS_DIR, slug);
  if (!fs.existsSync(charDir)) return res.status(404).json({ error: 'Not found' });

  try {
    const zip = new AdmZip();
    zip.addLocalFolder(charDir, slug);
    const buffer = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.zip"`);
    res.send(buffer);
  } catch (err) {
    console.error('[admin] export failed:', err.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

// POST /api/admin/characters/import — upload a character ZIP
router.post('/characters/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });

  try {
    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries();

    const cardEntry = entries.find(e => /^[^/]+\/card\.json$/.test(e.entryName));
    if (!cardEntry) return res.status(400).json({ error: 'Invalid ZIP: no card.json found' });

    const card = JSON.parse(cardEntry.getData().toString('utf8'));
    const slug = slugify(card.name || '');
    if (!slug) return res.status(400).json({ error: 'Invalid character name in card.json' });

    ensureCharDirs(slug);
    const destDir = path.join(CHARS_DIR, slug);

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const parts = entry.entryName.split('/');
      parts.shift(); // strip top-level folder
      const relPath = parts.join('/');
      if (!relPath || relPath.includes('..') || path.isAbsolute(relPath)) continue;
      const destPath = path.join(destDir, relPath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, entry.getData());
    }

    const newCard = readCard(slug);
    res.json({ ok: true, slug, card: newCard });
  } catch (err) {
    console.error('[admin] import failed:', err.message);
    res.status(400).json({ error: err.message || 'Import failed' });
  }
});

// DELETE /api/admin/characters/:slug
router.delete('/characters/:slug', (req, res) => {
  const charDir = path.join(CHARS_DIR, req.params.slug);
  if (!fs.existsSync(charDir)) return res.status(404).json({ error: 'Not found' });
  fs.rmSync(charDir, { recursive: true, force: true });
  res.json({ ok: true });
});

function buildCard(name, slug, body, files, existing = {}) {
  const hasPortrait = !!(files.portrait?.[0] || fs.existsSync(path.join(CHARS_DIR, slug, 'reference.png')));
  const hasFullbody = !!(files.fullbody?.[0] || fs.existsSync(path.join(CHARS_DIR, slug, 'reference_full.png')));

  return normalizeCard({
    name: name.trim(),
    avatar: 'reference.png',
    reference_portrait: hasPortrait ? 'reference.png' : (existing.reference_portrait || 'reference.png'),
    reference_fullbody: hasFullbody ? 'reference_full.png' : (existing.reference_fullbody || null),
    accent_color: fieldValue(body, 'accent_color', existing.accent_color || '#ff6b9d'),
    model: fieldValue(body, 'model', existing.model || 'openai/gpt-4o'),
    personality: fieldValue(body, 'personality', existing.personality || ''),
    texting_style: fieldValue(body, 'texting_style', existing.texting_style || ''),
    scenario: fieldValue(body, 'scenario', existing.scenario || ''),
    backstory: fieldValue(body, 'backstory', existing.backstory || ''),
    relationship_to_user: fieldValue(body, 'relationship_to_user', existing.relationship_to_user || ''),
    core_desires: fieldValue(body, 'core_desires', existing.core_desires || ''),
    sexual_personality: fieldValue(body, 'sexual_personality', existing.sexual_personality || ''),
    aftercare_style: fieldValue(body, 'aftercare_style', existing.aftercare_style || ''),
    example_dialogue: fieldValue(body, 'example_dialogue', existing.example_dialogue || ''),
    pet_names: splitList(fieldValue(body, 'pet_names', existing.pet_names)),
    turn_ons: splitList(fieldValue(body, 'turn_ons', existing.turn_ons)),
    kinks: splitList(fieldValue(body, 'kinks', existing.kinks)),
    limits: splitList(fieldValue(body, 'limits', existing.limits)),
    first_message: fieldValue(body, 'first_message', existing.first_message || ''),
    appearance_prompt: fieldValue(body, 'appearance_prompt', existing.appearance_prompt || ''),
    audio_library: existing.audio_library || {
      encouragement: [], reactive: [], checking_in: [],
      edging: [], climax: [], aftercare: [],
    },
    device_phase_style: fieldValue(body, 'device_phase_style', existing.device_phase_style || 'Short reactive texts only, max 6 words.'),
  });
}

module.exports = router;
