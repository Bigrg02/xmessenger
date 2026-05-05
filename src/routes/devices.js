const express = require('express');
const router = express.Router();
const deviceManager = require('../modules/deviceManager');
const sse = require('../modules/sseManager');

let subscribed = false;
if (!subscribed) {
  deviceManager.on('state', state => sse.broadcast('device_state', state));
  deviceManager.on('command', command => sse.broadcast('device_command', command));
  subscribed = true;
}

function parseLevel(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

router.get('/status', async (req, res) => {
  try {
    res.json(await deviceManager.ensureLovenseReady());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lovense/pairing/start', async (req, res) => {
  try {
    const payload = await deviceManager.startPairing();
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lovense/pairing/qr', (req, res) => {
  res.json(deviceManager.updatePairingQr(req.body || {}));
});

router.post('/lovense/pairing/status', (req, res) => {
  res.json(deviceManager.updateLovenseStatus(req.body || {}));
});

router.post('/lovense/pairing/device-info', (req, res) => {
  res.json(deviceManager.updateLovenseDeviceInfo(req.body || {}));
});

router.get('/lovense/pairing/apps', async (req, res) => {
  try {
    res.json(await deviceManager.refreshLovenseApps());
  } catch (err) {
    res.json(deviceManager.status());
  }
});

router.post('/lovense/pairing/disconnect', (req, res) => {
  res.json(deviceManager.disconnectLovense());
});

router.post('/session', (req, res) => {
  res.json(deviceManager.setActiveSession(req.body.session_id || null));
});

router.post('/stop', (req, res) => {
  res.json(deviceManager.stopAll('manual'));
});

router.post('/intent', (req, res) => {
  const { intent } = req.body;
  const valid = ['neutral', 'teasing', 'building', 'intense', 'cooling'];
  if (!valid.includes(intent)) return res.status(400).json({ error: 'Invalid intent' });
  res.json(deviceManager.setIntent(intent));
});

router.post('/autonomy', (req, res) => {
  res.json(deviceManager.setAutonomyEnabled(req.body.enabled !== false));
});

router.post('/pause', (req, res) => {
  res.json(deviceManager.setPaused(req.body.paused !== false));
});

router.post('/global-max', (req, res) => {
  const level = parseLevel(req.body.level);
  if (level === null) return res.status(400).json({ error: 'level required' });
  res.json(deviceManager.setGlobalMax(level));
});

router.post('/action', (req, res) => {
  const control = req.body?.toy_control || req.body;
  res.json(deviceManager.applyStructuredControl(control, 'manual'));
});

router.post('/device/:id/role', (req, res) => {
  try {
    res.json(deviceManager.setDeviceRole(req.params.id, req.body.role));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/device/:id/enabled', (req, res) => {
  try {
    res.json(deviceManager.setDeviceEnabled(req.params.id, req.body.enabled !== false));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/device/:id/level', (req, res) => {
  const level = parseLevel(req.body.level);
  if (level === null) return res.status(400).json({ error: 'level required' });
  try {
    res.json(deviceManager.setDeviceLevel(req.params.id, level, { source: 'manual' }));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/device/:id/max', (req, res) => {
  const level = parseLevel(req.body.level);
  if (level === null) return res.status(400).json({ error: 'level required' });
  try {
    res.json(deviceManager.setDeviceMaxLevel(req.params.id, level));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
