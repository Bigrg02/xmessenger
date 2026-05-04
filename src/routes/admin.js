const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

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
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeCard(slug, card) {
  const dir = path.join(CHARS_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'card.json'), JSON.stringify(card, null, 2));
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

  return {
    name: name.trim(),
    avatar: 'reference.png',
    reference_portrait: hasPortrait ? 'reference.png' : (existing.reference_portrait || 'reference.png'),
    reference_fullbody: hasFullbody ? 'reference_full.png' : (existing.reference_fullbody || null),
    accent_color: body.accent_color || existing.accent_color || '#ff6b9d',
    model: body.model || existing.model || 'openai/gpt-4o',
    personality: body.personality || existing.personality || '',
    texting_style: body.texting_style || existing.texting_style || '',
    scenario: body.scenario || existing.scenario || '',
    first_message: body.first_message || existing.first_message || '',
    appearance_prompt: body.appearance_prompt || existing.appearance_prompt || '',
    comfyui_workflow: existing.comfyui_workflow || 'comfyui/workflow.json',
    audio_library: existing.audio_library || {
      encouragement: [], reactive: [], checking_in: [],
      edging: [], climax: [], aftercare: [],
    },
    device_phase_style: body.device_phase_style || existing.device_phase_style || 'Short reactive texts only, max 6 words.',
  };
}

module.exports = router;
