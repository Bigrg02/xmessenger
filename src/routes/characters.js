const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../db');

const CHARS_DIR = path.join(__dirname, '../../characters');

function loadCard(name) {
  const cardPath = path.join(CHARS_DIR, name, 'card.json');
  if (!fs.existsSync(cardPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cardPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function listCharacters() {
  if (!fs.existsSync(CHARS_DIR)) return [];
  return fs.readdirSync(CHARS_DIR)
    .filter(d => {
      const stat = fs.statSync(path.join(CHARS_DIR, d));
      return stat.isDirectory();
    })
    .map(d => {
      const card = loadCard(d);
      if (!card) return null;
      return { ...card, _dir: d };
    })
    .filter(Boolean);
}

// GET /api/characters
router.get('/', (req, res) => {
  const chars = listCharacters();

  // Attach last message preview from sessions
  // Key by lowercase so slug-stored ("sara") and name-stored ("Sara") both match
  const sessions = db.listSessions();
  const sessionByKey = {};
  for (const s of sessions) {
    const k = s.character_name.toLowerCase();
    if (!sessionByKey[k]) sessionByKey[k] = s;
  }

  const result = chars.map(c => {
    const session = sessionByKey[c._dir] || sessionByKey[c.name.toLowerCase()];
    return {
      name: c.name,
      slug: c._dir,
      avatar: `/characters/${c._dir}/${c.avatar || 'reference.png'}`,
      accent_color: c.accent_color || '#007AFF',
      last_message: session?.last_message || c.first_message || null,
      last_message_at: session?.last_message_at || null,
      session_id: session?.id || null,
    };
  });

  // Sort: characters with recent messages first
  result.sort((a, b) => (b.last_message_at || 0) - (a.last_message_at || 0));

  res.json(result);
});

// GET /api/characters/:name/card
router.get('/:name/card', (req, res) => {
  const card = loadCard(req.params.name.toLowerCase());
  if (!card) return res.status(404).json({ error: 'Character not found' });
  res.json(card);
});

module.exports = router;
module.exports.loadCard = loadCard;
module.exports.CHARS_DIR = CHARS_DIR;
