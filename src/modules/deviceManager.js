const WebSocket = require('ws');

// Buttplug v2 protocol over raw WebSocket — works with Intiface Central 2.x+
const INTENT_MAP = {
  neutral:  { edge2: 0.20, gush2: 0.15 },
  teasing:  { edge2: 0.35, gush2: 0.30 },
  building: { edge2: 0.55, gush2: 0.50 },
  intense:  { edge2: 0.80, gush2: 0.75 },
  cooling:  { edge2: 0.10, gush2: 0.10 },
};

// Identify known devices by name fragment
const DEVICE_ROLES = {
  edge2: ['edge 2', 'edge2'],
  gush2: ['gush 2', 'gush2'],
};

class DeviceManager {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.devices = new Map();   // deviceIndex -> {name, role}
    this.currentLevels = { edge2: 0, gush2: 0 };
    this.transitionTimer = null;
    this.msgId = 1;
    this.reconnectTimer = null;
  }

  nextId() {
    return this.msgId++;
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify([msg]));
    }
  }

  async connect() {
    const url = process.env.INTIFACE_WS_URL || 'ws://localhost:12345';
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        return reject(err);
      }

      const timeout = setTimeout(() => {
        reject(new Error('Intiface connection timeout'));
        try { this.ws.terminate(); } catch (_) {}
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.send({ RequestServerInfo: { Id: this.nextId(), ClientName: 'xMessage', MessageVersion: 3 } });
      });

      this.ws.on('message', (data) => {
        let msgs;
        try { msgs = JSON.parse(data); } catch (_) { return; }
        for (const msg of msgs) {
          this._handleMessage(msg, resolve);
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
        console.warn('[devices] Disconnected from Intiface');
        this._scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  _handleMessage(msg, resolveConnect) {
    if (msg.ServerInfo) {
      console.log(`[devices] Connected to Intiface: ${msg.ServerInfo.ServerName}`);
      this.connected = true;
      // Start scanning
      this.send({ StartScanning: { Id: this.nextId() } });
      if (resolveConnect) resolveConnect();
    }

    if (msg.DeviceAdded) {
      const { DeviceIndex, DeviceName } = msg.DeviceAdded;
      const lname = DeviceName.toLowerCase();
      let role = null;
      for (const [r, fragments] of Object.entries(DEVICE_ROLES)) {
        if (fragments.some(f => lname.includes(f))) { role = r; break; }
      }
      this.devices.set(DeviceIndex, { name: DeviceName, role });
      console.log(`[devices] Device added: ${DeviceName} (index ${DeviceIndex}, role: ${role || 'unknown'})`);

      // Set initial neutral level
      if (role) this._vibrateDevice(DeviceIndex, INTENT_MAP.neutral[role] || 0);
    }

    if (msg.DeviceRemoved) {
      const { DeviceIndex } = msg.DeviceRemoved;
      console.log(`[devices] Device removed: index ${DeviceIndex}`);
      this.devices.delete(DeviceIndex);
    }

    if (msg.ScanningFinished) {
      // Rescan periodically to catch hot-plugged devices
      setTimeout(() => {
        if (this.connected) this.send({ StartScanning: { Id: this.nextId() } });
      }, 10000);
    }
  }

  _vibrateDevice(index, speed) {
    // Try VibrateCmd (Buttplug v2 compat)
    this.send({
      VibrateCmd: {
        Id: this.nextId(),
        DeviceIndex: index,
        Speeds: [{ Index: 0, Speed: Math.max(0, Math.min(1, speed)) }],
      },
    });
  }

  _stopDevice(index) {
    this.send({ StopDeviceCmd: { Id: this.nextId(), DeviceIndex: index } });
  }

  setIntent(intent) {
    if (!this.connected) return;
    const targets = INTENT_MAP[intent] || INTENT_MAP.neutral;
    this._smoothTransition(targets, 3000);
  }

  _smoothTransition(targets, durationMs) {
    if (this.transitionTimer) clearInterval(this.transitionTimer);

    const steps = 30;
    const interval = durationMs / steps;
    const start = { ...this.currentLevels };
    let step = 0;

    this.transitionTimer = setInterval(() => {
      step++;
      const t = step / steps;

      for (const role of ['edge2', 'gush2']) {
        if (targets[role] === undefined) continue;
        const current = start[role] + (targets[role] - start[role]) * t;
        this.currentLevels[role] = current;

        for (const [index, dev] of this.devices.entries()) {
          if (dev.role === role) {
            this._vibrateDevice(index, current);
          }
        }
      }

      if (step >= steps) {
        clearInterval(this.transitionTimer);
        this.transitionTimer = null;
        this.currentLevels = { ...targets };
      }
    }, interval);
  }

  adjustIntensity(role, delta) {
    // Immediate relative adjustment for voice commands
    const targets = { ...this.currentLevels };
    if (role === 'both' || role === null) {
      targets.edge2 = Math.max(0, Math.min(1, targets.edge2 + delta));
      targets.gush2 = Math.max(0, Math.min(1, targets.gush2 + delta));
    } else {
      targets[role] = Math.max(0, Math.min(1, (targets[role] || 0) + delta));
    }
    this._smoothTransition(targets, 500);
  }

  stopAll() {
    if (this.transitionTimer) {
      clearInterval(this.transitionTimer);
      this.transitionTimer = null;
    }
    for (const index of this.devices.keys()) {
      this._stopDevice(index);
    }
    this.currentLevels = { edge2: 0, gush2: 0 };
    console.log('[devices] Emergency stop — all devices halted');
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (err) {
        console.warn('[devices] Reconnect failed:', err.message);
        this._scheduleReconnect();
      }
    }, 15000);
  }

  status() {
    return {
      connected: this.connected,
      devices: Array.from(this.devices.entries()).map(([i, d]) => ({
        index: i, name: d.name, role: d.role,
        level: d.role ? this.currentLevels[d.role] : null,
      })),
    };
  }
}

module.exports = new DeviceManager();
