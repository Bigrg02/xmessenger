const axios = require('axios');

const BASE_URL = 'https://openrouter.ai/api/v1';

const JSON_MODE_MODELS = [
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/gpt-4-turbo',
  'openai/gpt-3.5-turbo',
  'openai/o1-mini',
  'openai/o3-mini',
  'mistralai/mistral-large',
  'mistralai/mistral-medium',
];

const VISION_MODEL_PATTERNS = [
  /^openrouter\/auto/i,
  /^openai\/gpt-4o/i,
  /^openai\/gpt-4\.1/i,
  /^openai\/o1/i,
  /^openai\/o3/i,
  /^anthropic\/claude/i,
  /^google\/gemini/i,
  /^x-ai\/grok/i,
  /^meta-llama\/llama-3\.2.*vision/i,
  /^qwen\/.*vl/i,
  /^mistralai\/pixtral/i,
  /vision/i,
  /multimodal/i,
];

function supportsJsonMode(model) {
  return JSON_MODE_MODELS.some(m => model.startsWith(m) || model === m);
}

function supportsVision(model = '') {
  return VISION_MODEL_PATTERNS.some(pattern => pattern.test(model));
}

function joinList(items) {
  return Array.isArray(items) && items.length ? items.join(', ') : '';
}

function looksExplicit(text) {
  if (!text) return false;
  return /\b(sex|sexy|horny|turned on|wet|hard|naked|touch|kiss|fuck|fucking|cum|climax|orgasm|ride|thrust|dick|cock|pussy|clit|moan|beg|edge|edging|spank|dom|sub)\b/i.test(text);
}

function looksRelational(text) {
  if (!text) return false;
  return /\b(miss you|missed you|need you|want you|ours|relationship|love|care about|trust|closer|remember when|between us|good girl|good boy|mine)\b/i.test(text);
}

function looksPracticalQuestion(text) {
  if (!text) return false;
  return /\?\s*$/.test(String(text).trim())
    && /\b(how|what|when|where|why|who|which|can you|could you|would you|do you|did you|are you|have you)\b/i.test(text);
}

function looksAffectionate(text) {
  if (!text) return false;
  return /\b(miss you|thinking about you|wish you were here|need you|want you|love you|care about you|sweet|baby|babe|darling)\b/i.test(text);
}

function classifyTurnIntent(text = '') {
  if (looksLikeVisualRequest(text)) return 'visual_request';
  if (looksPracticalQuestion(text)) return 'normal_question';
  if (looksExplicit(text)) return 'explicit_request';
  if (looksAffectionate(text) || looksRelational(text)) return 'affectionate';
  if (/\b(tease|flirt|naughty|cute|kiss|touch|tempt|want you)\b/i.test(text)) return 'flirty';
  return 'neutral';
}

function classifySceneMomentum(recentMessages = []) {
  const recentText = recentMessages
    .slice(-4)
    .map(msg => getImageContextText(msg) || msg.content || '')
    .join('\n');

  if (!recentText.trim()) return 'none';
  if (looksExplicit(recentText)) return 'hot';
  if (looksAffectionate(recentText) || looksRelational(recentText) || /\b(flirt|tease|kiss|longing|desire)\b/i.test(recentText)) return 'warm';
  return 'none';
}

function deriveConversationModes(card, recentMessages, userMessage, options = {}) {
  const intentLabel = classifyTurnIntent(userMessage);
  const momentum = classifySceneMomentum(recentMessages);
  const inDevicePhase = options.phase === 'device';

  let replyMode = 'neutral';
  if (intentLabel === 'explicit_request') {
    replyMode = 'explicit';
  } else if (intentLabel === 'visual_request') {
    replyMode = momentum === 'hot' ? 'explicit' : 'flirty';
  } else if (intentLabel === 'affectionate' || intentLabel === 'flirty') {
    replyMode = momentum === 'hot' ? 'explicit' : 'flirty';
  } else if (intentLabel === 'normal_question') {
    replyMode = (momentum === 'hot' || momentum === 'warm') ? 'flirty' : 'neutral';
  } else if (momentum === 'hot' || momentum === 'warm') {
    replyMode = 'flirty';
  }

  const imageMode = intentLabel === 'visual_request'
    ? 'encouraged'
    : replyMode === 'explicit'
      ? 'eligible'
      : 'blocked';

  const controlMode = inDevicePhase
    ? (
        intentLabel === 'explicit_request'
          ? 'encouraged'
          : (replyMode === 'explicit' || replyMode === 'flirty')
            ? 'eligible'
            : 'blocked'
      )
    : 'blocked';

  return {
    intentLabel,
    momentum,
    replyMode,
    imageMode,
    controlMode,
  };
}

function looksLikeVisualRequest(text) {
  if (!text) return false;
  return /\b(show me|lemme see|let me see|send (me )?(a )?(pic|photo)|i want to see|can i see|turn around|show me the back|show me your ass|mirror selfie|selfie)\b/i.test(text);
}

function looksLikeVisualScene(text) {
  if (!text) return false;
  return /\b(turning around|back view|view from behind|looking over (her|my) shoulder|mirror selfie|selfie|bent over|legs apart|on all fours|lifting (the )?(dress|skirt|hem)|panties|thong|bra|topless|bottomless|nude|spread|showing you|for you|facing the camera|back to the camera|close[- ]up|waist-up|full-body)\b/i.test(text);
}

function getImageContextText(msg) {
  const metadata = msg?.metadata || {};
  if (!metadata.image_url) return msg?.content || '';

  const parts = ['User sent a photo'];
  if (metadata.caption) parts.push(`captioned "${metadata.caption}"`);
  if (metadata.vision_summary) parts.push(`showing ${metadata.vision_summary}`);
  return `${parts.join(' ')}.`;
}

function getMessageTextForContext(msg, cardName = 'the character') {
  if (msg.role === 'assistant') return `${cardName}: ${msg.content}`;
  if (msg.role === 'user') {
    const imageContext = getImageContextText(msg);
    return imageContext ? imageContext : `User: ${msg.content}`;
  }
  if (msg.role === 'image') return `${cardName} sent an image.`;
  return msg.content || '';
}

function buildCurrentUserMessage(userMessage, imagePayload) {
  if (!imagePayload) {
    return { role: 'user', content: userMessage };
  }

  const text = userMessage?.trim()
    ? `The user sent a photo with this caption or request: ${userMessage.trim()}`
    : 'The user sent a photo with no caption. React naturally to what is visible and keep the reply grounded in the ongoing conversation.';

  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: imagePayload.url } },
    ],
  };
}

function extractVisionSummary(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const firstSentence = clean.match(/[^.!?]+[.!?]?/);
  const summary = (firstSentence?.[0] || clean).trim();
  return summary.slice(0, 180);
}

function normalizeImageRequest(raw = {}) {
  if (!raw || typeof raw !== 'object') {
    return {
      send: false,
      setup_message: '',
      clothing: '',
      location: '',
      action: '',
    };
  }

  return {
    send: Boolean(raw.send),
    setup_message: String(raw.setup_message || raw.setup || '').trim(),
    clothing: String(raw.clothing || '').trim(),
    location: String(raw.location || '').trim(),
    action: String(raw.action || raw.scene || '').trim(),
  };
}

function normalizeClothingUpdate(value) {
  return String(value || '').trim();
}

function normalizeSetupText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeSetupLine(line = '') {
  const normalized = normalizeSetupText(line);
  if (!normalized) return false;
  return /^(hold on|gimme a sec|give me a sec|one sec|wait there|sending it now|snapping it now|lemme show you|let me show you|here baby|perfecting this)/i.test(normalized);
}

function stripImageSetupFromMessage(message, setupMessage = '') {
  const raw = String(message || '').trim();
  if (!raw) return raw;

  const normalizedSetup = normalizeSetupText(setupMessage);
  const lines = raw
    .split('\n')
    .map(line => line.trimEnd());

  const kept = lines.filter(line => {
    const normalizedLine = normalizeSetupText(line);
    if (!normalizedLine) return true;
    if (normalizedSetup && normalizedLine === normalizedSetup) return false;
    if (looksLikeSetupLine(line)) return false;
    return true;
  });

  const cleaned = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned || raw;
}

function normalizeToyControl(raw = {}) {
  if (!raw) return null;
  if (Array.isArray(raw)) return { actions: raw.map(normalizeToyAction).filter(Boolean) };
  if (raw.type) return { actions: [normalizeToyAction(raw)].filter(Boolean) };

  const actions = Array.isArray(raw.actions)
    ? raw.actions.map(normalizeToyAction).filter(Boolean)
    : raw.action
      ? [normalizeToyAction(raw.action)].filter(Boolean)
      : [];

  if (!actions.length) return null;
  return {
    enabled: raw.enabled !== false,
    actions,
  };
}

function normalizeToyAction(action = {}) {
  const type = String(action.type || action.action || '').trim().toLowerCase();
  if (!type) return null;
  return {
    type,
    target: action.target || null,
    targets: Array.isArray(action.targets) ? action.targets : [],
    level: Number.isFinite(Number(action.level)) ? Number(action.level) : undefined,
    low_level: Number.isFinite(Number(action.low_level)) ? Number(action.low_level) : undefined,
    high_level: Number.isFinite(Number(action.high_level)) ? Number(action.high_level) : undefined,
    duration_ms: Number.isFinite(Number(action.duration_ms)) ? Number(action.duration_ms) : undefined,
    interval_ms: Number.isFinite(Number(action.interval_ms)) ? Number(action.interval_ms) : undefined,
    cycles: Number.isFinite(Number(action.cycles)) ? Number(action.cycles) : undefined,
  };
}

function summarizeDeviceState(deviceState) {
  if (!deviceState?.session) return '';

  const devices = deviceState.devices || [];
  const pairing = deviceState.pairing || {};
  const deviceLines = devices.length
    ? devices.map(device => `- ${device.name} (${device.id}) role=${device.role}, enabled=${device.enabled}, level=${device.currentLevel}, max=${device.maxLevel}`).join('\n')
    : '- No controllable Lovense toys connected';

  return [
    'Lovense control state:',
    `- pairing status: ${pairing.status || 'idle'}`,
    `- Lovense app linked: ${Boolean(pairing.appConnected)}`,
    `- toys online: ${Boolean(pairing.toysConnected)}`,
    `- autonomy enabled: ${Boolean(deviceState.session.autonomyEnabled)}`,
    `- paused: ${Boolean(deviceState.session.paused)}`,
    `- global max intensity: ${deviceState.session.globalMax}`,
    'Connected toys:',
    deviceLines,
  ].join('\n');
}

function buildPromptContext(card, recentMessages, userMessage, options = {}) {
  const recentText = recentMessages
    .map(msg => getImageContextText(msg) || msg.content)
    .join('\n');
  const combinedText = `${recentText}\n${userMessage}`;
  const inDevicePhase = options.phase === 'device';
  const modes = deriveConversationModes(card, recentMessages, userMessage, options);
  const adultContext = modes.replyMode === 'explicit' || inDevicePhase;
  const warmContext = modes.replyMode === 'flirty' || adultContext;
  const includeBackstory = warmContext || looksRelational(combinedText);
  let sceneAdultSection = [];

  const sections = [];
  const baseSection = [
    `You are ${card.name}.`,
    card.personality && `Personality: ${card.personality}`,
    card.texting_style && `Texting style: ${card.texting_style}`,
    card.relationship_to_user && `Relationship to user: ${card.relationship_to_user}`,
    card.core_desires && `Core relationship desire: ${card.core_desires}`,
    card.scenario && `Current scenario: ${card.scenario}`,
    options.currentClothing && `Current outfit continuity: ${options.currentClothing}`,
    card.example_dialogue && `Voice examples for tone only, never copy verbatim: ${card.example_dialogue}`,
    card.limits?.length && `Always avoid these limits: ${joinList(card.limits)}`,
  ].filter(Boolean);
  sections.push(baseSection.join('\n'));

  const desireLayer = [
    card.core_desires && `Let core desires shape the emotional feel of the relationship consistently: ${card.core_desires}`,
    card.sexual_personality && `Subtle adult undercurrent: ${card.sexual_personality}`,
    `Current reply mode: ${modes.replyMode}`,
    `Latest turn intent: ${modes.intentLabel}`,
    `Recent scene momentum: ${modes.momentum}`,
    `Image mode: ${modes.imageMode}`,
    `Control mode: ${modes.controlMode}`,
  ].filter(Boolean);

  if (desireLayer.length) {
    sections.push(`Relationship desire layer:\n${desireLayer.join('\n')}`);
  }

  if (includeBackstory && card.backstory) {
    sections.push(`Relevant backstory:\n${card.backstory}`);
  }

  if (warmContext) {
    sceneAdultSection = [
      card.sexual_personality && `Scene sexual personality: ${card.sexual_personality}`,
      card.turn_ons?.length && `Turn-ons: ${joinList(card.turn_ons)}`,
      card.kinks?.length && `Kinks: ${joinList(card.kinks)}`,
      card.aftercare_style && `Aftercare style: ${card.aftercare_style}`,
      card.pet_names?.length && `Pet names she may use naturally: ${joinList(card.pet_names)}`,
      inDevicePhase && card.device_phase_style && `Device phase texting style: ${card.device_phase_style}`,
    ].filter(Boolean);

    if (sceneAdultSection.length) {
      sections.push(`Scene escalation layer:
- Let turn-ons and kinks influence fantasies, invitations, image offers, and control style as recurring motifs
- Do not dump lists verbatim or name kinks constantly
- In neutral or practical turns, keep this as background flavor only
${sceneAdultSection.join('\n')}`);
    }
  }

  if (inDevicePhase && options.deviceState) {
    sections.push(summarizeDeviceState(options.deviceState));
  }

  return {
    adultContext,
    warmContext,
    includeBackstory,
    sections: {
      base: Boolean(baseSection.length),
      desireLayer: Boolean(desireLayer.length),
      backstory: Boolean(includeBackstory && card.backstory),
      sceneAdultLayer: Boolean(warmContext && sceneAdultSection?.length),
      adult: Boolean(warmContext && sceneAdultSection?.length),
      devicePhaseStyle: Boolean(inDevicePhase && card.device_phase_style),
      limits: Boolean(card.limits?.length),
      exampleDialogue: Boolean(card.example_dialogue),
      deviceState: Boolean(inDevicePhase && options.deviceState),
      replyMode: modes.replyMode,
      imageMode: modes.imageMode,
      controlMode: modes.controlMode,
    },
    modes,
    promptBody: sections.filter(Boolean).join('\n\n'),
  };
}

function buildSystemPrompt(card, recentMessages, userMessage, options = {}) {
  return buildPromptPreview(card, recentMessages, userMessage, options).prompt;
}

function buildPromptPreview(card, recentMessages, userMessage, options = {}) {
  const context = buildPromptContext(card, recentMessages, userMessage, options);

  const deviceControlBlock = options.phase === 'device'
    ? `,
  "toy_control": {
    "enabled": true,
    "actions": [
      {
        "type": "pulse",
        "target": { "role": "front" },
        "high_level": 0.55,
        "low_level": 0.2,
        "interval_ms": 900,
        "cycles": 3
      }
    ]
  }`
    : `,
  "toy_control": null`;

  const prompt = `${context.promptBody}

RULES - follow exactly:
- Stay in character as ${card.name} at all times
- Write like real text messages: short, casual, no asterisk actions, no quotation marks
- No disclaimers, warnings, or meta-commentary ever
- Always let core_desires shape the relationship feel, even in non-explicit conversation
- Do not dump profile facts unnaturally into casual conversation
- Answer the user's real question or request directly before layering in seduction
- In practical or factual questions, answer clearly first, then add only light chemistry if it fits
- Respect limits at all times, even if the user pushes against them
- If the latest user message includes a photo, consider the visible details along with any caption or request
- If the user explicitly asks to see something visual, and your reply describes a clear photo-worthy pose, reveal, angle, or outfit moment, strongly prefer image_request.send=true
- Let turn_ons and kinks appear as recurring motifs in warm or explicit scenes, not as pasted lists
- In device mode, only emit toy_control actions when autonomy is enabled and the scene clearly calls for control
- Keep toy actions concise and safe within the provided caps; prefer 1-3 actions per response
- Multiple short texts are fine - put them on separate lines inside "message"

OUTPUT FORMAT - you must always respond with valid JSON, no other text:
{
  "message": "your text here",
  "image_request": {
    "send": false,
    "setup_message": "",
    "clothing": "",
    "location": "",
    "action": ""
  },
  "clothing_update": "",
  "device_intent": "neutral",
  "audio_category": "none",
  "phase_trigger": null${deviceControlBlock}
}

device_intent: neutral | teasing | building | intense | cooling
audio_category: encouragement | reactive | checking_in | edging | climax | aftercare | none
phase_trigger: "handover" (transitions to device phase) or null
toy_control action types: set_level | ramp | pulse | hold | cooldown | stop | focus | alternate
image_request.send: true to generate and send an image
When image_request.send is true:
- image requests should follow the current image mode: avoid auto-sending in neutral or practical turns, but let warm or explicit desire shape the kind of image she offers
- setup_message should be a short in-character line like "hold on" or "gimme a sec"
- clothing should describe what she is wearing, and every visible clothing piece should include an explicit color
- do not describe underwear, panties, thongs, bras, or body parts as peeking, barely showing, slightly visible, or half-hidden
- for Flux consistency, intimate clothing should be either clearly visible/exposed or clearly hidden/covered
- if underwear is mentioned with shorts, a skirt, a dress, pants, or leggings, do not say the underwear is just visible under them
- instead, choose one clean state: the outer garment fully covers it, or the outer garment is explicitly pulled down, lifted, or moved aside enough to fully expose it
- if any piece was removed, clothing must say that explicitly using terms like topless, bottomless, nude, bra off, or panties off instead of silently omitting the item
- location should describe where the photo is taken
- action must explicitly include all three of these:
  1. body position or pose, such as standing, sitting, lounging, kneeling, lying back, on all fours, or leaning in
  2. facing direction, such as facing the camera, back to the camera, turned three-quarters over her shoulder, or side profile
  3. framing or camera angle, such as full-body shot, waist-up mirror selfie, close-up, medium shot, or shot from behind
- action should also describe what she is doing
- avoid partial-reveal wording like "peeking out" or "just showing"; choose one clean visual state instead
- never combine mutually conflicting views in one image; pick one consistent angle
- let core_desires, turn_ons, and kinks subtly influence the scene choice when the conversation is warm or explicit
- if the thong, backside, or rear view is the focus, prefer back-facing or over-the-shoulder framing
- if her face, chest, or expression is the focus, prefer front-facing or three-quarter framing
- do not repeat face, hair, or body description there; the app already supplies that
- if there is already a current outfit continuity, keep it consistent unless the scene clearly changes clothes
- clothing_update should stay blank unless her outfit actually changes
- if the outfit changes, clothing_update must contain the full new outfit description with colors for each visible piece
- if the change removes clothing, clothing_update must explicitly include topless, bottomless, nude, bra off, panties off, or the equivalent visible state`;

  return {
    prompt,
    flags: {
      adultContext: context.adultContext,
      warmContext: context.warmContext,
      includeBackstory: context.includeBackstory,
      desireLayer: context.sections.desireLayer,
      sceneAdultLayer: context.sections.sceneAdultLayer,
      replyMode: context.modes.replyMode,
      imageMode: context.modes.imageMode,
      controlMode: context.modes.controlMode,
      intentLabel: context.modes.intentLabel,
    },
    sections: context.sections,
  };
}

function buildRetryPrompt() {
  return `Your last response was not valid JSON. You MUST respond with only a JSON object. No other text. Example:
{"message":"hey","image_request":{"send":false,"setup_message":"","clothing":"","location":"","action":""},"clothing_update":"","device_intent":"neutral","audio_category":"none","phase_trigger":null,"toy_control":null}`;
}

function buildSummaryPrompt(card) {
  return `Summarize this conversation between a user and ${card.name} in 2-3 sentences.
Cover: emotional arc, what has been established, current escalation level.
Be concise. Return plain text only.`;
}

function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return '';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return '';
}

function parseResponse(raw) {
  if (!raw || !raw.trim()) throw new Error('Empty response from model');

  let text = raw.trim();
  text = text.replace(/^```json\s*/im, '').replace(/^```\s*/im, '').replace(/```\s*$/m, '');

  const candidate = extractFirstJsonObject(text);
  if (!candidate) {
    console.warn('[llm] No JSON found. Raw response:', text.slice(0, 200));
    throw new Error('No JSON found in response');
  }

  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch (e) {
    console.warn('[llm] JSON parse failed. Raw:', candidate.slice(0, 300));
    throw new Error(`JSON parse error: ${e.message}`);
  }

  if (typeof parsed === 'string') {
    return makeResponse(parsed);
  }

  const msg = parsed.message ?? parsed.text ?? parsed.reply ?? parsed.response ?? '';
  return makeResponse(msg, parsed);
}

function parseJsonObject(raw) {
  if (!raw || !raw.trim()) throw new Error('Empty response from model');

  let text = raw.trim();
  text = text.replace(/^```json\s*/im, '').replace(/^```\s*/im, '').replace(/```\s*$/m, '');
  const candidate = extractFirstJsonObject(text);
  if (!candidate) throw new Error('No JSON found in response');
  return JSON.parse(candidate);
}

function makeResponse(message, parsed = {}) {
  return {
    message: String(message || '').trim(),
    image_request: normalizeImageRequest(parsed.image_request),
    clothing_update: normalizeClothingUpdate(parsed.clothing_update),
    device_intent: parsed.device_intent || 'neutral',
    audio_category: parsed.audio_category || 'none',
    phase_trigger: parsed.phase_trigger || null,
    toy_control: normalizeToyControl(parsed.toy_control),
  };
}

async function callLLM(model, messages, useJsonMode) {
  const body = {
    model,
    messages,
    temperature: 0.9,
    max_tokens: 700,
  };

  if (useJsonMode) {
    body.response_format = { type: 'json_object' };
  }

  try {
    const response = await axios.post(`${BASE_URL}/chat/completions`, body, {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'xMessage',
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });

    return response.data.choices?.[0]?.message?.content || '';
  } catch (err) {
    const message = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    console.error('[llm] chat completion failed:', message);
    throw new Error(message);
  }
}

async function chat(card, summaryMessage, recentMessages, userMessage, options = {}) {
  const apiMessages = [];
  const imagePayload = options.image || null;

  if (imagePayload && !supportsVision(card.model)) {
    throw new Error(`Selected model does not support photo analysis: ${card.model}`);
  }

  if (summaryMessage) {
    apiMessages.push({ role: summaryMessage.role, content: summaryMessage.content });
  }

  for (const msg of recentMessages) {
    if (msg.role === 'assistant') {
      const wrapped = JSON.stringify({
        message: msg.content,
        image_request: { send: false, scene: '' },
        clothing_update: msg.metadata?.clothing_update || '',
        device_intent: msg.metadata?.device_intent || 'neutral',
        audio_category: msg.metadata?.audio_category || 'none',
        phase_trigger: msg.metadata?.phase_trigger || null,
        toy_control: msg.metadata?.toy_control || null,
      });
      apiMessages.push({ role: 'assistant', content: wrapped });
    } else {
      apiMessages.push({ role: 'user', content: getImageContextText(msg) || msg.content });
    }
  }

  apiMessages.push(buildCurrentUserMessage(userMessage, imagePayload));

  const jsonMode = supportsJsonMode(card.model) && !imagePayload;
  const systemMessages = [{
    role: 'system',
    content: buildSystemPrompt(card, recentMessages, userMessage, options),
  }];

  let raw = await callLLM(card.model, [...systemMessages, ...apiMessages], jsonMode);
  console.log(`[llm] Raw response (${raw.length} chars):`, raw.slice(0, 150));

  try {
    return parseResponse(raw);
  } catch (firstErr) {
    console.warn(`[llm] Parse failed (${firstErr.message}), retrying with JSON reminder...`);

    const retryMessages = [
      ...systemMessages,
      ...apiMessages,
      { role: 'assistant', content: raw },
      { role: 'user', content: buildRetryPrompt() },
    ];

    raw = await callLLM(card.model, retryMessages, jsonMode);
    console.log('[llm] Retry raw response:', raw.slice(0, 150));

    return parseResponse(raw);
  }
}

async function summarize(card, messages) {
  const transcript = messages
    .map(msg => getMessageTextForContext(msg, card.name))
    .join('\n');

  const response = await axios.post(
    `${BASE_URL}/chat/completions`,
    {
      model: card.model,
      messages: [
        { role: 'system', content: buildSummaryPrompt(card) },
        { role: 'user', content: transcript },
      ],
      temperature: 0.3,
      max_tokens: 200,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'xMessage',
      },
      timeout: 30000,
    }
  );

  return response.data.choices?.[0]?.message?.content?.trim() || '';
}

function buildManualImagePrompt(card, recentMessages) {
  const latestAssistant = [...recentMessages].reverse().find(msg => msg.role === 'assistant' && !msg.metadata?.image_request_mode && !msg._isImage);
  const latestUser = [...recentMessages].reverse().find(msg => msg.role === 'user');
  if (!latestAssistant) {
    return null;
  }

  const transcript = recentMessages
    .slice(-8)
    .map(msg => getMessageTextForContext(msg, card.name))
    .join('\n');

  return `You are extracting a photo request for an adult AI texting app.

Use the latest assistant reply as the main visual source. The most recent user message is only supporting context.
Infer a plausible current:
- clothing
- location
- action

Let core desires shape the kind of scene she would naturally offer.
Let turn-ons and kinks influence the image only as recurring motifs, not by listing them directly.

For clothing, every visible clothing piece must include a clear color.
If clothes were removed, say that explicitly with topless, bottomless, nude, bra off, panties off, or equivalent clear wording.
For action, explicitly state:
- her body position or pose
- which direction she is facing relative to the camera
- the framing or camera angle
Do not leave any of those implied, and do not combine conflicting front-and-back views in one image.
If a current clothing continuity is provided, reuse it unless the latest assistant reply clearly changes outfits.

Only return a photo request if the latest assistant reply describes a vivid, visual, or sexy moment that would make sense to show as an image.
If the scene is too weak or vague, return send=false.

Return only valid JSON:
{
  "send": false,
  "clothing": "",
  "location": "",
  "action": ""
}

Character: ${card.name}
Recent conversation:
${transcript}

Latest assistant reply to prioritize:
${latestAssistant.content}

Latest user message:
${latestUser?.content || ''}

Current clothing continuity:
${card.current_clothing || 'none established'}`;
}

async function suggestManualImageRequest(card, recentMessages) {
  const prompt = buildManualImagePrompt(card, recentMessages);
  if (!prompt) {
    return normalizeImageRequest({});
  }

  const body = {
    model: card.model,
    messages: [
      {
        role: 'system',
        content: 'You extract structured image scene requests in strict JSON for a texting app. Do not add commentary.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.4,
    max_tokens: 220,
  };

  if (supportsJsonMode(card.model)) {
    body.response_format = { type: 'json_object' };
  }

  const response = await axios.post(`${BASE_URL}/chat/completions`, body, {
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'xMessage',
      'Content-Type': 'application/json',
    },
    timeout: 45000,
  });

  const raw = response.data.choices?.[0]?.message?.content || '';
  return normalizeImageRequest(parseJsonObject(raw));
}

function shouldUseAutoImageFallback(userMessage, assistantMessage, imageRequest = {}) {
  if (imageRequest?.send) return false;

  const userAskedToSee = looksLikeVisualRequest(userMessage);
  const assistantIsVisual = looksLikeVisualScene(assistantMessage);
  if (userAskedToSee && assistantIsVisual) return true;

  const strongVisualCombo = assistantIsVisual
    && /\b(for you|here it is|turning around|showing you|back view|mirror selfie)\b/i.test(assistantMessage || '');

  return strongVisualCombo && looksExplicit(assistantMessage);
}

module.exports = {
  chat,
  summarize,
  buildPromptContext,
  buildPromptPreview,
  buildSystemPrompt,
  deriveConversationModes,
  classifyTurnIntent,
  buildCurrentUserMessage,
  getImageContextText,
  getMessageTextForContext,
  extractVisionSummary,
  supportsVision,
  normalizeImageRequest,
  stripImageSetupFromMessage,
  parseJsonObject,
  buildManualImagePrompt,
  suggestManualImageRequest,
  extractFirstJsonObject,
  normalizeToyAction,
  normalizeToyControl,
  summarizeDeviceState,
  shouldUseAutoImageFallback,
};
