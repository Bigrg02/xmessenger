const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPromptContext,
  buildPromptPreview,
  buildSystemPrompt,
  deriveConversationModes,
  buildCurrentUserMessage,
  getImageContextText,
  extractVisionSummary,
  extractFirstJsonObject,
  normalizeImageRequest,
  buildManualImagePrompt,
  normalizeToyControl,
  summarizeDeviceState,
  stripImageSetupFromMessage,
  shouldUseAutoImageFallback,
} = require('../src/modules/llmClient');
const { normalizeCard } = require('../src/modules/characterCard');
const { buildImagePrompt, buildClothingPrompt, buildActionPrompt } = require('../src/modules/imageGenerator');

function makeCard() {
  return normalizeCard({
    name: 'Allie',
    personality: 'Warm and teasing.',
    texting_style: 'Short, playful, intimate.',
    relationship_to_user: 'She already has chemistry with the user and likes building tension.',
    scenario: 'She is texting late at night after thinking about him all day.',
    example_dialogue: 'come here\nmissed that mouth',
    backstory: 'She gets attached when someone makes her feel safe.',
    core_desires: 'She wants emotional closeness and a slow, needy escalation.',
    sexual_personality: 'Playful, a little controlling, very praise-driven.',
    turn_ons: ['praise', 'teasing'],
    kinks: ['edging', 'dirty talk'],
    limits: ['humiliation'],
    aftercare_style: 'Very soft and reassuring afterward.',
    pet_names: ['baby', 'good boy'],
    device_phase_style: 'Short reactive texts only, max 6 words.',
  });
}

test('buildPromptContext keeps adult profile out of casual chat', () => {
  const context = buildPromptContext(
    makeCard(),
    [{ role: 'assistant', content: 'hey you' }],
    'how has your day been?',
    { phase: 'text', currentClothing: 'black lace bra and emerald thong' }
  );

  assert.equal(context.adultContext, false);
  assert.equal(context.warmContext, false);
  assert.match(context.promptBody, /Relationship to user:/);
  assert.match(context.promptBody, /Core relationship desire:/);
  assert.match(context.promptBody, /Relationship desire layer:/);
  assert.match(context.promptBody, /Current outfit continuity: black lace bra and emerald thong/);
  assert.match(context.promptBody, /Voice examples for tone only/);
  assert.match(context.promptBody, /Always avoid these limits:/);
  assert.doesNotMatch(context.promptBody, /Kinks:/);
  assert.doesNotMatch(context.promptBody, /Turn-ons:/);
});

test('buildPromptContext includes adult profile during explicit turns', () => {
  const context = buildPromptContext(
    makeCard(),
    [{ role: 'assistant', content: 'tell me what you want' }],
    'I want to fuck you slow and make you cum',
    { phase: 'text' }
  );

  assert.equal(context.adultContext, true);
  assert.equal(context.warmContext, true);
  assert.match(context.promptBody, /Core relationship desire:/);
  assert.match(context.promptBody, /Scene escalation layer:/);
  assert.match(context.promptBody, /Kinks: edging, dirty talk/);
  assert.match(context.promptBody, /Pet names she may use naturally:/);
});

test('buildSystemPrompt includes device phase style during device mode', () => {
  const prompt = buildSystemPrompt(
    makeCard(),
    [{ role: 'user', content: 'more' }],
    'dont stop',
    { phase: 'device' }
  );

  assert.match(prompt, /Device phase texting style:/);
  assert.match(prompt, /Respect limits at all times/);
});

test('buildPromptPreview returns prompt plus section metadata', () => {
  const preview = buildPromptPreview(
    makeCard(),
    [],
    'I want to fuck you slow and make you cum',
    { phase: 'device' }
  );

  assert.match(preview.prompt, /OUTPUT FORMAT - you must always respond with valid JSON/);
  assert.equal(preview.flags.adultContext, true);
  assert.equal(preview.flags.warmContext, true);
  assert.equal(preview.flags.includeBackstory, true);
  assert.equal(preview.sections.base, true);
  assert.equal(preview.sections.desireLayer, true);
  assert.equal(preview.sections.backstory, true);
  assert.equal(preview.sections.sceneAdultLayer, true);
  assert.equal(preview.flags.replyMode, 'explicit');
  assert.equal(preview.flags.controlMode, 'encouraged');
  assert.equal(preview.sections.devicePhaseStyle, true);
  assert.equal(preview.sections.limits, true);
});

test('deriveConversationModes answers practical questions with mixed tone after a hot scene', () => {
  const modes = deriveConversationModes(
    makeCard(),
    [
      { role: 'assistant', content: 'tell me how you want to fuck me' },
      { role: 'user', content: 'bend over for me' },
    ],
    'how was your day?',
    { phase: 'text' }
  );

  assert.equal(modes.intentLabel, 'normal_question');
  assert.equal(modes.momentum, 'hot');
  assert.equal(modes.replyMode, 'flirty');
  assert.equal(modes.imageMode, 'blocked');
});

test('deriveConversationModes keeps visual requests image-eligible without requiring explicit wording', () => {
  const modes = deriveConversationModes(
    makeCard(),
    [
      { role: 'assistant', content: 'missed you all day baby' },
    ],
    'let me see the back',
    { phase: 'text' }
  );

  assert.equal(modes.intentLabel, 'visual_request');
  assert.equal(modes.replyMode, 'flirty');
  assert.equal(modes.imageMode, 'encouraged');
});

test('buildCurrentUserMessage creates multimodal content for photo uploads', () => {
  const msg = buildCurrentUserMessage('what do you think?', {
    url: '/data/chat-uploads/test.jpg',
  });

  assert.equal(msg.role, 'user');
  assert.equal(Array.isArray(msg.content), true);
  assert.equal(msg.content[0].type, 'text');
  assert.match(msg.content[0].text, /caption or request: what do you think\?/);
  assert.deepEqual(msg.content[1], {
    type: 'image_url',
    image_url: { url: '/data/chat-uploads/test.jpg' },
  });
});

test('getImageContextText turns uploaded photos into reusable text context', () => {
  const text = getImageContextText({
    metadata: {
      image_url: '/data/chat-uploads/test.jpg',
      caption: 'tell me if this shirt works',
      vision_summary: 'a mirror selfie in a black shirt',
    },
  });

  assert.equal(
    text,
    'User sent a photo captioned "tell me if this shirt works" showing a mirror selfie in a black shirt.'
  );
});

test('extractVisionSummary trims assistant replies into short history text', () => {
  const summary = extractVisionSummary('That black shirt looks great on you. The fit is clean and it shows off your shoulders really well.');
  assert.equal(summary, 'That black shirt looks great on you.');
});

test('extractFirstJsonObject ignores trailing junk after a valid object', () => {
  const raw = '{"message":"hi","image_request":{"send":false,"setup_message":"","clothing":"","location":"","action":""},"device_intent":"neutral","audio_category":"none","phase_trigger":null} trailing noise';
  assert.equal(
    extractFirstJsonObject(raw),
    '{"message":"hi","image_request":{"send":false,"setup_message":"","clothing":"","location":"","action":""},"device_intent":"neutral","audio_category":"none","phase_trigger":null}'
  );
});

test('normalizeImageRequest supports legacy scene fallback and structured fields', () => {
  const normalized = normalizeImageRequest({
    send: true,
    setup_message: 'hold on',
    clothing: 'green thong',
    location: 'on the couch',
    scene: 'close-up from behind',
  });

  assert.equal(normalized.send, true);
  assert.equal(normalized.setup_message, 'hold on');
  assert.equal(normalized.clothing, 'green thong');
  assert.equal(normalized.location, 'on the couch');
  assert.equal(normalized.action, 'close-up from behind');
});

test('stripImageSetupFromMessage removes duplicate hold-on lines from the main reply', () => {
  const cleaned = stripImageSetupFromMessage(
    'Oh fuck daddy yes!\n\nHold on baby, thong pulled aside for you! 😘',
    'Hold on baby, thong pulled aside for you! 😘'
  );

  assert.equal(cleaned, 'Oh fuck daddy yes!');
});

test('stripImageSetupFromMessage removes generic setup-like last beats even if wording drifts', () => {
  const cleaned = stripImageSetupFromMessage(
    'Fuck yes daddy!\n\nHere baby! 😘',
    'Sending it now daddy! 😘'
  );

  assert.equal(cleaned, 'Fuck yes daddy!');
});

test('buildManualImagePrompt centers the latest assistant reply', () => {
  const prompt = buildManualImagePrompt({
    ...makeCard(),
    current_clothing: 'black lace bra and emerald thong',
  }, [
    { role: 'user', content: 'show me what you are doing' },
    { role: 'assistant', content: 'i am on all fours on the bed, grinning over my shoulder while i play with myself' },
  ]);

  assert.match(prompt, /Latest assistant reply to prioritize:/);
  assert.match(prompt, /on all fours on the bed/);
  assert.match(prompt, /which direction she is facing relative to the camera/i);
  assert.match(prompt, /Current clothing continuity:/);
  assert.match(prompt, /black lace bra and emerald thong/);
});

test('buildImagePrompt assembles the fixed section template', () => {
  const prompt = buildImagePrompt('curvy brunette with soft skin', {
    clothing: 'cozy tank top and green thong',
    location: 'sitting on the couch in the family room',
    action: 'she is on all fours on the floor with a large dildo, viewed from behind',
  });

  assert.match(prompt, /Use the woman in the image as your model/);
  assert.match(prompt, /Body: curvy brunette with soft skin/);
  assert.match(prompt, /Clothing: cozy tank top and green thong/);
  assert.match(prompt, /Location: sitting on the couch in the family room/);
  assert.match(prompt, /Action: she is on all fours on the floor/);
});

test('buildImagePrompt uses a position-aware fallback action', () => {
  const prompt = buildImagePrompt('curvy brunette with soft skin', {});
  assert.match(prompt, /Action: She is standing naturally, facing the camera, full-body photo/);
});

test('buildActionPrompt adds facing direction and framing when the action is too vague', () => {
  assert.equal(
    buildActionPrompt('She is standing with one hand on her hip', 'black lace bra and emerald thong'),
    'She is standing with one hand on her hip, facing the camera, full-body photo'
  );
});

test('buildActionPrompt prefers a rear view when the scene already implies behind framing', () => {
  assert.equal(
    buildActionPrompt('She is looking over her shoulder', 'black thong'),
    'She is looking over her shoulder, standing naturally, full-body shot from behind'
  );
});

test('buildClothingPrompt reinforces color specificity when missing', () => {
  assert.equal(
    buildClothingPrompt('lace bra and thong'),
    'lace bra and thong, with a clearly stated color for each visible clothing piece'
  );
  assert.equal(
    buildClothingPrompt('black lace bra and green thong'),
    'black lace bra and green thong'
  );
  assert.equal(
    buildClothingPrompt('topless with a green thong'),
    'topless with a green thong'
  );
  assert.equal(
    buildClothingPrompt('bra off, black thong'),
    'bra off, black thong'
  );
});

test('normalizeToyControl preserves structured action arrays', () => {
  const control = normalizeToyControl({
    enabled: true,
    actions: [
      { type: 'pulse', target: { role: 'front' }, high_level: 0.6, low_level: 0.2, cycles: 2 },
    ],
  });

  assert.equal(control.enabled, true);
  assert.equal(control.actions.length, 1);
  assert.equal(control.actions[0].type, 'pulse');
  assert.equal(control.actions[0].target.role, 'front');
  assert.equal(control.actions[0].high_level, 0.6);
});

test('summarizeDeviceState renders autonomy and connected device details', () => {
  const summary = summarizeDeviceState({
    pairing: { status: 'connected', appConnected: true, toysConnected: true },
    devices: [{ name: 'Toy A', id: 'toy-a', role: 'front', enabled: true, currentLevel: 0.22, maxLevel: 0.7 }],
    session: { autonomyEnabled: true, paused: false, globalMax: 0.8 },
  });

  assert.match(summary, /Lovense control state:/);
  assert.match(summary, /pairing status: connected/);
  assert.match(summary, /Lovense app linked: true/);
  assert.match(summary, /autonomy enabled: true/);
  assert.match(summary, /Toy A \(toy-a\) role=front/);
  assert.match(summary, /global max intensity: 0.8/);
});

test('summarizeDeviceState renders the no-toy Lovense state clearly', () => {
  const summary = summarizeDeviceState({
    pairing: { status: 'paired_no_toys', appConnected: true, toysConnected: false },
    devices: [],
    session: { autonomyEnabled: false, paused: true, globalMax: 0.55 },
  });

  assert.match(summary, /pairing status: paired_no_toys/);
  assert.match(summary, /No controllable Lovense toys connected/);
  assert.match(summary, /paused: true/);
});

test('shouldUseAutoImageFallback catches obvious visual requests that missed send=true', () => {
  assert.equal(
    shouldUseAutoImageFallback(
      'now let me see the back please',
      'Mmm yes please daddy. Turning around for you, back view of my innocent white cotton panties all damp and clinging under the sundress.',
      { send: false }
    ),
    true
  );
});

test('shouldUseAutoImageFallback stays off for non-visual casual replies', () => {
  assert.equal(
    shouldUseAutoImageFallback(
      'how was your day',
      'It was busy, but I kept thinking about you.',
      { send: false }
    ),
    false
  );
});
