const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { normalizeSettings, normalizeServerUrl, getEffectiveServerUrl } = require('../src/modules/comfyuiSettings');
const { selectReferenceImage, injectWorkflowBindings, buildImagePrompt, buildClothingPrompt, buildActionPrompt } = require('../src/modules/imageGenerator');

const charactersDir = path.join(__dirname, '../characters');

function makeCard(overrides = {}) {
  return {
    name: 'Test Character',
    avatar: 'reference.png',
    reference_portrait: 'reference.png',
    reference_fullbody: 'reference_full.png',
    ...overrides,
  };
}

test('normalizeSettings keeps image server settings and normalizes node lists', () => {
  const settings = normalizeSettings({
    server_url: 'http://192.168.1.50:8188/',
    prompt_node_ids: '12, 14',
    reference_image_node_ids: '27',
    seed_node_ids: '125, 126',
    prompt_node_titles: 'Positive Prompt, Second Prompt ',
    reference_image_node_titles: 'Reference Image, Pose Input',
  });

  assert.equal(settings.server_url, 'http://192.168.1.50:8188');
  assert.deepEqual(settings.prompt_node_ids, ['12', '14']);
  assert.deepEqual(settings.reference_image_node_ids, ['27']);
  assert.deepEqual(settings.seed_node_ids, ['125', '126']);
  assert.deepEqual(settings.prompt_node_titles, ['Positive Prompt', 'Second Prompt']);
  assert.deepEqual(settings.reference_image_node_titles, ['Reference Image', 'Pose Input']);
});

test('normalizeServerUrl rejects invalid protocols and trims trailing slash', () => {
  assert.equal(normalizeServerUrl('https://10.0.0.12:8188/'), 'https://10.0.0.12:8188');
  assert.throws(() => normalizeServerUrl('ftp://10.0.0.12:8188'), /http/);
});

test('getEffectiveServerUrl prefers saved settings over env fallback', () => {
  const originalEnv = process.env.COMFYUI_BASE_URL;
  process.env.COMFYUI_BASE_URL = 'http://127.0.0.1:8188';

  assert.equal(
    getEffectiveServerUrl({ server_url: 'http://192.168.1.88:8188' }),
    'http://192.168.1.88:8188'
  );

  assert.equal(
    getEffectiveServerUrl({ server_url: '' }),
    'http://127.0.0.1:8188'
  );

  if (typeof originalEnv === 'undefined') {
    delete process.env.COMFYUI_BASE_URL;
  } else {
    process.env.COMFYUI_BASE_URL = originalEnv;
  }
});

test('selectReferenceImage prefers full-body reference and falls back to portrait', async (t) => {
  const slug = `codex-imagegen-${Date.now()}`;
  const charDir = path.join(charactersDir, slug);
  fs.mkdirSync(charDir, { recursive: true });
  t.after(() => fs.rmSync(charDir, { recursive: true, force: true }));

  const portraitPath = path.join(charDir, 'reference.png');
  const fullPath = path.join(charDir, 'reference_full.png');
  fs.writeFileSync(portraitPath, 'portrait');
  fs.writeFileSync(fullPath, 'full');

  assert.equal(selectReferenceImage(makeCard(), slug), fullPath);

  fs.rmSync(fullPath, { force: true });
  assert.equal(selectReferenceImage(makeCard(), slug), portraitPath);
});

test('selectReferenceImage throws a clear error when no reference exists', async (t) => {
  const slug = `codex-imagegen-missing-${Date.now()}`;
  const charDir = path.join(charactersDir, slug);
  fs.mkdirSync(charDir, { recursive: true });
  t.after(() => fs.rmSync(charDir, { recursive: true, force: true }));

  assert.throws(
    () => selectReferenceImage(makeCard(), slug),
    /No reference image found/
  );
});

test('injectWorkflowBindings targets configured prompt and reference node ids', () => {
  const workflow = {
    '1': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'old prompt' },
      _meta: { title: 'Positive Prompt' },
    },
    '2': {
      class_type: 'LoadImage',
      inputs: { image: 'old.png' },
      _meta: { title: 'Reference Image' },
    },
  };

  const injected = injectWorkflowBindings(workflow, 'new prompt text', { name: 'reference_full.png' }, {
    prompt_node_ids: ['1'],
    reference_image_node_ids: ['2'],
    seed_node_ids: [],
    prompt_node_titles: [],
    reference_image_node_titles: [],
  }).workflow;

  assert.equal(injected['1'].inputs.text, 'new prompt text');
  assert.equal(injected['2'].inputs.image, 'reference_full.png');
  assert.equal(workflow['1'].inputs.text, 'old prompt');
});

test('injectWorkflowBindings accepts shorthand ids for exported workflow node ids', () => {
  const workflow = {
    '142:136': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'old prompt' },
      _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
    },
    '76': {
      class_type: 'LoadImage',
      inputs: { image: 'old.png' },
      _meta: { title: 'Load Image' },
    },
  };

  const injected = injectWorkflowBindings(workflow, 'new prompt text', { name: 'reference_full.png' }, {
    prompt_node_ids: ['136'],
    reference_image_node_ids: ['76'],
    seed_node_ids: [],
    prompt_node_titles: [],
    reference_image_node_titles: [],
  }).workflow;

  assert.equal(injected['142:136'].inputs.text, 'new prompt text');
  assert.equal(injected['76'].inputs.image, 'reference_full.png');
});

test('injectWorkflowBindings fails clearly when configured titles do not match', () => {
  const workflow = {
    '1': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'old prompt' },
      _meta: { title: 'Some Other Prompt' },
    },
    '2': {
      class_type: 'LoadImage',
      inputs: { image: 'old.png' },
      _meta: { title: 'Some Other Image' },
    },
  };

  assert.throws(
    () => injectWorkflowBindings(workflow, 'prompt', { name: 'ref.png' }, {
      prompt_node_ids: ['11'],
      reference_image_node_ids: ['12'],
      seed_node_ids: [],
      prompt_node_titles: [],
      reference_image_node_titles: [],
    }),
    /No prompt nodes matched the configured node IDs/
  );
});

test('injectWorkflowBindings randomizes configured seed nodes', () => {
  const workflow = {
    '125': {
      class_type: 'RandomNoise',
      inputs: { noise_seed: 12345 },
      _meta: { title: 'RandomNoise' },
    },
    '136': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'old prompt' },
      _meta: { title: 'Positive Prompt' },
    },
    '76': {
      class_type: 'LoadImage',
      inputs: { image: 'old.png' },
      _meta: { title: 'Load Image' },
    },
  };

  const injected = injectWorkflowBindings(workflow, 'new prompt text', { name: 'reference_full.png' }, {
    prompt_node_ids: ['136'],
    reference_image_node_ids: ['76'],
    seed_node_ids: ['125'],
    prompt_node_titles: [],
    reference_image_node_titles: [],
  });

  assert.equal(typeof injected.seed, 'number');
  assert.notEqual(injected.workflow['125'].inputs.noise_seed, 12345);
  assert.equal(injected.workflow['125'].inputs.noise_seed, injected.seed);
});

test('injectWorkflowBindings auto-randomizes common seed inputs when no seed ids are configured', () => {
  const workflow = {
    '125': {
      class_type: 'RandomNoise',
      inputs: { noise_seed: 12345 },
      _meta: { title: 'RandomNoise' },
    },
    '136': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'old prompt' },
      _meta: { title: 'Positive Prompt' },
    },
    '76': {
      class_type: 'LoadImage',
      inputs: { image: 'old.png' },
      _meta: { title: 'Load Image' },
    },
  };

  const injected = injectWorkflowBindings(workflow, 'new prompt text', { name: 'reference_full.png' }, {
    prompt_node_ids: ['136'],
    reference_image_node_ids: ['76'],
    seed_node_ids: [],
    prompt_node_titles: [],
    reference_image_node_titles: [],
  });

  assert.equal(typeof injected.seed, 'number');
  assert.equal(injected.workflow['125'].inputs.noise_seed, injected.seed);
});

test('buildImagePrompt preserves the exact assembled prompt for later regeneration', () => {
  const prompt = buildImagePrompt('athletic blonde with soft freckles', {
    clothing: 'black lace bra and emerald thong',
    location: 'lounging across the bed',
    action: 'she is lying back on the pillows, smiling up at the camera while tugging her thong aside',
  });

  assert.equal(prompt, [
    'Use the woman in the image as your model. Create a new photo based on the below description. Maintain face and hair exactly as the image.',
    '',
    'Body: athletic blonde with soft freckles',
    '',
    'Clothing: black lace bra and emerald thong',
    '',
    'Location: lounging across the bed',
    '',
    'Action: she is lying back on the pillows, smiling up at the camera while tugging her thong aside, facing the camera, full-body photo',
  ].join('\n'));
});

test('buildClothingPrompt removes peek language so underwear is either shown or hidden', () => {
  assert.equal(
    buildClothingPrompt('white cotton panties peeking out under the sundress'),
    'white cotton panties hidden under the sundress'
  );
});

test('buildActionPrompt removes partial reveal phrasing from the action', () => {
  assert.equal(
    buildActionPrompt('She is standing with her skirt lifted a little and her thong peeking out', 'black thong'),
    'She is standing with her skirt lifted a little and her thong visible, facing the camera, full-body photo, with a playful, inviting smile'
  );
});

test('buildClothingPrompt rewrites layered underwear visibility into a clean exposed state', () => {
  assert.equal(
    buildClothingPrompt('tiny gray running shorts that ride up my ass with black thong visible'),
    'tiny gray running shorts'
  );
});

test('buildActionPrompt adds an expression when the action is otherwise blank-faced', () => {
  assert.equal(
    buildActionPrompt('She is standing with one hand on her hip, facing the camera, full-body photo', 'black lace bra and emerald thong'),
    'She is standing with one hand on her hip, facing the camera, full-body photo, with a playful, inviting smile'
  );
});

test('buildActionPrompt moves garment movement out of clothing and into action', () => {
  assert.equal(
    buildActionPrompt('She is standing with one hand on her hip', 'tiny gray running shorts that ride up my ass with black thong visible'),
    'She is standing with one hand on her hip, pulled down enough to fully expose the black thong, back to the camera, full-body shot from behind, looking back with a playful, inviting smile'
  );
});
