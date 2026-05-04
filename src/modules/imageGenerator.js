const axios = require('axios');
const fs = require('fs');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, '../../data/images');
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

function getComfyUrl() {
  return (process.env.COMFYUI_BASE_URL || 'http://localhost:8188').replace(/\/$/, '');
}

function injectPrompts(workflow, appearancePrompt, scene) {
  const full = `${appearancePrompt}, ${scene}`.trim();
  // Deep clone
  const wf = JSON.parse(JSON.stringify(workflow));

  // Inject into all KSampler-adjacent text nodes
  // Common patterns: class_type CLIPTextEncode with title containing "positive"
  for (const [, node] of Object.entries(wf)) {
    if (node.class_type === 'CLIPTextEncode') {
      const title = (node._meta?.title || '').toLowerCase();
      if (title.includes('positive') || title.includes('prompt')) {
        node.inputs.text = full;
      }
    }
    // Support nodes that store prompt in a 'text' input directly
    if (node.class_type === 'Note' || node.class_type === 'ShowText') continue;
  }

  return wf;
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

async function generate(card, scene, sessionId) {
  const comfyUrl = getComfyUrl();

  // Load character workflow
  const workflowPath = path.join(__dirname, '../../characters', card.name.toLowerCase(), card.comfyui_workflow || 'comfyui/workflow.json');
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`No ComfyUI workflow found at ${workflowPath}`);
  }
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const injected = injectPrompts(workflow, card.appearance_prompt || '', scene);

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
  return `/data/images/${localName}`;
}

module.exports = { generate };
