const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { loadCard } = require('./characters');

// POST /api/sessions — create or resume session for a character
router.post('/', (req, res) => {
  const { character_name, resume } = req.body;
  if (!character_name) return res.status(400).json({ error: 'character_name required' });

  const card = loadCard(character_name.toLowerCase());
  if (!card) return res.status(404).json({ error: 'Character not found' });

  if (resume) {
    const existing = db.getOrCreateSession(card.name);
    let messages = db.getMessages(existing.id);
    // New session created by getOrCreateSession won't have the first_message yet
    if (messages.length === 0 && card.first_message) {
      db.addMessage(existing.id, 'assistant', card.first_message, {
        device_intent: 'neutral',
        audio_category: 'none',
      });
      messages = db.getMessages(existing.id);
    }
    return res.json({ session: existing, messages, card });
  }

  const session = db.createSession(uuidv4(), card.name);

  // Inject first_message as assistant message
  if (card.first_message) {
    db.addMessage(session.id, 'assistant', card.first_message, {
      device_intent: 'neutral',
      audio_category: 'none',
    });
  }

  const messages = db.getMessages(session.id);
  res.json({ session, messages, card });
});

// GET /api/sessions/:id
router.get('/:id', (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const card = loadCard(session.character_name.toLowerCase());
  let messages = db.getMessages(session.id);
  // Ensure first_message is always present
  if (messages.length === 0 && card?.first_message) {
    db.addMessage(session.id, 'assistant', card.first_message, {
      device_intent: 'neutral',
      audio_category: 'none',
    });
    messages = db.getMessages(session.id);
  }
  res.json({ session, messages, card });
});

module.exports = router;
