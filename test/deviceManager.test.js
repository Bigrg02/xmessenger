const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PAIRING_STAGES,
  buildPairingView,
  buildLogicalDeviceDescriptors,
  buildToyCommandAction,
  clampLevel,
  getToyChannels,
  normalizeRole,
  normalizeAction,
  stableDeviceKey,
} = require('../src/modules/deviceManager');

test('clampLevel constrains values into 0-1 range', () => {
  assert.equal(clampLevel(1.5), 1);
  assert.equal(clampLevel(-0.2), 0);
  assert.equal(clampLevel(0.42), 0.42);
});

test('normalizeRole accepts known roles and falls back to none', () => {
  assert.equal(normalizeRole('front'), 'front');
  assert.equal(normalizeRole('plug'), 'plug');
  assert.equal(normalizeRole('mystery-zone'), 'none');
});

test('stableDeviceKey produces reconnect-friendly device ids', () => {
  assert.equal(stableDeviceKey('Lovense Edge 2'), 'lovense-edge-2');
  assert.equal(stableDeviceKey('  My Device  '), 'my-device');
});

test('normalizeAction creates safe structured defaults', () => {
  const action = normalizeAction({
    type: 'pulse',
    target: { role: 'front' },
    high_level: 0.9,
    low_level: 0.15,
    interval_ms: 500,
    cycles: 4,
  });

  assert.equal(action.type, 'pulse');
  assert.equal(action.target.role, 'front');
  assert.equal(action.highLevel, 0.9);
  assert.equal(action.lowLevel, 0.15);
  assert.equal(action.intervalMs, 500);
  assert.equal(action.cycles, 4);
});

test('normalizeAction preserves alternate multi-target choreography', () => {
  const action = normalizeAction({
    type: 'alternate',
    targets: [{ role: 'front' }, { role: 'back' }],
    high_level: 0.7,
    low_level: 0.2,
    interval_ms: 900,
    cycles: 3,
  });

  assert.equal(action.type, 'alternate');
  assert.equal(action.targets.length, 2);
  assert.equal(action.targets[0].role, 'front');
  assert.equal(action.targets[1].role, 'back');
  assert.equal(action.highLevel, 0.7);
  assert.equal(action.lowLevel, 0.2);
});

test('buildPairingView keeps the QR visible while the app is linked but no toy is online', () => {
  const pairing = buildPairingView({
    pairingStage: PAIRING_STAGES.APP_LINKED_NO_TOYS,
    appConnected: true,
    toysConnected: false,
  });

  assert.equal(pairing.stage, 'app_linked_no_toys');
  assert.equal(pairing.qr_visible, true);
  assert.match(pairing.next_step, /Turn on your toy/i);
  assert.equal(pairing.can_reconnect, true);
});

test('buildPairingView hides the QR once a toy is connected', () => {
  const pairing = buildPairingView({
    pairingStage: PAIRING_STAGES.TOY_CONNECTED,
    appConnected: true,
    toysConnected: true,
  });

  assert.equal(pairing.stage, 'toy_connected');
  assert.equal(pairing.qr_visible, false);
  assert.match(pairing.next_step, /Choose a body zone and arm it/i);
  assert.equal(pairing.can_disconnect, true);
});

test('buildPairingView exposes reconnect guidance for expired sessions', () => {
  const pairing = buildPairingView({
    pairingStage: PAIRING_STAGES.EXPIRED_OR_DISCONNECTED,
    appConnected: false,
    toysConnected: false,
  });

  assert.equal(pairing.stage, 'expired_or_disconnected');
  assert.equal(pairing.can_reconnect, true);
  assert.equal(pairing.qr_visible, false);
});

test('getToyChannels matches multi-zone toys even when the type has a suffix', () => {
  const channels = getToyChannels({ toyType: 'edge2' });

  assert.equal(channels.length, 2);
  assert.equal(channels[0].action, 'Vibrate1');
  assert.equal(channels[1].action, 'Vibrate2');
});

test('buildLogicalDeviceDescriptors splits Edge 2 into two vibration zones', () => {
  const descriptors = buildLogicalDeviceDescriptors({
    id: 'edge-toy',
    name: 'Edge 2',
    toyType: 'edge',
    battery: 88,
    connected: true,
  });

  assert.equal(descriptors.length, 2);
  assert.equal(descriptors[0].id, 'edge-toy:v1');
  assert.equal(descriptors[0].name, 'Edge 2 (Internal Motor)');
  assert.equal(descriptors[0].defaultRole, 'internal');
  assert.equal(descriptors[1].id, 'edge-toy:v2');
  assert.equal(descriptors[1].name, 'Edge 2 (External Motor)');
  assert.equal(descriptors[1].defaultRole, 'external');
});

test('buildLogicalDeviceDescriptors keeps single-zone toys as one logical row', () => {
  const descriptors = buildLogicalDeviceDescriptors({
    id: 'calor-toy',
    name: 'Calor',
    toyType: 'calor',
  });

  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].id, 'calor-toy');
  assert.equal(descriptors[0].commandAction, 'Vibrate');
});

test('buildToyCommandAction emits a combined Lovense action for split motors', () => {
  const action = buildToyCommandAction([
    { commandAction: 'Vibrate1', currentLevel: 0.55, channelOrder: 1 },
    { commandAction: 'Vibrate2', currentLevel: 0.3, channelOrder: 2 },
  ]);

  assert.equal(action, 'Vibrate1:11,Vibrate2:6');
});

test('buildToyCommandAction stops when every split motor is at zero', () => {
  const action = buildToyCommandAction([
    { commandAction: 'Vibrate1', currentLevel: 0, channelOrder: 1 },
    { commandAction: 'Vibrate2', currentLevel: 0, channelOrder: 2 },
  ]);

  assert.equal(action, 'Stop');
});
