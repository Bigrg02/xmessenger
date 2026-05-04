const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { loadCard } = require('./characters');

// POST /api/sessions — create or resume session for a character
router.post('/', (req, res) => {
  const { character_name, resume } = req.body;
  if (!character_name) return res.status(400).json({ error: 'character_name required' });

  const slug = character_name.toLowerCase();
  const card = loadCard(slug);
  if (!card) return res.status(404).json({ error: 'Character not found' });

  if (resume) {
    // Look up existing session by slug first, fall back to display name
    const existing = db.getOrCreateSession(slug);
    let messages = db.getMessages(existing.id);
    if (messages.length === 0 && card.first_message) {
      db.addMessage(existing.id, 'assistant', card.first_message, {
        device_intent: 'neutral',
        audio_category: 'none',
      });
      messages = db.getMessages(existing.id);
    }
    return res.json({ session: existing, messages, card, slug });
  }

  const session = db.createSession(uuidv4(), slug);

  if (card.first_message) {
    db.addMessage(session.id, 'assistant', card.first_message, {
      device_intent: 'neutral',
      audio_category: 'none',
    });
  }

  const messages = db.getMessages(session.id);
  res.json({ session, messages, card, slug });
});

// GET /api/sessions/:id
router.get('/:id', (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const slug = session.character_name.toLowerCase();
  const card = loadCard(slug);
  let messages = db.getMessages(session.id);
  if (messages.length === 0 && card?.first_message) {
    db.addMessage(session.id, 'assistant', card.first_message, {
      device_intent: 'neutral',
      audio_category: 'none',
    });
    messages = db.getMessages(session.id);
  }
  res.json({ session, messages, card, slug });
});

module.exports = router;
