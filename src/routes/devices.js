const express = require('express');
const router = express.Router();
const deviceManager = require('../modules/deviceManager');

// GET /api/devices/status
router.get('/status', (req, res) => {
  res.json(deviceManager.status());
});

// POST /api/devices/stop — emergency stop
router.post('/stop', (req, res) => {
  deviceManager.stopAll();
  res.json({ ok: true });
});

// POST /api/devices/intent
router.post('/intent', (req, res) => {
  const { intent } = req.body;
  const valid = ['neutral', 'teasing', 'building', 'intense', 'cooling'];
  if (!valid.includes(intent)) return res.status(400).json({ error: 'Invalid intent' });
  deviceManager.setIntent(intent);
  res.json({ ok: true, intent });
});

module.exports = router;
