const express = require('express');
const multer = require('multer');

const router = express.Router();
const db = require('../db');
const sse = require('../modules/sseManager');
const llmClient = require('../modules/llmClient');
const sessionManager = require('../modules/sessionManager');
const deviceManager = require('../modules/deviceManager');
const audioManager = require('../modules/audioManager');
const imageGenerator = require('../modules/imageGenerator');
const intentDetector = require('../modules/intentDetector');
const { saveChatImage } = require('../modules/chatUploads');
const { loadCard } = require('./characters');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

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
  deviceManager.setActiveSession(session.id);
  sse.send(session.id, 'device_state', deviceManager.status());
});

// POST /api/sessions/:id/messages — send a text message
router.post('/:id/messages', async (req, res) => {
  const { content, is_voice } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });

  let session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const card = loadCard(session.character_name.toLowerCase());
  if (!card) return res.status(500).json({ error: 'Character card missing' });

  if (is_voice && session.phase === 'device') {
    handleVoiceIntent(session, card, content);
  }

  const userMsg = db.addMessage(session.id, 'user', content.trim());
  res.status(202).json({ ok: true, message: serializeMsg(userMsg) });

  processMessage(session, card, userMsg, content.trim(), { phase: session.phase }).catch(err => {
    console.error('[messages] Error processing message:', err.message);
    sse.send(session.id, 'typing', { visible: false });
    sse.send(session.id, 'server_error', { message: 'Something went wrong, try again.' });
  });
});

// POST /api/sessions/:id/messages/photo — send a photo message with optional caption
router.post('/:id/messages/photo', upload.single('image'), async (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const card = loadCard(session.character_name.toLowerCase());
  if (!card) return res.status(500).json({ error: 'Character card missing' });
  if (!req.file) return res.status(400).json({ error: 'image required' });
  if (!llmClient.supportsVision(card.model)) {
    return res.status(400).json({ error: `The selected model does not support photo analysis: ${card.model}` });
  }

  let uploadInfo;
  try {
    uploadInfo = saveChatImage(req.file, session.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const caption = String(req.body.content || '').trim();
  const storedContent = caption || 'Sent a photo';
  const metadata = {
    image_url: uploadInfo.url,
    caption,
    content_type: uploadInfo.contentType,
    original_filename: uploadInfo.originalFilename,
    kind: 'user_upload',
    vision_summary: '',
  };

  const userMsg = db.addMessage(session.id, 'user', storedContent, metadata);
  res.status(202).json({ ok: true, message: serializeMsg(userMsg) });

  processMessage(session, card, userMsg, caption, {
    phase: session.phase,
    image: {
      url: `data:${uploadInfo.contentType};base64,${req.file.buffer.toString('base64')}`,
      contentType: uploadInfo.contentType,
      caption,
    },
  }).catch(err => {
    console.error('[messages] Error processing photo message:', err.message);
    sse.send(session.id, 'typing', { visible: false });
    sse.send(session.id, 'server_error', { message: err.message.includes('does not support photo analysis') ? err.message : 'Something went wrong, try again.' });
  });
});

function handleVoiceIntent(session, card, content) {
  const intent = intentDetector.detect(content);
  if (!intent.hasIntent) return;
  deviceManager.applyVoiceIntent(intent);
  sse.send(session.id, 'device', {
    intent: intent.urgency || 'adjusted',
    delta: intent.intensityDelta,
    target: intent.bodyTarget,
  });
}

function resolveClothingContinuity(session, llmResponse) {
  const currentClothing = String(session.current_clothing || '').trim();
  const clothingUpdate = String(llmResponse.clothing_update || '').trim();
  const imageClothing = String(llmResponse.image_request?.clothing || '').trim();

  if (clothingUpdate) {
    return {
      currentClothing: clothingUpdate,
      imageClothing: imageClothing || clothingUpdate,
    };
  }

  if (currentClothing) {
    return {
      currentClothing,
      imageClothing: currentClothing,
    };
  }

  return {
    currentClothing: imageClothing,
    imageClothing,
  };
}

async function processMessage(session, card, userMsg, userMessage, options = {}) {
  sse.send(session.id, 'message', serializeMsg(userMsg));
  sse.send(session.id, 'typing', { visible: true });

  if (session.phase === 'device') resetSilenceTimer(session.id, card);

  const { messages, summaryMessage } = await sessionManager.buildContext(session, card);
  const recentMessages = messages.filter(msg => msg.id !== userMsg.id);

  const llmResponse = await llmClient.chat(card, summaryMessage, recentMessages, userMessage, {
    phase: session.phase,
    image: options.image || null,
    deviceState: deviceManager.status(),
    currentClothing: session.current_clothing || '',
  });
  const conversationModes = llmClient.deriveConversationModes(card, recentMessages, userMessage, {
    phase: session.phase,
    deviceState: deviceManager.status(),
    currentClothing: session.current_clothing || '',
  });

  if (conversationModes.imageMode === 'blocked') {
    llmResponse.image_request.send = false;
    llmResponse.image_request.setup_message = '';
  }

  if (conversationModes.controlMode === 'blocked') {
    llmResponse.toy_control = null;
    if (session.phase === 'device') {
      llmResponse.device_intent = 'neutral';
    }
  }

  if (
    conversationModes.imageMode !== 'blocked'
    && !llmResponse.image_request.send
    && llmClient.shouldUseAutoImageFallback(userMessage, llmResponse.message, llmResponse.image_request)
  ) {
    try {
      const fallbackRequest = await llmClient.suggestManualImageRequest({
        ...card,
        current_clothing: session.current_clothing || '',
      }, [
        ...recentMessages,
        {
          role: 'user',
          content: userMessage,
        },
        {
          role: 'assistant',
          content: llmResponse.message,
        },
      ]);

      if (fallbackRequest.send && fallbackRequest.action) {
        llmResponse.image_request = {
          ...fallbackRequest,
          setup_message: fallbackRequest.setup_message || 'hold on',
        };
      }
    } catch (err) {
      console.warn('[images] Auto image fallback failed:', err.message);
    }
  }

  if (llmResponse.image_request.send) {
    llmResponse.message = llmClient.stripImageSetupFromMessage(
      llmResponse.message,
      llmResponse.image_request.setup_message
    );
  }

  const clothingState = resolveClothingContinuity(session, llmResponse);
  if (clothingState.currentClothing !== String(session.current_clothing || '').trim()) {
    db.updateSessionClothing(session.id, clothingState.currentClothing || null);
    session = db.getSession(session.id);
  }
  if (clothingState.imageClothing) {
    llmResponse.image_request.clothing = clothingState.imageClothing;
  }

  sse.send(session.id, 'typing', { visible: false });

  const metadata = {
    device_intent: llmResponse.device_intent,
    audio_category: llmResponse.audio_category,
    phase_trigger: llmResponse.phase_trigger,
    image_requested: llmResponse.image_request.send,
    image_request: llmResponse.image_request,
    clothing_update: llmResponse.clothing_update || '',
    toy_control: llmResponse.toy_control,
  };
  const assistantMsg = db.addMessage(session.id, 'assistant', llmResponse.message, metadata);
  sse.send(session.id, 'message', serializeMsg(assistantMsg));

  if (options.image && userMsg.metadata?.image_url) {
    const updatedMetadata = {
      ...userMsg.metadata,
      vision_summary: llmClient.extractVisionSummary(llmResponse.message),
      vision_response_text: llmResponse.message,
      photo_debug: {
        message: llmResponse.message,
        image_request: llmResponse.image_request,
        clothing_update: llmResponse.clothing_update || '',
        device_intent: llmResponse.device_intent || 'neutral',
        audio_category: llmResponse.audio_category || 'none',
        phase_trigger: llmResponse.phase_trigger || null,
        toy_control: llmResponse.toy_control || null,
      },
    };
    db.updateMessageMetadata(userMsg.id, updatedMetadata);
    sse.send(session.id, 'message_metadata', {
      messageId: userMsg.id,
      metadata: updatedMetadata,
    });
  }

  if (session.phase === 'device' && llmResponse.toy_control) {
    deviceManager.applyStructuredControl(llmResponse.toy_control, 'character');
    sse.send(session.id, 'device', { intent: 'structured' });
  } else if (llmResponse.device_intent && llmResponse.device_intent !== 'neutral') {
    deviceManager.setIntent(llmResponse.device_intent);
  } else if (session.phase !== 'device') {
    deviceManager.setIntent(llmResponse.device_intent || 'neutral');
  }
  sse.send(session.id, 'device', { intent: llmResponse.device_intent || 'neutral' });

  const clip = audioManager.getClip(session.id, card.name, llmResponse.audio_category);
  if (clip) sse.send(session.id, 'audio', { url: clip, category: llmResponse.audio_category });

  if (llmResponse.phase_trigger === 'handover' && session.phase !== 'device') {
    db.updateSessionPhase(session.id, 'device');
    deviceManager.setActiveSession(session.id);
    sse.send(session.id, 'phase', { phase: 'device' });
    resetSilenceTimer(session.id, card);
  }

  if (llmResponse.image_request.send) {
    const setupText = llmResponse.image_request.setup_message || 'hold on';
    const setupMsg = db.addMessage(session.id, 'assistant', setupText, {
      image_request_mode: 'auto_setup',
      image_requested: true,
    });
    sse.send(session.id, 'message', serializeMsg(setupMsg));
    generateAndDeliver(session.id, card, llmResponse.image_request, {
      mode: 'auto',
      character_slug: session.character_name,
      source_message_id: assistantMsg.id,
      setup_message_id: setupMsg.id,
    });
  }
}

router.post('/:id/images/manual', async (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const card = loadCard(session.character_name.toLowerCase());
  if (!card) return res.status(500).json({ error: 'Character card missing' });

  try {
    const recentMessages = db.getRecentMessages(session.id, 12);
    const lastAssistant = [...recentMessages].reverse().find(msg => msg.role === 'assistant' && !msg.metadata?.image_request_mode);
    if (!lastAssistant) {
      return res.status(400).json({ error: 'No recent assistant scene to generate from yet.' });
    }

    const imageRequest = await llmClient.suggestManualImageRequest({
      ...card,
      current_clothing: session.current_clothing || '',
    }, recentMessages);
    if (!imageRequest.send || !imageRequest.action) {
      return res.status(400).json({ error: 'Not enough scene detail in the latest exchange to generate an image yet.' });
    }

    if (session.current_clothing && !imageRequest.clothing) {
      imageRequest.clothing = session.current_clothing;
    }

    generateAndDeliver(session.id, card, imageRequest, {
      mode: 'manual',
      character_slug: session.character_name,
      source_message_id: lastAssistant.id,
    });

    res.status(202).json({ ok: true, image_request: imageRequest });
  } catch (err) {
    console.error('[images] Manual generation failed:', err.message);
    res.status(500).json({ error: 'Failed to generate image from the latest exchange.' });
  }
});

router.post('/:id/images/:messageId/regenerate', async (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const card = loadCard(session.character_name.toLowerCase());
  if (!card) return res.status(500).json({ error: 'Character card missing' });

  const imageMsg = db.getMessageById(req.params.messageId);
  if (!imageMsg || imageMsg.session_id !== session.id || imageMsg.role !== 'image') {
    return res.status(404).json({ error: 'Generated image not found.' });
  }

  const promptText = String(imageMsg.metadata?.prompt_text || '').trim();
  if (!promptText) {
    return res.status(400).json({ error: 'This image does not have a saved prompt to regenerate.' });
  }

  regenerateImage(session.id, card, imageMsg, {
    character_slug: session.character_name,
  });

  return res.status(202).json({ ok: true });
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

async function generateAndDeliver(sessionId, card, imageRequest, options = {}) {
  try {
    console.log(`[images] Generating for session ${sessionId}:`, imageRequest);
    const result = await imageGenerator.generate(card, imageRequest, sessionId, {
      characterSlug: options.character_slug || card.name.toLowerCase(),
    });
    const metadata = {
      image_request_mode: options.mode || 'auto',
      image_request: imageRequest,
      prompt_sections: result.scene,
      prompt_text: result.promptText,
      reference_image: result.referenceImage || null,
      seed: result.seed ?? null,
      source_message_id: options.source_message_id || null,
      setup_message_id: options.setup_message_id || null,
    };
    const imgMsg = db.addMessage(sessionId, 'image', result.url, metadata);
    sse.send(sessionId, 'image', {
      url: result.url,
      messageId: imgMsg.id,
      created_at: imgMsg.created_at,
      metadata: imgMsg.metadata,
    });
  } catch (err) {
    console.error('[images] Generation failed:', err.message);
    sse.send(sessionId, 'server_error', { message: 'Image generation failed.' });
  }
}

async function regenerateImage(sessionId, card, imageMsg, options = {}) {
  try {
    console.log(`[images] Regenerating image ${imageMsg.id} for session ${sessionId}`);
    const existingMetadata = imageMsg.metadata || {};
    const promptText = String(existingMetadata.prompt_text || '').trim();
    const result = await imageGenerator.generateFromPrompt(card, promptText, sessionId, {
      characterSlug: options.character_slug || card.name.toLowerCase(),
      imageRequest: existingMetadata.image_request || {},
    });

    const metadata = {
      ...existingMetadata,
      prompt_text: result.promptText,
      prompt_sections: result.scene,
      reference_image: result.referenceImage || existingMetadata.reference_image || null,
      seed: result.seed ?? existingMetadata.seed ?? null,
      regenerated_at: Date.now(),
      regenerated_count: Number(existingMetadata.regenerated_count || 0) + 1,
    };

    const updated = db.updateMessageContentAndMetadata(imageMsg.id, result.url, metadata);
    sse.send(sessionId, 'image_replaced', {
      url: updated.content,
      messageId: updated.id,
      created_at: updated.created_at,
      metadata: updated.metadata,
    });
  } catch (err) {
    console.error('[images] Regeneration failed:', err.message);
    sse.send(sessionId, 'server_error', { message: 'Image regeneration failed.' });
  }
}

module.exports = router;
