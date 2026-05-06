const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const SETTINGS_PATH = path.join(DATA_DIR, 'app-settings.json');

const DEFAULTS = {
  // API credentials (override .env when set)
  openrouterApiKey: '',
  lovenseDeveloperToken: '',

  // External service URLs
  whisperApiUrl: '',
  intifaceWsUrl: '',

  // LLM parameters
  llmTemperature: 0.9,
  llmMaxTokens: 700,

  // Device intent intensity levels (0–1)
  intentLevels: {
    neutral: 0.2,
    teasing: 0.35,
    building: 0.55,
    intense: 0.8,
    cooling: 0.12,
  },

  // Behavior timeouts
  silenceTimeoutMs: 45000,
  manualOverrideDurationMs: 15000,

  // Image generation
  imageGenTimeoutMs: 180000,
  imageDefaultLocation: 'an intimate indoor setting',
};

let _cache = null;

function load() {
  if (_cache) return _cache;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      _cache = merge(DEFAULTS, raw);
    } else {
      _cache = { ...DEFAULTS, intentLevels: { ...DEFAULTS.intentLevels } };
    }
  } catch {
    _cache = { ...DEFAULTS, intentLevels: { ...DEFAULTS.intentLevels } };
  }
  return _cache;
}

function merge(defaults, overrides) {
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    if (key === 'intentLevels' && overrides.intentLevels && typeof overrides.intentLevels === 'object') {
      result.intentLevels = { ...defaults.intentLevels, ...overrides.intentLevels };
    } else if (overrides[key] !== undefined && overrides[key] !== null) {
      result[key] = overrides[key];
    }
  }
  return result;
}

function save(updates) {
  const current = load();
  if (updates.intentLevels && typeof updates.intentLevels === 'object') {
    updates = { ...updates, intentLevels: { ...current.intentLevels, ...updates.intentLevels } };
  }
  _cache = merge(current, updates);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(_cache, null, 2));
  return _cache;
}

function get(key) {
  return load()[key];
}

// Resolve API key: in-app setting takes precedence over .env
function getOpenRouterKey() {
  const s = load();
  return s.openrouterApiKey || process.env.OPENROUTER_API_KEY || '';
}

function getLovenseToken() {
  const s = load();
  return s.lovenseDeveloperToken || process.env.LOVENSE_DEVELOPER_TOKEN || '';
}

function getWhisperUrl() {
  const s = load();
  return s.whisperApiUrl || process.env.WHISPER_API_URL || '';
}

function getIntifaceUrl() {
  const s = load();
  return s.intifaceWsUrl || process.env.INTIFACE_WS_URL || '';
}

function invalidateCache() {
  _cache = null;
}

function safeView() {
  const s = load();
  return {
    ...s,
    openrouterApiKey: s.openrouterApiKey ? '••••••••' : '',
    lovenseDeveloperToken: s.lovenseDeveloperToken ? '••••••••' : '',
    openrouterKeySet: Boolean(s.openrouterApiKey || process.env.OPENROUTER_API_KEY),
    lovenseTokenSet: Boolean(s.lovenseDeveloperToken || process.env.LOVENSE_DEVELOPER_TOKEN),
    whisperUrlSet: Boolean(s.whisperApiUrl || process.env.WHISPER_API_URL),
    intifaceUrlSet: Boolean(s.intifaceWsUrl || process.env.INTIFACE_WS_URL),
  };
}

module.exports = {
  load,
  save,
  get,
  getOpenRouterKey,
  getLovenseToken,
  getWhisperUrl,
  getIntifaceUrl,
  invalidateCache,
  safeView,
  DEFAULTS,
};
