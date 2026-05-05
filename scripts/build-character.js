#!/usr/bin/env node
// Usage: node scripts/build-character.js --name "Sara" [--images ./refs/] [--rvc ./sara.pth]

const fs = require('fs');
const path = require('path');

const args = parseArgs(process.argv.slice(2));
const name = args.name;

if (!name) {
  console.error('Usage: node scripts/build-character.js --name "CharacterName" [--images ./path] [--rvc ./model.pth]');
  process.exit(1);
}

const dirName = name.toLowerCase().replace(/\s+/g, '-');
const charsDir = path.join(__dirname, '../characters');
const charDir = path.join(charsDir, dirName);
const sharedWorkflowPath = path.join(__dirname, '../workflows/comfyui/workflow.json');

const dirs = [
  charDir,
  path.join(charDir, 'audio', 'encouragement'),
  path.join(charDir, 'audio', 'reactive'),
  path.join(charDir, 'audio', 'checking_in'),
  path.join(charDir, 'audio', 'edging'),
  path.join(charDir, 'audio', 'climax'),
  path.join(charDir, 'audio', 'aftercare'),
];

for (const dir of dirs) {
  fs.mkdirSync(dir, { recursive: true });
}

if (args.images) {
  const imgDir = path.resolve(args.images);
  if (fs.existsSync(imgDir)) {
    const imgs = fs.readdirSync(imgDir).filter(file => /\.(png|jpg|jpeg|webp)$/i.test(file));
    if (imgs.length) {
      fs.copyFileSync(path.join(imgDir, imgs[0]), path.join(charDir, 'reference.png'));
      console.log(`Copied reference image: ${imgs[0]}`);
    }
    imgs.slice(1).forEach((file, index) => {
      fs.copyFileSync(path.join(imgDir, file), path.join(charDir, `ref_${index + 2}${path.extname(file)}`));
    });
  } else {
    console.warn(`Images directory not found: ${imgDir}`);
  }
}

if (args.rvc) {
  const rvcSrc = path.resolve(args.rvc);
  if (fs.existsSync(rvcSrc)) {
    const ext = path.extname(rvcSrc);
    fs.copyFileSync(rvcSrc, path.join(charDir, `rvc_model${ext}`));
    console.log('Copied RVC model');
  } else {
    console.warn(`RVC file not found: ${rvcSrc}`);
  }
}

const card = {
  name,
  avatar: 'reference.png',
  accent_color: '#ff6b9d',
  model: 'openai/gpt-4o',
  personality: `TODO: Describe ${name}'s personality. Be specific about traits, quirks, and how she relates to the user.`,
  texting_style: 'TODO: Describe texting style. Example: "Uses short sentences, playful typos, emojis sparingly."',
  scenario: `TODO: Set the scene. Where is ${name} right now? What is her relationship with the user?`,
  first_message: `TODO: Write ${name}'s opening text. Make it feel natural, like she just started a conversation.`,
  appearance_prompt: `TODO: ComfyUI prompt describing ${name}'s appearance for image generation.`,
  reference_image: 'reference.png',
  audio_library: {
    encouragement: ['audio/encouragement/1.mp3'],
    reactive: ['audio/reactive/1.mp3'],
    checking_in: ['audio/checking_in/1.mp3'],
    edging: ['audio/edging/1.mp3'],
    climax: ['audio/climax/1.mp3'],
    aftercare: ['audio/aftercare/1.mp3'],
  },
  device_phase_style: 'Short reactive texts only, max 6 words.',
};

fs.writeFileSync(path.join(charDir, 'card.json'), JSON.stringify(card, null, 2));
console.log('Created card.json');

ensureSharedWorkflow(sharedWorkflowPath);
writeAudioReadme(path.join(charDir, 'audio/README.md'), name);

console.log(`
========================================
Character directory created: characters/${dirName}/

Checklist:
========================================

[ ] Edit card.json:
    characters/${dirName}/card.json

[ ] Add reference image:
    characters/${dirName}/reference.png

[ ] Set correct OpenRouter model in card.json

[ ] Set up the shared ComfyUI workflow:
    1. Build your workflow in ComfyUI
    2. Export as API format
    3. Replace workflows/comfyui/workflow.json

[ ] Add audio clips:
    characters/${dirName}/audio/encouragement/
    characters/${dirName}/audio/reactive/
    characters/${dirName}/audio/checking_in/
    characters/${dirName}/audio/edging/
    characters/${dirName}/audio/climax/
    characters/${dirName}/audio/aftercare/

[ ] Optional RVC model:
    characters/${dirName}/rvc_model.pth
========================================
`);

function ensureSharedWorkflow(workflowPath) {
  if (fs.existsSync(workflowPath)) return;

  fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
  const workflowTemplate = {
    _comment: 'Replace this shared workflow with your actual ComfyUI workflow exported as API JSON. xMessage injects appearance_prompt + scene into CLIPTextEncode nodes titled "positive" or "prompt".',
    '1': {
      class_type: 'CheckpointLoaderSimple',
      _meta: { title: 'Load Checkpoint' },
      inputs: { ckpt_name: 'your_model.safetensors' },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      _meta: { title: 'Positive Prompt' },
      inputs: { text: 'INJECT_PROMPT_HERE', clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      _meta: { title: 'Negative Prompt' },
      inputs: {
        text: 'blurry, ugly, deformed, watermark, text, bad anatomy',
        clip: ['1', 1],
      },
    },
  };

  fs.writeFileSync(workflowPath, JSON.stringify(workflowTemplate, null, 2));
  console.log('Created shared ComfyUI workflow template');
}

function writeAudioReadme(targetPath, characterName) {
  const audioReadme = `# Audio Clips for ${characterName}

Drop MP3/WAV/OGG files into each folder. Files are selected randomly without immediate repeats.

## Categories

### encouragement/
Warm, supportive clips for normal conversation.

### reactive/
Short reactions like "mmm", "yeah?", or breathy responses.

### checking_in/
Used after silence during device phase.

### edging/
Used when the scene ramps up.

### climax/
High-intensity clips.

### aftercare/
Soft landing clips after intensity drops.
`;

  fs.writeFileSync(targetPath, audioReadme);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    result[key] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return result;
}
