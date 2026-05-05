const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const SETTINGS_PATH = path.join(DATA_DIR, 'comfyui-settings.json');
const SHARED_WORKFLOW_PATH = path.join(__dirname, '../../workflows/comfyui/workflow.json');

const DEFAULT_SETTINGS = {
  prompt_node_ids: [],
  reference_image_node_ids: [],
  seed_node_ids: [],
  prompt_node_titles: ['Positive Prompt'],
  reference_image_node_titles: ['Reference Image'],
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function splitTitles(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeSettings(settings = {}) {
  return {
    prompt_node_ids: splitTitles(settings.prompt_node_ids || DEFAULT_SETTINGS.prompt_node_ids),
    reference_image_node_ids: splitTitles(settings.reference_image_node_ids || DEFAULT_SETTINGS.reference_image_node_ids),
    seed_node_ids: splitTitles(settings.seed_node_ids || DEFAULT_SETTINGS.seed_node_ids),
    prompt_node_titles: splitTitles(settings.prompt_node_titles || DEFAULT_SETTINGS.prompt_node_titles),
    reference_image_node_titles: splitTitles(settings.reference_image_node_titles || DEFAULT_SETTINGS.reference_image_node_titles),
  };
}

function readSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')));
  } catch (_) {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

function writeSettings(settings = {}) {
  ensureDataDir();
  const normalized = normalizeSettings(settings);
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(normalized, null, 2));
  return normalized;
}

function readWorkflow() {
  if (!fs.existsSync(SHARED_WORKFLOW_PATH)) return null;
  return JSON.parse(fs.readFileSync(SHARED_WORKFLOW_PATH, 'utf8'));
}

function listWorkflowNodes() {
  const workflow = readWorkflow();
  if (!workflow) return [];

  return Object.entries(workflow)
    .filter(([, node]) => node && typeof node === 'object' && node.class_type)
    .map(([id, node]) => ({
      id,
      class_type: node.class_type,
      title: String(node._meta?.title || '').trim(),
    }))
    .filter(node => node.title)
    .sort((a, b) => a.title.localeCompare(b.title));
}

module.exports = {
  DEFAULT_SETTINGS,
  SETTINGS_PATH,
  SHARED_WORKFLOW_PATH,
  splitTitles,
  normalizeSettings,
  readSettings,
  writeSettings,
  listWorkflowNodes,
};
