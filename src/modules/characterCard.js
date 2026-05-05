function splitList(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(Boolean);
  }

  if (typeof value !== 'string') return [];

  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

const GENERATED_TEXT_FIELDS = [
  'name',
  'personality',
  'texting_style',
  'example_dialogue',
  'backstory',
  'relationship_to_user',
  'scenario',
  'sexual_personality',
  'core_desires',
  'aftercare_style',
  'first_message',
  'appearance_prompt',
];

const GENERATED_LIST_FIELDS = [
  'pet_names',
  'turn_ons',
  'kinks',
  'limits',
];

function normalizeGeneratedDraft(draft = {}) {
  const normalized = {};

  for (const key of GENERATED_TEXT_FIELDS) {
    normalized[key] = String(draft[key] || '').trim();
  }

  for (const key of GENERATED_LIST_FIELDS) {
    normalized[key] = splitList(draft[key]);
  }

  return normalized;
}

function normalizeCard(card = {}) {
  return {
    ...card,
    name: String(card.name || '').trim(),
    avatar: card.avatar || 'reference.png',
    accent_color: card.accent_color || '#ff6b9d',
    model: card.model || 'openai/gpt-4o',
    personality: card.personality || '',
    texting_style: card.texting_style || '',
    scenario: card.scenario || '',
    first_message: card.first_message || '',
    appearance_prompt: card.appearance_prompt || '',
    device_phase_style: card.device_phase_style || 'Short reactive texts only, max 6 words.',
    backstory: card.backstory || '',
    relationship_to_user: card.relationship_to_user || '',
    core_desires: card.core_desires || '',
    sexual_personality: card.sexual_personality || '',
    aftercare_style: card.aftercare_style || '',
    example_dialogue: card.example_dialogue || '',
    pet_names: splitList(card.pet_names),
    turn_ons: splitList(card.turn_ons),
    kinks: splitList(card.kinks),
    limits: splitList(card.limits),
    audio_library: card.audio_library || {
      encouragement: [],
      reactive: [],
      checking_in: [],
      edging: [],
      climax: [],
      aftercare: [],
    },
  };
}

module.exports = {
  GENERATED_LIST_FIELDS,
  GENERATED_TEXT_FIELDS,
  normalizeGeneratedDraft,
  normalizeCard,
  splitList,
};
