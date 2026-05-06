const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const SETTINGS_PATH = path.join(DATA_DIR, 'comfyui-settings.json');
const SHARED_WORKFLOW_PATH = path.join(__dirname, '../../workflows/comfyui/workflow.json');

const DEFAULT_SETTINGS = {
  server_url: '',
  prompt_node_ids: [],
  reference_image_node_ids: [],
  seed_node_ids: [],
  prompt_node_titles: ['Positive Prompt'],
  reference_image_node_titles: ['Reference Image'],
  last_validation: null,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function ensureWorkflowDir() {
  fs.mkdirSync(path.dirname(SHARED_WORKFLOW_PATH), { recursive: true });
}

function splitList(value) {
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

function normalizeServerUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new Error('Image server URL must be a valid http or https URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Image server URL must start with http:// or https://');
  }

  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

function normalizeValidation(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    checked_at: Number(value.checked_at || Date.now()),
    ok: value.ok !== false,
    summary: String(value.summary || '').trim(),
    checks: Array.isArray(value.checks) ? value.checks.map(check => ({
      key: String(check.key || '').trim(),
      label: String(check.label || '').trim(),
      ok: check.ok !== false,
      message: String(check.message || '').trim(),
      detail: check.detail || null,
    })) : [],
    server_url: String(value.server_url || '').trim(),
    prompt_preview: String(value.prompt_preview || '').trim(),
    selected_character_slug: String(value.selected_character_slug || '').trim(),
  };
}

function normalizeSettings(settings = {}) {
  return {
    server_url: normalizeServerUrl(settings.server_url || DEFAULT_SETTINGS.server_url || ''),
    prompt_node_ids: splitList(settings.prompt_node_ids || DEFAULT_SETTINGS.prompt_node_ids),
    reference_image_node_ids: splitList(settings.reference_image_node_ids || DEFAULT_SETTINGS.reference_image_node_ids),
    seed_node_ids: splitList(settings.seed_node_ids || DEFAULT_SETTINGS.seed_node_ids),
    prompt_node_titles: splitList(settings.prompt_node_titles || DEFAULT_SETTINGS.prompt_node_titles),
    reference_image_node_titles: splitList(settings.reference_image_node_titles || DEFAULT_SETTINGS.reference_image_node_titles),
    last_validation: normalizeValidation(settings.last_validation || DEFAULT_SETTINGS.last_validation),
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
  const current = readSettings();
  const normalized = normalizeSettings({
    ...current,
    ...settings,
    last_validation: Object.prototype.hasOwnProperty.call(settings, 'last_validation')
      ? settings.last_validation
      : current.last_validation,
  });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(normalized, null, 2));
  return normalized;
}

function updateLastValidation(validation) {
  const current = readSettings();
  return writeSettings({
    ...current,
    last_validation: normalizeValidation(validation),
  });
}

function getEffectiveServerUrl(settings = readSettings()) {
  const saved = String(settings.server_url || '').trim();
  if (saved) return saved;
  return normalizeServerUrl(process.env.COMFYUI_BASE_URL || 'http://localhost:8188');
}

function readWorkflow() {
  if (!fs.existsSync(SHARED_WORKFLOW_PATH)) return null;
  return JSON.parse(fs.readFileSync(SHARED_WORKFLOW_PATH, 'utf8'));
}

function writeWorkflowBuffer(buffer) {
  ensureWorkflowDir();
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(buffer).toString('utf8'));
  } catch (_) {
    throw new Error('Workflow upload must be valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Workflow JSON must be an object keyed by node IDs.');
  }

  fs.writeFileSync(SHARED_WORKFLOW_PATH, JSON.stringify(parsed, null, 2));
  return parsed;
}

function getNodeCapabilities(node = {}) {
  const inputs = node.inputs || {};
  return {
    prompt_eligible: node.class_type === 'CLIPTextEncode' && Object.prototype.hasOwnProperty.call(inputs, 'text'),
    reference_eligible:
      Object.prototype.hasOwnProperty.call(inputs, 'image')
      || Object.prototype.hasOwnProperty.call(inputs, 'filepath'),
    seed_eligible:
      Object.prototype.hasOwnProperty.call(inputs, 'seed')
      || Object.prototype.hasOwnProperty.call(inputs, 'noise_seed'),
  };
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
      ...getNodeCapabilities(node),
    }))
    .sort((a, b) => {
      const aTitle = a.title || a.id;
      const bTitle = b.title || b.id;
      return aTitle.localeCompare(bTitle);
    });
}

function getWorkflowStatus() {
  if (!fs.existsSync(SHARED_WORKFLOW_PATH)) {
    return {
      exists: false,
      path: SHARED_WORKFLOW_PATH,
      node_count: 0,
      titled_node_count: 0,
      updated_at: null,
      filename: path.basename(SHARED_WORKFLOW_PATH),
    };
  }

  const stat = fs.statSync(SHARED_WORKFLOW_PATH);
  const nodes = listWorkflowNodes();
  const workflow = readWorkflow() || {};

  return {
    exists: true,
    path: SHARED_WORKFLOW_PATH,
    filename: path.basename(SHARED_WORKFLOW_PATH),
    node_count: Object.keys(workflow).length,
    titled_node_count: nodes.filter(node => node.title).length,
    updated_at: stat.mtimeMs,
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  SETTINGS_PATH,
  SHARED_WORKFLOW_PATH,
  splitList,
  normalizeServerUrl,
  normalizeSettings,
  normalizeValidation,
  readSettings,
  writeSettings,
  updateLastValidation,
  getEffectiveServerUrl,
  readWorkflow,
  writeWorkflowBuffer,
  listWorkflowNodes,
  getWorkflowStatus,
};
