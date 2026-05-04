const express = require('express');
const router = express.Router();
const db = require('../db');
const sse = require('../modules/sseManager');
const llmClient = require('../modules/llmClient');
const sessionManager = require('../modules/sessionManager');
const deviceManager = require('../modules/deviceManager');
const audioManager = require('../modules/audioManager');
const imageGenerator = require('../modules/imageGenerator');
const intentDetector = require('../modules/intentDetector');
const { loadCard } = require('./characters');

// Silence timeout tracker — per session
const silenceTimers = new Map();

function resetSilenceTimer(sessionId, card) {
  if (silenceTimers.has(sessionId)) clearTimeout(silenceTimers.get(sessionId));

  const timer = setTimeout(() => {
    const clip = audioManager.getClip(sessionId, card.name, 'checking_in');
    if (clip) sse.send(sessionId, 'audio', { url: clip, category: 'checking_in' });
  }, 45000);

  silenceTimers.set(sessionId, timer);
}

// GET /api/sessions/:id/events — SSE channel
router.get('/:id/events', (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).end();
  sse.register(req.params.id, res);
});

// POST /api/sessions/:id/messages — send a message
router.post('/:id/messages', async (req, res) => {
  const { content, is_voice } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });

  let session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const card = loadCard(session.character_name.toLowerCase());
  if (!card) return res.status(500).json({ error: 'Character card missing' });

  // Respond immediately — real work is async via SSE
  res.status(202).json({ ok: true });

  // Handle voice intent immediately (before LLM)
  if (is_voice && session.phase === 'device') {
    const intent = intentDetector.detect(content);
    if (intent.hasIntent) {
      if (intent.urgency === 'stop') {
        deviceManager.stopAll();
        sse.send(session.id, 'device', { intent: 'stopped', emergency: false });
      } else if (intent.urgency === 'too_much') {
        deviceManager.setIntent('cooling');
        sse.send(session.id, 'device', { intent: 'cooling' });
      } else if (intent.urgency === 'climax') {
        deviceManager.setIntent('intense');
        sse.send(session.id, 'device', { intent: 'intense' });
      } else if (intent.intensityDelta !== null) {
        deviceManager.adjustIntensity(intent.bodyTarget || 'both', intent.intensityDelta);
        sse.send(session.id, 'device', { intent: 'adjusted', delta: intent.intensityDelta, target: intent.bodyTarget });
      }
    }
  }

  // Save user message
  const userMsg = db.addMessage(session.id, 'user', content.trim());
  sse.send(session.id, 'message', serializeMsg(userMsg));

  // Show typing indicator
  sse.send(session.id, 'typing', { visible: true });

  // Reset silence timer in device phase
  if (session.phase === 'device') resetSilenceTimer(session.id, card);

  try {
    // Build context
    const { messages, summaryMessage } = await sessionManager.buildContext(session, card);

    // Call LLM
    const llmResponse = await llmClient.chat(card, summaryMessage, messages, content.trim());

    sse.send(session.id, 'typing', { visible: false });

    // Save assistant message
    const metadata = {
      device_intent: llmResponse.device_intent,
      audio_category: llmResponse.audio_category,
      phase_trigger: llmResponse.phase_trigger,
      image_requested: llmResponse.image_request.send,
    };
    const assistantMsg = db.addMessage(session.id, 'assistant', llmResponse.message, metadata);
    sse.send(session.id, 'message', serializeMsg(assistantMsg));

    // Device control
    if (llmResponse.device_intent && llmResponse.device_intent !== 'neutral') {
      deviceManager.setIntent(llmResponse.device_intent);
    } else if (session.phase !== 'device') {
      deviceManager.setIntent(llmResponse.device_intent || 'neutral');
    }
    sse.send(session.id, 'device', { intent: llmResponse.device_intent || 'neutral' });

    // Audio clip
    const clip = audioManager.getClip(session.id, card.name, llmResponse.audio_category);
    if (clip) sse.send(session.id, 'audio', { url: clip, category: llmResponse.audio_category });

    // Phase handover
    if (llmResponse.phase_trigger === 'handover' && session.phase !== 'device') {
      db.updateSessionPhase(session.id, 'device');
      sse.send(session.id, 'phase', { phase: 'device' });
      resetSilenceTimer(session.id, card);
    }

    // Image generation (async — fires and delivers later)
    if (llmResponse.image_request.send) {
      generateAndDeliver(session.id, card, llmResponse.image_request.scene);
    }

  } catch (err) {
    console.error('[messages] Error processing message:', err.message);
    sse.send(session.id, 'typing', { visible: false });
    sse.send(session.id, 'server_error', { message: 'Something went wrong, try again.' });
  }
});

function serializeMsg(msg) {
  return {
    id: msg.id,
    session_id: msg.session_id,
    role: msg.role,
    content: msg.content,
    metadata: msg.metadata,
    created_at: msg.created_at,
  };
}

async function generateAndDeliver(sessionId, card, scene) {
  try {
    console.log(`[images] Generating for session ${sessionId}: "${scene}"`);
    const url = await imageGenerator.generate(card, scene, sessionId);
    const imgMsg = db.addMessage(sessionId, 'image', url, { scene });
    sse.send(sessionId, 'image', { url, messageId: imgMsg.id, created_at: imgMsg.created_at });
  } catch (err) {
    console.error('[images] Generation failed:', err.message);
  }
}

module.exports = router;
