const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');
const { readSettings, getEffectiveServerUrl, SHARED_WORKFLOW_PATH } = require('./comfyuiSettings');

const IMAGES_DIR = path.join(__dirname, '../../data/images');
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

function getComfyUrl() {
  return getEffectiveServerUrl(readSettings());
}

function normalizeImageScene(imageRequest = {}) {
  if (typeof imageRequest === 'string') {
    return {
      clothing: '',
      location: '',
      action: imageRequest.trim(),
    };
  }

  return {
    clothing: String(imageRequest.clothing || '').trim(),
    location: String(imageRequest.location || '').trim(),
    action: String(imageRequest.action || imageRequest.scene || '').trim(),
  };
}

function hasColorDescriptor(text = '') {
  return /\b(black|white|gray|grey|silver|gold|red|crimson|burgundy|maroon|pink|rose|blush|coral|orange|peach|yellow|mustard|green|olive|emerald|mint|teal|blue|navy|cyan|aqua|purple|violet|lavender|brown|tan|beige|cream|ivory)\b/i.test(text);
}

function hasExplicitUndressedState(text = '') {
  return /\b(topless|bottomless|nude|fully nude|completely nude|bare chest|bare breasts|bare tits|no bra|bra off|panties off|thong off|no panties|no bottoms)\b/i.test(text);
}

function normalizePeekStates(text = '') {
  let value = String(text || '').trim();
  if (!value) return value;

  value = value.replace(
    /\b(tiny\s+gray\s+running\s+shorts?|gray\s+running\s+shorts?|shorts?|skirt|dress|pants|leggings)\s+(?:that\s+)?(?:ride\s+up|riding\s+up)[^,]*\bwith\s+(?:a\s+)?([a-z0-9 -]*?(?:thong|panties|underwear))\s+visible\b/gi,
    '$1 pulled down enough to fully expose the $2'
  );
  value = value.replace(
    /\b(shorts?|skirt|dress|pants|leggings)\b([^,.]*?)\bwith\s+(?:a\s+)?([a-z0-9 -]*?(?:thong|panties|underwear))\s+visible\b/gi,
    '$1$2, pulled down enough to fully expose the $3'
  );
  value = value.replace(/\b(panties|thong|underwear|bra)\s+peeking\s+out\s+under\s+(?:the\s+)?([a-z0-9 -]+)\b/gi, '$1 hidden under the $2');
  value = value.replace(/\b(panties|thong|underwear|bra)\s+(?:showing|visible)\s+under\s+(?:the\s+)?([a-z0-9 -]+)\b/gi, '$1 hidden under the $2');
  value = value.replace(/\b(peek(?:ing)?|peeking|peeked)\b/gi, 'visible');
  value = value.replace(/\b(panties|thong|underwear)\s+(?:peeking|showing)\s+out\b/gi, '$1 fully visible');
  value = value.replace(/\bvisible\s+out\b/gi, 'visible');
  value = value.replace(/\bjust\s+(?:barely\s+)?visible\b/gi, 'fully visible');
  value = value.replace(/\bslightly\s+visible\b/gi, 'fully visible');
  value = value.replace(/\bpartially\s+visible\b/gi, 'fully visible');
  value = value.replace(/\bhalf[- ]hidden\b/gi, 'hidden');
  value = value.replace(/\bhalf[- ]shown\b/gi, 'fully visible');

  return value
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildClothingPrompt(clothingText = '') {
  const clothing = normalizePeekStates(clothingText);
  if (!clothing) {
    return 'same outfit she is currently wearing, with each visible clothing piece described by color';
  }
  if (hasExplicitUndressedState(clothing)) {
    return clothing;
  }
  if (hasColorDescriptor(clothing)) {
    return clothing;
  }
  return `${clothing}, with a clearly stated color for each visible clothing piece`;
}

function hasPoseDescriptor(text = '') {
  return /\b(standing|sitting|seated|lounging|kneeling|lying|lying back|lying down|on all fours|bent over|leaning|crouching|sprawled|straddling|perched)\b/i.test(text);
}

function hasFacingDescriptor(text = '') {
  return /\b(facing the camera|facing forward|front-facing|looking at the camera|looking into the camera|back to the camera|facing away|turned away|over her shoulder|three-quarters|profile view|side view|viewed from behind|from behind)\b/i.test(text);
}

function hasFramingDescriptor(text = '') {
  return /\b(full-body|full body|waist-up|waist up|close-up|close up|medium shot|wide shot|mirror selfie|selfie|portrait shot|shot from behind|camera angled)\b/i.test(text);
}

function hasExpressionDescriptor(text = '') {
  return /\b(smiling|playful smile|soft smile|teasing smile|inviting smile|sultry look|flushed|biting her lip|lip bite|grinning|laughing|smirking|smirk|bedroom eyes|half-lidded eyes|looking needy|looking shy|looking confident|breathless|moaning|eyes closed|wide-eyed|blushing|seductive expression)\b/i.test(text);
}

function prefersRearView(actionText = '', clothingText = '') {
  const combined = `${actionText} ${clothingText}`;
  return /\b(from behind|viewed from behind|over her shoulder|backside|ass|rear|back to the camera|turned away)\b/i.test(combined);
}

function buildActionPrompt(actionText = '', clothingText = '') {
  const base = normalizePeekStates(actionText);
  const parts = [];

  if (base) {
    parts.push(base.replace(/[. ]+$/g, ''));
  } else {
    parts.push('She is standing naturally');
  }

  if (!hasPoseDescriptor(base)) {
    if (!base) {
      parts[0] = 'She is standing naturally';
    } else {
      parts.push('standing naturally');
    }
  }

  if (!hasFacingDescriptor(base)) {
    parts.push(prefersRearView(base, clothingText) ? 'back to the camera' : 'facing the camera');
  }

  if (!hasFramingDescriptor(base)) {
    parts.push(prefersRearView(base, clothingText) ? 'full-body shot from behind' : 'full-body photo');
  }

  if (!hasExpressionDescriptor(base)) {
    parts.push(prefersRearView(base, clothingText) ? 'looking back with a playful, inviting smile' : 'with a playful, inviting smile');
  }

  return parts.join(', ');
}

function buildImagePrompt(appearancePrompt, imageRequest = {}) {
  const scene = normalizeImageScene(imageRequest);
  const body = String(appearancePrompt || '').trim() || 'same body and overall appearance as the reference woman';
  const clothing = buildClothingPrompt(scene.clothing);
  const location = scene.location || 'an intimate indoor setting';
  const action = buildActionPrompt(scene.action, scene.clothing);

  return [
    'Use the woman in the image as your model. Create a new photo based on the below description. Maintain face and hair exactly as the image.',
    '',
    `Body: ${body}`,
    '',
    `Clothing: ${clothing}`,
    '',
    `Location: ${location}`,
    '',
    `Action: ${action}`,
  ].join('\n');
}

function findCharacterDir(card, characterSlug) {
  const slug = String(characterSlug || '').trim().toLowerCase();
  if (!slug) throw new Error('Character slug is required for image generation');
  return path.join(__dirname, '../../characters', slug);
}

function selectReferenceImage(card, characterSlug) {
  const charDir = findCharacterDir(card, characterSlug);
  const fullbody = card.reference_fullbody ? path.join(charDir, card.reference_fullbody) : path.join(charDir, 'reference_full.png');
  const portrait = card.reference_portrait ? path.join(charDir, card.reference_portrait) : path.join(charDir, card.avatar || 'reference.png');

  if (fs.existsSync(fullbody)) return fullbody;
  if (fs.existsSync(portrait)) return portrait;
  throw new Error(`No reference image found for ${card.name}. Add a full-body or portrait reference image first.`);
}

async function uploadReferenceImage(comfyUrl, filePath, sessionId) {
  const form = new FormData();
  form.append('image', fs.createReadStream(filePath), `${sessionId}_${path.basename(filePath)}`);
  form.append('type', 'input');
  form.append('overwrite', 'true');

  const response = await axios.post(`${comfyUrl}/upload/image`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 30000,
  });

  return {
    name: response.data?.name || `${sessionId}_${path.basename(filePath)}`,
    subfolder: response.data?.subfolder || '',
    type: response.data?.type || 'input',
  };
}

function titleSet(titles = []) {
  return new Set(titles.map(title => String(title || '').trim().toLowerCase()).filter(Boolean));
}

function idSet(ids = []) {
  return new Set(ids.map(id => String(id || '').trim()).filter(Boolean));
}

function nodeIdMatches(configuredIds, actualId) {
  const actual = String(actualId || '').trim();
  if (!actual) return false;

  for (const configuredId of configuredIds) {
    const configured = String(configuredId || '').trim();
    if (!configured) continue;
    if (configured === actual) return true;
    if (actual.endsWith(`:${configured}`)) return true;
  }

  return false;
}

function makeSeed() {
  const raw = crypto.randomBytes(8).readBigUInt64BE(0);
  return Number(raw % BigInt(Number.MAX_SAFE_INTEGER));
}

function hasSeedInput(node = {}) {
  const inputs = node.inputs || {};
  return Object.prototype.hasOwnProperty.call(inputs, 'noise_seed')
    || Object.prototype.hasOwnProperty.call(inputs, 'seed');
}

function applySeedToNode(node, seed) {
  if (Object.prototype.hasOwnProperty.call(node.inputs || {}, 'noise_seed')) {
    node.inputs.noise_seed = seed;
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(node.inputs || {}, 'seed')) {
    node.inputs.seed = seed;
    return true;
  }
  return false;
}

function injectWorkflowBindings(workflow, promptText, referenceImage, settings) {
  // Deep clone
  const wf = JSON.parse(JSON.stringify(workflow));
  const promptIds = idSet(settings.prompt_node_ids);
  const referenceIds = idSet(settings.reference_image_node_ids);
  const seedIds = idSet(settings.seed_node_ids);
  const promptTitles = titleSet(settings.prompt_node_titles);
  const referenceTitles = titleSet(settings.reference_image_node_titles);
  let matchedPrompt = 0;
  let matchedReference = 0;
  let matchedSeed = 0;
  const seed = makeSeed();

  for (const [id, node] of Object.entries(wf)) {
    const title = String(node._meta?.title || '').trim().toLowerCase();
    const promptMatchedById = nodeIdMatches(promptIds, id);
    const promptMatchedByTitle = promptTitles.size ? promptTitles.has(title) : (title.includes('positive') || title.includes('prompt'));
    const referenceMatchedById = nodeIdMatches(referenceIds, id);
    const referenceMatchedByTitle = referenceTitles.has(title);

    if (node.class_type === 'CLIPTextEncode') {
      if (promptMatchedById || (!promptIds.size && promptMatchedByTitle)) {
        node.inputs.text = promptText;
        matchedPrompt += 1;
      }
    }

    if (referenceMatchedById || (!referenceIds.size && referenceMatchedByTitle)) {
      if (Object.prototype.hasOwnProperty.call(node.inputs || {}, 'image')) {
        node.inputs.image = referenceImage.name;
        matchedReference += 1;
      } else if (Object.prototype.hasOwnProperty.call(node.inputs || {}, 'filepath')) {
        node.inputs.filepath = referenceImage.name;
        matchedReference += 1;
      }
    }

    const seedMatchedById = nodeIdMatches(seedIds, id);
    if (seedMatchedById || (!seedIds.size && hasSeedInput(node))) {
      if (applySeedToNode(node, seed)) {
        matchedSeed += 1;
      }
    }
  }

  if (!matchedPrompt) {
    if (promptIds.size) {
      throw new Error(`No prompt nodes matched the configured node IDs: ${settings.prompt_node_ids.join(', ')}`);
    }
    throw new Error(`No prompt nodes matched the configured titles: ${settings.prompt_node_titles.join(', ')}`);
  }

  if (!matchedReference) {
    if (referenceIds.size) {
      throw new Error(`No reference image nodes matched the configured node IDs: ${settings.reference_image_node_ids.join(', ')}`);
    }
    throw new Error(`No reference image nodes matched the configured titles: ${settings.reference_image_node_titles.join(', ')}`);
  }

  if (seedIds.size && !matchedSeed) {
    throw new Error(`No seed nodes matched the configured node IDs: ${settings.seed_node_ids.join(', ')}`);
  }

  return { workflow: wf, seed };
}

async function pollHistory(comfyUrl, promptId, maxWait = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const { data } = await axios.get(`${comfyUrl}/history/${promptId}`, { timeout: 10000 });
      if (data[promptId]?.outputs) {
        return data[promptId].outputs;
      }
    } catch (_) {}
  }
  throw new Error('ComfyUI generation timed out');
}

async function downloadImage(comfyUrl, filename, subfolder, type) {
  const params = new URLSearchParams({ filename, subfolder, type });
  const res = await axios.get(`${comfyUrl}/view?${params}`, {
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  return Buffer.from(res.data);
}

async function generate(card, imageRequest, sessionId, options = {}) {
  const promptText = buildImagePrompt(card.appearance_prompt || '', imageRequest);
  const result = await submitPrompt(card, promptText, sessionId, options);

  return {
    ...result,
    promptText,
    scene: normalizeImageScene(imageRequest),
  };
}

async function generateFromPrompt(card, promptText, sessionId, options = {}) {
  const normalizedPrompt = String(promptText || '').trim();
  if (!normalizedPrompt) {
    throw new Error('No saved prompt text was found for this image.');
  }

  const result = await submitPrompt(card, normalizedPrompt, sessionId, options);
  return {
    ...result,
    promptText: normalizedPrompt,
    scene: normalizeImageScene(options.imageRequest || {}),
  };
}

async function submitPrompt(card, promptText, sessionId, options = {}) {
  const comfyUrl = getComfyUrl();
  const settings = readSettings();
  const characterSlug = String(options.characterSlug || '').trim().toLowerCase();
  const referencePath = selectReferenceImage(card, options.characterSlug);
  const uploadedReference = await uploadReferenceImage(comfyUrl, referencePath, sessionId);

  const legacyWorkflowPath = path.join(__dirname, '../../characters', characterSlug || card.name.toLowerCase(), card.comfyui_workflow || 'comfyui/workflow.json');
  const workflowPath = fs.existsSync(SHARED_WORKFLOW_PATH) ? SHARED_WORKFLOW_PATH : legacyWorkflowPath;
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`No ComfyUI workflow found. Expected shared workflow at ${SHARED_WORKFLOW_PATH}`);
  }
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const injectedResult = injectWorkflowBindings(workflow, promptText, uploadedReference, settings);
  const injected = injectedResult.workflow;

  // Submit prompt
  const { data: submitData } = await axios.post(
    `${comfyUrl}/prompt`,
    { prompt: injected },
    { timeout: 15000 }
  );
  const promptId = submitData.prompt_id;
  if (!promptId) throw new Error('ComfyUI did not return a prompt_id');

  console.log(`[images] ComfyUI prompt submitted: ${promptId}`);

  // Poll until done
  const outputs = await pollHistory(comfyUrl, promptId);

  // Find first image output
  let imageInfo = null;
  for (const nodeOutputs of Object.values(outputs)) {
    if (nodeOutputs.images?.length) {
      imageInfo = nodeOutputs.images[0];
      break;
    }
  }
  if (!imageInfo) throw new Error('No image output from ComfyUI');

  // Download and save locally
  const imgBuffer = await downloadImage(comfyUrl, imageInfo.filename, imageInfo.subfolder || '', imageInfo.type || 'output');
  const localName = `${sessionId}_${Date.now()}_${imageInfo.filename}`;
  const localPath = path.join(IMAGES_DIR, localName);
  fs.writeFileSync(localPath, imgBuffer);

  console.log(`[images] Saved: ${localName}`);
  return {
    url: `/data/images/${localName}`,
    referenceImage: uploadedReference.name,
    seed: injectedResult.seed,
  };
}

module.exports = {
  generate,
  generateFromPrompt,
  normalizeImageScene,
  buildImagePrompt,
  buildActionPrompt,
  buildClothingPrompt,
  selectReferenceImage,
  injectWorkflowBindings,
};
