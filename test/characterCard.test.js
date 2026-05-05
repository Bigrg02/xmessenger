const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeCard, normalizeGeneratedDraft, splitList } = require('../src/modules/characterCard');

test('splitList parses comma-separated strings into trimmed arrays', () => {
  assert.deepEqual(splitList(' praise, edging , dirty talk ,, '), ['praise', 'edging', 'dirty talk']);
});

test('normalizeCard backfills new fields and normalizes list fields', () => {
  const card = normalizeCard({
    name: 'Allie',
    personality: 'playful',
    turn_ons: 'praise, teasing',
    pet_names: ['baby', 'good boy'],
  });

  assert.equal(card.name, 'Allie');
  assert.equal(card.relationship_to_user, '');
  assert.equal(card.backstory, '');
  assert.equal(card.example_dialogue, '');
  assert.deepEqual(card.turn_ons, ['praise', 'teasing']);
  assert.deepEqual(card.pet_names, ['baby', 'good boy']);
  assert.deepEqual(card.kinks, []);
  assert.deepEqual(card.limits, []);
});

test('normalizeGeneratedDraft trims text fields and normalizes generated arrays', () => {
  const draft = normalizeGeneratedDraft({
    name: '  Allie  ',
    personality: ' playful ',
    pet_names: 'baby, good boy',
    kinks: ['edging', ' dirty talk '],
  });

  assert.equal(draft.name, 'Allie');
  assert.equal(draft.personality, 'playful');
  assert.deepEqual(draft.pet_names, ['baby', 'good boy']);
  assert.deepEqual(draft.kinks, ['edging', 'dirty talk']);
  assert.deepEqual(draft.turn_ons, []);
});
