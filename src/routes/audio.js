const express = require('express');
const router = express.Router();
const audioManager = require('../modules/audioManager');

// GET /api/audio/:character/:category/random
router.get('/:character/:category/random', (req, res) => {
  const { character, category } = req.params;
  const { session_id } = req.query;
  const clip = audioManager.getClip(session_id || 'global', character, category);
  if (!clip) return res.status(404).json({ error: 'No clips found' });
  res.json({ url: clip });
});

module.exports = router;
