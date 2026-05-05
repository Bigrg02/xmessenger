const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const axios = require('axios');

const DATA_DIR = path.join(__dirname, '../../data');
const PREFS_PATH = path.join(DATA_DIR, 'device-preferences.json');

const AVAILABLE_ROLES = [
  'none',
  'front',
  'back',
  'external',
  'internal',
  'vibe',
  'plug',
  'stroker',
];

const PAIRING_STAGES = {
  IDLE: 'idle',
  PAIRING_PENDING: 'pairing_pending',
  APP_LINKED_NO_TOYS: 'app_linked_no_toys',
  TOY_CONNECTED: 'toy_connected',
  EXPIRED_OR_DISCONNECTED: 'expired_or_disconnected',
  ERROR: 'error',
};

const INTENT_LEVELS = {
  neutral: 0.2,
  teasing: 0.35,
  building: 0.55,
  intense: 0.8,
  cooling: 0.12,
};

const DEFAULT_STATE = () => ({
  activeSessionId: null,
  autonomyEnabled: true,
  paused: false,
  globalMax: 0.85,
  currentAction: null,
  queueLength: 0,
  lastSource: 'system',
});

const DEFAULT_TRANSPORT = () => ({
  provider: 'lovense',
  pairingStage: PAIRING_STAGES.IDLE,
  appConnected: false,
  toysConnected: false,
  socketReady: false,
  lastError: '',
  platform: process.env.LOVENSE_PLATFORM_NAME || 'xMessage',
  uid: '',
  uname: 'xMessage User',
  authToken: '',
  socketIoUrl: '',
  socketIoPath: '',
  qrCodeUrl: '',
  qrCodeRaw: '',
  connectionAppType: '',
  deviceCode: '',
  domain: '',
  httpsPort: null,
  wssPort: null,
  needsRecoveryCheck: true,
  recoveredOnce: false,
});

const LOVENSE_API_BASE = 'https://api.lovense-api.com/api/basicApi';
const LOVENSE_LAN_BASE = 'https://api.lovense-api.com/api/lan/v2';
const DEFAULT_COMMAND_DURATION_SEC = 600;
const EDGE_CHANNELS = [
  { suffix: 'v1', label: 'Internal Motor', action: 'Vibrate1', defaultRole: 'internal', order: 1 },
  { suffix: 'v2', label: 'External Motor', action: 'Vibrate2', defaultRole: 'external', order: 2 },
];

const MULTI_ZONE_TOY_MAP = {
  edge: EDGE_CHANNELS,
  edge2: EDGE_CHANNELS,
  edge3: EDGE_CHANNELS,
  gemini: [
    { suffix: 'v1', label: 'Motor 1', action: 'Vibrate1', defaultRole: 'front', order: 1 },
    { suffix: 'v2', label: 'Motor 2', action: 'Vibrate2', defaultRole: 'back', order: 2 },
  ],
};

function canonicalToyType(toyType = '') {
  return String(toyType || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadPreferences() {
  try {
    return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8'));
  } catch (_) {
    return { devices: {}, session: {}, lovense: {} };
  }
}

function clampLevel(value, min = 0, max = 1) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeRole(role) {
  const value = String(role || 'none').trim().toLowerCase();
  return AVAILABLE_ROLES.includes(value) ? value : 'none';
}

function inferRole(name = '', toyType = '') {
  const lower = `${name} ${toyType}`.toLowerCase();
  if (/\b(edge|hush|plug|prostate|back|anal)\b/.test(lower)) return 'back';
  if (/\b(gush|lush|ferri|vibe|wand|bullet|panty|clit)\b/.test(lower)) return 'front';
  if (/\b(max|stroker|sleeve|cock|shaft)\b/.test(lower)) return 'stroker';
  return 'none';
}

function getToyChannels(toy = {}) {
  const toyType = canonicalToyType(toy.toyType || toy.type || '');
  if (!toyType) return null;

  if (MULTI_ZONE_TOY_MAP[toyType]) return MULTI_ZONE_TOY_MAP[toyType];

  const prefixedKey = Object.keys(MULTI_ZONE_TOY_MAP).find(key => toyType.startsWith(key));
  return prefixedKey ? MULTI_ZONE_TOY_MAP[prefixedKey] : null;
}

function buildLogicalDeviceDescriptors(toy = {}) {
  const toyId = String(toy.id || toy.name || '').trim();
  if (!toyId) return [];

  const toyName = toy.nickname || toy.name || toyId;
  const toyType = String(toy.toyType || toy.type || '').trim();
  const channels = getToyChannels(toy);

  if (!channels?.length) {
    return [{
      id: toyId,
      toyId,
      name: toyName,
      displayName: toyName,
      channelLabel: '',
      channelOrder: 1,
      commandAction: 'Vibrate',
      toyType,
      defaultRole: inferRole(toyName, toyType),
      battery: toy.battery ?? null,
      connected: toy.connected !== false,
    }];
  }

  return channels.map(channel => ({
    id: `${toyId}:${channel.suffix}`,
    toyId,
    name: `${toyName} (${channel.label})`,
    displayName: toyName,
    channelLabel: channel.label,
    channelOrder: channel.order,
    commandAction: channel.action,
    toyType,
    defaultRole: channel.defaultRole || inferRole(toyName, toyType),
    battery: toy.battery ?? null,
    connected: toy.connected !== false,
  }));
}

function buildToyCommandAction(devices = []) {
  const activeDevices = devices.filter(Boolean);
  if (!activeDevices.length) return 'Stop';

  const sorted = activeDevices.slice().sort((a, b) => (a.channelOrder || 0) - (b.channelOrder || 0));
  const intensities = sorted.map(device => ({
    actionName: device.commandAction || 'Vibrate',
    intensity: Math.max(0, Math.min(20, Math.round(clampLevel(device.currentLevel) * 20))),
  }));

  if (intensities.every(item => item.intensity <= 0)) return 'Stop';

  return intensities
    .map(item => `${item.actionName}:${item.intensity}`)
    .join(',');
}

function normalizeTarget(target) {
  if (!target) return { scope: 'enabled' };
  if (typeof target === 'string') {
    if (target === 'all') return { scope: 'all' };
    return { role: normalizeRole(target) };
  }
  if (Array.isArray(target)) return { deviceIds: target };
  return target;
}

function normalizeAction(action = {}) {
  const type = String(action.type || action.action || 'set_level').trim().toLowerCase();
  const level = clampLevel(action.level ?? action.to_level ?? action.high_level ?? 0.5);
  const lowLevel = clampLevel(action.low_level ?? Math.max(0, level - 0.2));
  const highLevel = clampLevel(action.high_level ?? level);
  const durationMs = Math.max(0, Number(action.duration_ms ?? action.duration ?? 2000) || 0);
  const intervalMs = Math.max(100, Number(action.interval_ms ?? action.interval ?? 800) || 800);
  const cycles = Math.max(1, Number(action.cycles ?? 3) || 3);
  const target = normalizeTarget(action.target);
  const alternateTargets = Array.isArray(action.targets)
    ? action.targets.map(normalizeTarget)
    : [];

  return {
    type,
    target,
    targets: alternateTargets,
    level,
    lowLevel,
    highLevel,
    durationMs,
    intervalMs,
    cycles,
    raw: action,
  };
}

function stableDeviceKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'device';
}

function createStableUserId() {
  return `xmessage-${stableDeviceKey(os.hostname())}`;
}

function derivePairingStage(transport = {}) {
  if (transport.lastError) return PAIRING_STAGES.ERROR;
  if (transport.toysConnected) return PAIRING_STAGES.TOY_CONNECTED;
  if (transport.appConnected) return PAIRING_STAGES.APP_LINKED_NO_TOYS;
  if (transport.qrCodeUrl || transport.qrCodeRaw || transport.socketReady) return PAIRING_STAGES.PAIRING_PENDING;
  if (transport.recoveredOnce && transport.needsRecoveryCheck === false) return PAIRING_STAGES.EXPIRED_OR_DISCONNECTED;
  return PAIRING_STAGES.IDLE;
}

function buildPairingView(transport = {}) {
  const stage = transport.pairingStage || derivePairingStage(transport);

  if (stage === PAIRING_STAGES.TOY_CONNECTED) {
    return {
      stage,
      status: stage,
      qr_visible: false,
      next_step: 'Toy detected. Choose a body zone and arm it.',
      can_reconnect: false,
      can_disconnect: true,
      title: transport.connectionAppType ? `Linked through Lovense ${transport.connectionAppType}` : 'Lovense linked',
      subtitle: 'Toy detected. Choose a body zone and arm it.',
    };
  }

  if (stage === PAIRING_STAGES.APP_LINKED_NO_TOYS) {
    return {
      stage,
      status: stage,
      qr_visible: true,
      next_step: 'xMessage is linked. Turn on your toy in Lovense to finish setup.',
      can_reconnect: true,
      can_disconnect: true,
      title: 'Lovense linked',
      subtitle: 'xMessage is linked. Turn on your toy in Lovense to finish setup.',
    };
  }

  if (stage === PAIRING_STAGES.PAIRING_PENDING) {
    return {
      stage,
      status: stage,
      qr_visible: true,
      next_step: 'Scan this code in Lovense Remote or Connect.',
      can_reconnect: false,
      can_disconnect: Boolean(transport.socketReady || transport.qrCodeUrl),
      title: 'Waiting for Lovense link',
      subtitle: 'Scan this code in Lovense Remote or Connect.',
    };
  }

  if (stage === PAIRING_STAGES.ERROR) {
    return {
      stage,
      status: stage,
      qr_visible: false,
      next_step: transport.lastError || 'Reconnect Lovense to continue.',
      can_reconnect: true,
      can_disconnect: true,
      title: 'Lovense connection issue',
      subtitle: transport.lastError || 'Reconnect Lovense to continue.',
    };
  }

  if (stage === PAIRING_STAGES.EXPIRED_OR_DISCONNECTED) {
    return {
      stage,
      status: stage,
      qr_visible: false,
      next_step: 'Reconnect Lovense to restore your toy connection.',
      can_reconnect: true,
      can_disconnect: false,
      title: 'Lovense link expired',
      subtitle: 'Reconnect Lovense to restore your toy connection.',
    };
  }

  return {
    stage: PAIRING_STAGES.IDLE,
    status: PAIRING_STAGES.IDLE,
    qr_visible: false,
    next_step: 'Connect Lovense to begin pairing.',
    can_reconnect: false,
    can_disconnect: false,
    title: 'Not linked yet',
    subtitle: 'Connect Lovense to begin pairing.',
  };
}

class DeviceManager extends EventEmitter {
  constructor() {
    super();
    ensureDataDir();
    this.preferences = loadPreferences();
    this.devices = new Map();
    this.sessionState = {
      ...DEFAULT_STATE(),
      globalMax: clampLevel(this.preferences.session?.globalMax ?? 0.85),
      autonomyEnabled: this.preferences.session?.autonomyEnabled !== false,
    };
    const hadRecoverableContext = Boolean(
      this.preferences.lovense?.recoveredOnce
      || this.preferences.lovense?.socketIoUrl
      || this.preferences.lovense?.qrCodeUrl
      || this.preferences.lovense?.appConnected
      || this.preferences.lovense?.toysConnected
    );
    this.transport = {
      ...DEFAULT_TRANSPORT(),
      uid: this.preferences.lovense?.uid || createStableUserId(),
      platform: this.preferences.lovense?.platform || process.env.LOVENSE_PLATFORM_NAME || 'xMessage',
      uname: this.preferences.lovense?.uname || 'xMessage User',
      authToken: this.preferences.lovense?.authToken || '',
      socketIoUrl: this.preferences.lovense?.socketIoUrl || '',
      socketIoPath: this.preferences.lovense?.socketIoPath || '',
      qrCodeUrl: this.preferences.lovense?.qrCodeUrl || '',
      qrCodeRaw: this.preferences.lovense?.qrCodeRaw || '',
      connectionAppType: this.preferences.lovense?.connectionAppType || '',
      deviceCode: this.preferences.lovense?.deviceCode || '',
      domain: this.preferences.lovense?.domain || '',
      httpsPort: this.preferences.lovense?.httpsPort ?? null,
      wssPort: this.preferences.lovense?.wssPort ?? null,
      appConnected: Boolean(this.preferences.lovense?.appConnected),
      toysConnected: Boolean(this.preferences.lovense?.toysConnected),
      socketReady: Boolean(this.preferences.lovense?.socketReady),
      needsRecoveryCheck: hadRecoverableContext ? true : (this.preferences.lovense?.needsRecoveryCheck !== false),
      recoveredOnce: Boolean(this.preferences.lovense?.recoveredOnce),
      pairingStage: this.preferences.lovense?.pairingStage || PAIRING_STAGES.IDLE,
    };
    this.transitionTimer = null;
    this.actionTimer = null;
    this.actionQueue = [];
    this._setStage(this.transport.pairingStage || derivePairingStage(this.transport));
  }

  _persistLovenseState() {
    this.preferences.lovense = {
      uid: this.transport.uid,
      uname: this.transport.uname,
      platform: this.transport.platform,
      pairingStage: this.transport.pairingStage,
      appConnected: this.transport.appConnected,
      toysConnected: this.transport.toysConnected,
      socketReady: this.transport.socketReady,
      authToken: this.transport.authToken,
      socketIoUrl: this.transport.socketIoUrl,
      socketIoPath: this.transport.socketIoPath,
      qrCodeUrl: this.transport.qrCodeUrl,
      qrCodeRaw: this.transport.qrCodeRaw,
      connectionAppType: this.transport.connectionAppType,
      deviceCode: this.transport.deviceCode,
      domain: this.transport.domain,
      httpsPort: this.transport.httpsPort,
      wssPort: this.transport.wssPort,
      needsRecoveryCheck: this.transport.needsRecoveryCheck,
      recoveredOnce: this.transport.recoveredOnce,
    };
  }

  _savePreferences() {
    ensureDataDir();
    this._persistLovenseState();
    const payload = {
      devices: this.preferences.devices || {},
      session: {
        globalMax: this.sessionState.globalMax,
        autonomyEnabled: this.sessionState.autonomyEnabled,
      },
      lovense: this.preferences.lovense || {},
    };
    fs.writeFileSync(PREFS_PATH, JSON.stringify(payload, null, 2));
  }

  _setStage(stage) {
    this.transport.pairingStage = stage;
    if (stage === PAIRING_STAGES.TOY_CONNECTED) {
      this.transport.appConnected = true;
      this.transport.toysConnected = true;
      this.transport.lastError = '';
      this.transport.recoveredOnce = true;
      this.transport.needsRecoveryCheck = false;
    } else if (stage === PAIRING_STAGES.APP_LINKED_NO_TOYS) {
      this.transport.appConnected = true;
      this.transport.toysConnected = false;
      this.transport.lastError = '';
      this.transport.recoveredOnce = true;
      this.transport.needsRecoveryCheck = false;
    } else if (stage === PAIRING_STAGES.PAIRING_PENDING) {
      this.transport.lastError = '';
      this.transport.needsRecoveryCheck = true;
    } else if (stage === PAIRING_STAGES.ERROR) {
      this.transport.needsRecoveryCheck = true;
    } else if (stage === PAIRING_STAGES.EXPIRED_OR_DISCONNECTED) {
      this.transport.appConnected = false;
      this.transport.toysConnected = false;
      this.transport.socketReady = false;
      this.transport.recoveredOnce = true;
      this.transport.needsRecoveryCheck = false;
    } else {
      this.transport.appConnected = false;
      this.transport.toysConnected = false;
      this.transport.recoveredOnce = false;
      this.transport.needsRecoveryCheck = false;
    }
    this._savePreferences();
  }

  _applyTransportPatch(patch = {}, options = {}) {
    Object.assign(this.transport, patch);
    const stage = options.stage || derivePairingStage(this.transport);
    this._setStage(stage);
    if (options.emit !== false) this.emitState();
  }

  _emitCommand(command) {
    this.emit('command', {
      ...command,
      sessionId: this.sessionState.activeSessionId || null,
    });
  }

  async _sendLovenseCommand(command) {
    const developerToken = process.env.LOVENSE_DEVELOPER_TOKEN;
    if (!developerToken) return;

    const toyIds = Array.isArray(command.toyIds) && command.toyIds.length
      ? command.toyIds
      : [null];

    for (const toyId of toyIds) {
      const payload = {
        token: developerToken,
        uid: this.transport.uid,
        command: command.command || 'Function',
        action: command.action || 'Stop',
        timeSec: command.timeSec ?? DEFAULT_COMMAND_DURATION_SEC,
        apiVer: command.apiVer ?? 1,
      };

      if (toyId) payload.toy = toyId;

      axios.post(`${LOVENSE_API_BASE}/command`, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      }).catch(err => {
        const message = err.response?.data?.message || err.message || 'Lovense command failed';
        console.error('[devices] Lovense command failed:', message);
      });
    }
  }

  emitState() {
    this._savePreferences();
    this.emit('state', this.status());
  }

  _clearTimers() {
    if (this.transitionTimer) clearInterval(this.transitionTimer);
    if (this.actionTimer) clearTimeout(this.actionTimer);
    this.transitionTimer = null;
    this.actionTimer = null;
  }

  _getDeviceById(deviceId) {
    return this.devices.get(deviceId) || null;
  }

  _resolveDevices(target) {
    const normalized = normalizeTarget(target);
    const devices = Array.from(this.devices.values());

    if (normalized.scope === 'all') return devices;
    if (normalized.deviceIds?.length) {
      return normalized.deviceIds.map(id => this._getDeviceById(id)).filter(Boolean);
    }
    if (normalized.deviceId) {
      const device = this._getDeviceById(normalized.deviceId);
      return device ? [device] : [];
    }
    if (normalized.role) {
      if (normalized.role === 'none') return devices.filter(device => device.enabled);
      return devices.filter(device => device.role === normalized.role);
    }
    return devices.filter(device => device.enabled);
  }

  _formatLovenseAction(level) {
    const intensity = Math.max(0, Math.min(20, Math.round(clampLevel(level) * 20)));
    return intensity <= 0 ? 'Stop' : `Vibrate:${intensity}`;
  }

  _dispatchLevels(devices, source = 'system') {
    const grouped = new Map();
    for (const device of devices) {
      if (!device.connected || !device.enabled) continue;
      const list = grouped.get(device.toyId) || [];
      list.push(device);
      grouped.set(device.toyId, list);
    }

    // For multi-zone toys (e.g. Edge 2), fill in sibling channels that weren't
    // in the `devices` list so the combined action string is always complete.
    for (const [toyId, list] of grouped.entries()) {
      const listedIds = new Set(list.map(d => d.id));
      for (const d of this.devices.values()) {
        if (d.toyId === toyId && !listedIds.has(d.id) && d.connected && d.enabled) {
          list.push(d);
        }
      }
    }

    for (const [toyId, groupedDevices] of grouped.entries()) {
      const action = buildToyCommandAction(groupedDevices);
      const shouldStop = action === 'Stop';
      const command = {
        source,
        command: 'Function',
        action,
        timeSec: shouldStop ? 0 : DEFAULT_COMMAND_DURATION_SEC,
        apiVer: 1,
        toyIds: [toyId],
      };
      this._emitCommand(command);
      this._sendLovenseCommand(command);
    }
  }

  _applyLevel(device, requestedLevel, source = 'system') {
    if (!device) return false;
    if (!device.enabled && source !== 'manual') return false;
    if (source === 'character' && Date.now() < device.manualOverrideUntil) return false;

    const level = clampLevel(requestedLevel, 0, Math.min(device.maxLevel, this.sessionState.globalMax));
    device.currentLevel = level;
    return true;
  }

  _transitionDevices(devices, targetLevel, durationMs, source = 'system', onDone = null) {
    const targetDevices = devices.filter(Boolean);
    if (!targetDevices.length) {
      if (onDone) onDone();
      return;
    }

    this._clearTimers();

    if (durationMs <= 0) {
      for (const device of targetDevices) this._applyLevel(device, targetLevel, source);
      this._dispatchLevels(targetDevices, source);
      this.emitState();
      if (onDone) onDone();
      return;
    }

    const steps = Math.max(1, Math.round(durationMs / 120));
    const interval = Math.max(80, Math.round(durationMs / steps));
    const starts = new Map(targetDevices.map(device => [device.id, device.currentLevel]));
    let step = 0;

    this.transitionTimer = setInterval(() => {
      if (this.sessionState.paused) {
        this._clearTimers();
        this.emitState();
        return;
      }

      step += 1;
      const progress = Math.min(1, step / steps);
      for (const device of targetDevices) {
        const start = starts.get(device.id) ?? 0;
        const level = start + (targetLevel - start) * progress;
        this._applyLevel(device, level, source);
      }
      this._dispatchLevels(targetDevices, source);
      this.emitState();

      if (progress >= 1) {
        clearInterval(this.transitionTimer);
        this.transitionTimer = null;
        if (onDone) onDone();
      }
    }, interval);
  }

  _updateCurrentAction(action, source) {
    this.sessionState.currentAction = action
      ? {
          type: action.type,
          source,
          target: action.target,
          level: action.level,
          cycles: action.cycles,
          durationMs: action.durationMs,
          startedAt: Date.now(),
        }
      : null;
    this.sessionState.queueLength = this.actionQueue.length;
    this.sessionState.lastSource = source;
    this.emitState();
  }

  _runNextAction(source = 'character') {
    if (this.sessionState.paused || !this.actionQueue.length) {
      this._updateCurrentAction(null, source);
      return;
    }

    const action = this.actionQueue.shift();
    this._updateCurrentAction(action, source);
    this._executeAction(action, source);
  }

  _completeAction(source) {
    this._clearTimers();
    this._runNextAction(source);
  }

  _executePulse(action, source) {
    const devices = this._resolveDevices(action.target);
    if (!devices.length) {
      this._completeAction(source);
      return;
    }

    this._clearTimers();
    let tick = 0;
    const totalTicks = Math.max(1, action.cycles * 2);
    const applyTick = level => {
      for (const device of devices) this._applyLevel(device, level, source);
      this._dispatchLevels(devices, source);
      this.emitState();
    };

    applyTick(action.lowLevel);
    this.transitionTimer = setInterval(() => {
      if (this.sessionState.paused) {
        this._clearTimers();
        this.emitState();
        return;
      }

      tick += 1;
      applyTick(tick % 2 === 1 ? action.highLevel : action.lowLevel);

      if (tick >= totalTicks) {
        clearInterval(this.transitionTimer);
        this.transitionTimer = null;
        this._completeAction(source);
      }
    }, action.intervalMs);
  }

  _executeAlternate(action, source) {
    const targets = action.targets.length ? action.targets : [action.target];
    const groups = targets.map(target => this._resolveDevices(target)).filter(group => group.length);
    if (groups.length < 2) {
      this._executePulse(action, source);
      return;
    }

    this._clearTimers();
    let step = 0;
    const totalSteps = Math.max(2, action.cycles * groups.length);
    const allDevices = Array.from(this.devices.values());
    const groupedIds = new Set(groups.flat().map(device => device.id));

    const applyGroup = activeIndex => {
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        const level = groupIndex === activeIndex ? action.highLevel : action.lowLevel;
        for (const device of groups[groupIndex]) this._applyLevel(device, level, source);
        this._dispatchLevels(groups[groupIndex], source);
      }
      for (const device of allDevices) {
        if (!groupedIds.has(device.id)) this._applyLevel(device, action.lowLevel, source);
      }
      this.emitState();
    };

    applyGroup(0);
    this.transitionTimer = setInterval(() => {
      if (this.sessionState.paused) {
        this._clearTimers();
        this.emitState();
        return;
      }
      step += 1;
      applyGroup(step % groups.length);
      if (step >= totalSteps) {
        clearInterval(this.transitionTimer);
        this.transitionTimer = null;
        this._completeAction(source);
      }
    }, action.intervalMs);
  }

  _executeAction(action, source = 'character') {
    const devices = this._resolveDevices(action.target);

    switch (action.type) {
      case 'stop':
        this.stopAll(source, { emit: true });
        break;
      case 'set_level':
      case 'ramp':
        this._transitionDevices(devices, action.level, action.durationMs, source, () => this._completeAction(source));
        break;
      case 'hold':
        this._transitionDevices(devices, action.level, 350, source, () => {
          this.actionTimer = setTimeout(() => this._completeAction(source), action.durationMs || 1200);
        });
        break;
      case 'cooldown':
        this._transitionDevices(devices, action.lowLevel, action.durationMs || 2500, source, () => this._completeAction(source));
        break;
      case 'focus': {
        const focused = devices;
        const others = Array.from(this.devices.values()).filter(device => !focused.some(match => match.id === device.id));
        for (const device of others) this._applyLevel(device, action.lowLevel, source);
        this._dispatchLevels(others, source);
        this.emitState();
        this._transitionDevices(focused, action.level, action.durationMs || 1200, source, () => this._completeAction(source));
        break;
      }
      case 'alternate':
        this._executeAlternate(action, source);
        break;
      case 'pulse':
      default:
        this._executePulse(action, source);
        break;
    }
  }

  async startPairing() {
    const developerToken = process.env.LOVENSE_DEVELOPER_TOKEN;
    if (!developerToken) {
      this._applyTransportPatch({
        lastError: 'LOVENSE_DEVELOPER_TOKEN is not configured',
      }, { stage: PAIRING_STAGES.ERROR });
      throw new Error(this.transport.lastError);
    }

    this._applyTransportPatch({
      lastError: '',
      socketReady: false,
      appConnected: false,
      toysConnected: false,
      qrCodeUrl: '',
      qrCodeRaw: '',
      authToken: '',
      socketIoUrl: '',
      socketIoPath: '',
    }, { stage: PAIRING_STAGES.PAIRING_PENDING });

    try {
      const utoken = crypto.createHash('sha256').update(`${this.transport.uid}:${this.transport.platform}`).digest('hex');

      const tokenRes = await axios.post(`${LOVENSE_API_BASE}/getToken`, {
        token: developerToken,
        uid: this.transport.uid,
        uname: this.transport.uname,
        utoken,
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      if (tokenRes.data?.code !== 0 || !tokenRes.data?.data?.authToken) {
        throw new Error(tokenRes.data?.message || 'Failed to get Lovense auth token');
      }

      const authToken = tokenRes.data.data.authToken;
      const socketRes = await axios.post(`${LOVENSE_API_BASE}/getSocketUrl`, {
        platform: this.transport.platform,
        authToken,
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      if (socketRes.data?.code !== 0 || !socketRes.data?.data?.socketIoUrl) {
        throw new Error(socketRes.data?.message || 'Failed to get Lovense socket URL');
      }

      const qrRes = await axios.post(`${LOVENSE_LAN_BASE}/qrcode`, {
        token: developerToken,
        uid: this.transport.uid,
        uname: this.transport.uname,
        utoken,
        v: 2,
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      if (qrRes.data?.code !== 0 || !qrRes.data?.data?.qrcodeUrl) {
        throw new Error(qrRes.data?.message || 'Failed to get Lovense QR code');
      }

      this._applyTransportPatch({
        authToken,
        socketIoUrl: socketRes.data.data.socketIoUrl,
        socketIoPath: socketRes.data.data.socketIoPath,
        socketReady: true,
        qrCodeUrl: qrRes.data.data.qrcodeUrl,
        qrCodeRaw: qrRes.data.data.qrcode || '',
        lastError: '',
        needsRecoveryCheck: true,
      }, { stage: PAIRING_STAGES.PAIRING_PENDING });

      return {
        provider: 'lovense',
        platform: this.transport.platform,
        uid: this.transport.uid,
        uname: this.transport.uname,
        authToken,
        socketIoUrl: this.transport.socketIoUrl,
        socketIoPath: this.transport.socketIoPath,
        qrcodeUrl: this.transport.qrCodeUrl,
        qrcode: this.transport.qrCodeRaw,
      };
    } catch (err) {
      this._applyTransportPatch({
        lastError: err.message || 'Failed to start Lovense pairing',
        socketReady: false,
      }, { stage: PAIRING_STAGES.ERROR });
      throw err;
    }
  }

  updatePairingQr(payload = {}) {
    this._applyTransportPatch({
      qrCodeUrl: payload.qrcodeUrl || this.transport.qrCodeUrl,
      qrCodeRaw: payload.qrcode || this.transport.qrCodeRaw,
      lastError: '',
      socketReady: true,
    }, { stage: this.transport.appConnected ? derivePairingStage(this.transport) : PAIRING_STAGES.PAIRING_PENDING });
    return this.status();
  }

  updateLovenseStatus(payload = {}) {
    const patch = {};

    if (typeof payload.appConnected === 'boolean') {
      patch.appConnected = payload.appConnected;
    }
    if (typeof payload.online === 'boolean') {
      patch.appConnected = payload.online;
    }
    if (payload.deviceCode) patch.deviceCode = payload.deviceCode;
    if (payload.domain) patch.domain = payload.domain;
    if (payload.httpsPort) patch.httpsPort = payload.httpsPort;
    if (payload.wssPort) patch.wssPort = payload.wssPort;
    if (payload.appType) patch.connectionAppType = payload.appType;
    if (Object.prototype.hasOwnProperty.call(payload, 'error')) {
      patch.lastError = payload.error || '';
    }

    if (patch.appConnected === false && this.transport.recoveredOnce && !this.transport.qrCodeUrl) {
      patch.socketReady = false;
    }

    this._applyTransportPatch(patch);
    return this.status();
  }

  updateLovenseDeviceInfo(payload = {}) {
    const patch = {
      lastError: '',
    };

    if (payload.appType) patch.connectionAppType = payload.appType;
    if (payload.deviceCode) patch.deviceCode = payload.deviceCode;
    if (payload.domain) patch.domain = payload.domain;
    if (payload.httpsPort) patch.httpsPort = payload.httpsPort;
    if (payload.wssPort) patch.wssPort = payload.wssPort;
    if (typeof payload.online === 'boolean') patch.appConnected = payload.online;
    if (typeof payload.appConnected === 'boolean') patch.appConnected = payload.appConnected;
    if (typeof patch.appConnected !== 'boolean') patch.appConnected = true;

    const seen = new Set();
    const toyList = Array.isArray(payload.toyList) ? payload.toyList : [];
    for (const toy of toyList) {
      const descriptors = buildLogicalDeviceDescriptors(toy);
      for (const descriptor of descriptors) {
        seen.add(descriptor.id);
        const pref = this.preferences.devices?.[descriptor.id] || {};
        const existing = this.devices.get(descriptor.id);
        const device = existing || {
          id: descriptor.id,
          toyId: descriptor.toyId,
          currentLevel: 0,
          manualOverrideUntil: 0,
        };

        device.name = descriptor.name;
        device.displayName = descriptor.displayName;
        device.channelLabel = descriptor.channelLabel;
        device.channelOrder = descriptor.channelOrder;
        device.commandAction = descriptor.commandAction;
        device.toyType = descriptor.toyType;
        device.battery = descriptor.battery;
        device.connected = descriptor.connected;
        device.enabled = pref.enabled !== false;
        device.maxLevel = clampLevel(pref.maxLevel ?? 1);
        device.role = normalizeRole(pref.role || descriptor.defaultRole);
        this.devices.set(descriptor.id, device);
      }
    }

    for (const key of Array.from(this.devices.keys())) {
      if (!seen.has(key)) this.devices.delete(key);
    }

    patch.toysConnected = Array.from(this.devices.values()).some(device => device.connected);
    this._applyTransportPatch(patch);
    return this.status();
  }

  async refreshLovenseApps() {
    try {
      const response = await axios.get(`${LOVENSE_LAN_BASE}/app`, {
        timeout: 15000,
      });
      const raw = response.data?.data;
      const apps = Array.isArray(raw) ? raw : raw ? [raw] : [];

      if (!apps.length) {
        if (this.transport.qrCodeUrl || this.transport.socketReady) {
          this._applyTransportPatch({
            appConnected: false,
            toysConnected: false,
            lastError: '',
          }, { stage: PAIRING_STAGES.PAIRING_PENDING });
        } else if (this.transport.recoveredOnce) {
          this._applyTransportPatch({
            appConnected: false,
            toysConnected: false,
            lastError: '',
          }, { stage: PAIRING_STAGES.EXPIRED_OR_DISCONNECTED });
        } else {
          this._applyTransportPatch({
            appConnected: false,
            toysConnected: false,
            lastError: '',
          }, { stage: PAIRING_STAGES.IDLE });
        }
        return this.status();
      }

      const preferred = apps.find(app => app.online || (app.toyList && app.toyList.length)) || apps[0];
      return this.updateLovenseDeviceInfo(preferred);
    } catch (err) {
      const hadRecoverableContext = Boolean(this.transport.qrCodeUrl || this.transport.recoveredOnce || this.transport.socketIoUrl);
      this._applyTransportPatch({
        lastError: hadRecoverableContext ? '' : (err.message || 'Failed to refresh Lovense app state'),
        appConnected: false,
        toysConnected: false,
      }, { stage: hadRecoverableContext ? PAIRING_STAGES.EXPIRED_OR_DISCONNECTED : PAIRING_STAGES.ERROR });
      throw err;
    }
  }

  async ensureLovenseReady() {
    if (!this.transport.needsRecoveryCheck && !this.transport.qrCodeUrl && this.transport.pairingStage !== PAIRING_STAGES.ERROR) {
      return this.status();
    }

    try {
      await this.refreshLovenseApps();
    } catch (_) {
      // status already updated
    } finally {
      this.transport.needsRecoveryCheck = false;
      this._savePreferences();
    }
    return this.status();
  }

  disconnectLovense() {
    this._clearTimers();
    this.actionQueue = [];
    this.devices.clear();
    this.transport = {
      ...DEFAULT_TRANSPORT(),
      uid: this.transport.uid,
      uname: this.transport.uname,
      platform: this.transport.platform,
      recoveredOnce: true,
      needsRecoveryCheck: false,
      pairingStage: PAIRING_STAGES.IDLE,
    };
    this.sessionState.currentAction = null;
    this.sessionState.queueLength = 0;
    this.emitState();
    return this.status();
  }

  setActiveSession(sessionId) {
    this.sessionState.activeSessionId = sessionId || null;
    this.emitState();
    return this.status();
  }

  setIntent(intent) {
    const targetLevel = INTENT_LEVELS[intent] ?? INTENT_LEVELS.neutral;
    const devices = Array.from(this.devices.values()).filter(device => device.enabled);
    this._updateCurrentAction({ type: 'set_level', target: { scope: 'enabled' }, level: targetLevel, durationMs: 1200 }, 'intent');
    this._transitionDevices(devices, targetLevel, 1200, 'intent', () => this._updateCurrentAction(null, 'intent'));
    return this.status();
  }

  setAutonomyEnabled(enabled) {
    this.sessionState.autonomyEnabled = Boolean(enabled);
    if (!this.sessionState.autonomyEnabled) this.clearActionQueue('manual');
    this._savePreferences();
    this.emitState();
    return this.status();
  }

  setPaused(paused) {
    this.sessionState.paused = Boolean(paused);
    if (this.sessionState.paused) {
      this._clearTimers();
      this.actionQueue = [];
      this.sessionState.queueLength = 0;
    }
    this.emitState();
    return this.status();
  }

  setGlobalMax(level) {
    this.sessionState.globalMax = clampLevel(level);
    this._savePreferences();
    this.emitState();
    return this.status();
  }

  setDeviceRole(deviceId, role) {
    const device = this._getDeviceById(deviceId);
    if (!device) throw new Error('Toy not found');
    device.role = normalizeRole(role);
    this.preferences.devices[device.id] = {
      ...this.preferences.devices[device.id],
      role: device.role,
      enabled: device.enabled,
      maxLevel: device.maxLevel,
    };
    this._savePreferences();
    this.emitState();
    return this.status();
  }

  setDeviceEnabled(deviceId, enabled) {
    const device = this._getDeviceById(deviceId);
    if (!device) throw new Error('Toy not found');
    device.enabled = Boolean(enabled);
    if (!device.enabled) {
      device.currentLevel = 0;
      this._dispatchLevels([device], 'manual');
    }
    this.preferences.devices[device.id] = {
      ...this.preferences.devices[device.id],
      role: device.role,
      enabled: device.enabled,
      maxLevel: device.maxLevel,
    };
    this._savePreferences();
    this.emitState();
    return this.status();
  }

  setDeviceMaxLevel(deviceId, maxLevel) {
    const device = this._getDeviceById(deviceId);
    if (!device) throw new Error('Toy not found');
    device.maxLevel = clampLevel(maxLevel);
    if (device.currentLevel > device.maxLevel) {
      device.currentLevel = device.maxLevel;
      this._dispatchLevels([device], 'manual');
    }
    this.preferences.devices[device.id] = {
      ...this.preferences.devices[device.id],
      role: device.role,
      enabled: device.enabled,
      maxLevel: device.maxLevel,
    };
    this._savePreferences();
    this.emitState();
    return this.status();
  }

  setDeviceLevel(deviceId, level, options = {}) {
    const device = this._getDeviceById(deviceId);
    if (!device) throw new Error('Toy not found');
    device.manualOverrideUntil = Date.now() + (options.overrideMs || 15000);
    this._applyLevel(device, level, options.source || 'manual');
    this._dispatchLevels([device], options.source || 'manual');
    this.emitState();
    return this.status();
  }

  adjustByRole(role, delta) {
    const normalizedRole = normalizeRole(role);
    const devices = normalizedRole === 'none'
      ? Array.from(this.devices.values()).filter(device => device.enabled)
      : Array.from(this.devices.values()).filter(device => device.role === normalizedRole);
    for (const device of devices) {
      this.setDeviceLevel(device.id, device.currentLevel + delta, { source: 'manual', overrideMs: 10000 });
    }
    return this.status();
  }

  clearActionQueue(source = 'system') {
    this.actionQueue = [];
    this._clearTimers();
    this._updateCurrentAction(null, source);
    return this.status();
  }

  applyStructuredControl(control, source = 'character') {
    if (!control) return this.status();
    if (source === 'character' && !this.sessionState.autonomyEnabled) return this.status();
    if (this.sessionState.paused) return this.status();

    const incoming = Array.isArray(control.actions)
      ? control.actions
      : control.action
        ? [control.action]
        : control.type
          ? [control]
          : [];

    const actions = incoming.map(normalizeAction).filter(Boolean);
    if (!actions.length) return this.status();

    this.actionQueue = actions;
    this.sessionState.queueLength = actions.length;
    this._runNextAction(source);
    return this.status();
  }

  applyVoiceIntent(intent) {
    if (!intent?.hasIntent) return this.status();
    this.setPaused(false);

    if (intent.urgency === 'stop') return this.stopAll('voice');
    if (intent.urgency === 'too_much') return this.setIntent('cooling');
    if (intent.urgency === 'climax') return this.setIntent('intense');
    if (intent.urgency === 'keep') return this.status();

    if (intent.intensityDelta !== null) {
      const role = intent.bodyTarget === 'both' ? 'none' : normalizeRole(intent.bodyTarget);
      return this.adjustByRole(role, intent.intensityDelta);
    }

    return this.status();
  }

  stopAll(reason = 'manual', options = {}) {
    this.actionQueue = [];
    this._clearTimers();
    const devices = Array.from(this.devices.values());
    for (const device of devices) device.currentLevel = 0;
    this._dispatchLevels(devices, reason);
    this.sessionState.currentAction = null;
    this.sessionState.queueLength = 0;
    this.sessionState.lastSource = reason;
    if (options.emit !== false) this.emitState();
    return this.status();
  }

  status() {
    const pairing = buildPairingView(this.transport);

    return {
      provider: 'lovense',
      pairing: {
        ...pairing,
        appConnected: this.transport.appConnected,
        toysConnected: this.transport.toysConnected,
        socketReady: this.transport.socketReady,
        lastError: this.transport.lastError,
        qrCodeUrl: this.transport.qrCodeUrl,
        qrCodeRaw: this.transport.qrCodeRaw,
        platform: this.transport.platform,
        appType: this.transport.connectionAppType || '',
        deviceCode: this.transport.deviceCode || '',
        socketIoUrl: this.transport.socketIoUrl || '',
        socketIoPath: this.transport.socketIoPath || '',
      },
      connected: this.transport.toysConnected,
      lastError: this.transport.lastError,
      availableRoles: AVAILABLE_ROLES,
      devices: Array.from(this.devices.values()).map(device => ({
        id: device.id,
        toyId: device.toyId,
        name: device.name,
        displayName: device.displayName || device.name,
        channelLabel: device.channelLabel || '',
        toyType: device.toyType,
        battery: device.battery,
        connected: device.connected,
        role: device.role,
        enabled: device.enabled,
        maxLevel: device.maxLevel,
        currentLevel: Number(device.currentLevel.toFixed(3)),
        isOverridden: Date.now() < device.manualOverrideUntil,
      })),
      session: {
        ...this.sessionState,
      },
    };
  }
}

const manager = new DeviceManager();

module.exports = manager;
module.exports.AVAILABLE_ROLES = AVAILABLE_ROLES;
module.exports.PAIRING_STAGES = PAIRING_STAGES;
module.exports.buildPairingView = buildPairingView;
module.exports.clampLevel = clampLevel;
module.exports.normalizeRole = normalizeRole;
module.exports.normalizeAction = normalizeAction;
module.exports.stableDeviceKey = stableDeviceKey;
module.exports.getToyChannels = getToyChannels;
module.exports.buildLogicalDeviceDescriptors = buildLogicalDeviceDescriptors;
module.exports.buildToyCommandAction = buildToyCommandAction;
