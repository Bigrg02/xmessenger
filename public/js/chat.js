// ===== Chat Interface =====
const Chat = (() => {
  const messageList = document.getElementById('message-list');
  const typingIndicator = document.getElementById('typing-indicator');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('btn-send');
  const micBtn = document.getElementById('btn-mic');
  const inputArea = document.getElementById('input-area');
  const stopBtn = document.getElementById('stop-btn');
  const phaseBadge = document.getElementById('phase-badge');
  const phaseBadgeText = document.getElementById('phase-badge-text');
  const pttArea = document.getElementById('ptt-area');
  const cameraBtn = document.getElementById('btn-camera');
  const sceneBtn = document.getElementById('btn-generate-scene');
  const imageInput = document.getElementById('chat-image-input');
  const imageModal = document.getElementById('chat-image-modal');
  const imagePreview = document.getElementById('chat-image-preview');
  const imageCaption = document.getElementById('chat-image-caption');
  const imageError = document.getElementById('chat-image-error');
  const imageCancelBtn = document.getElementById('btn-chat-image-cancel');
  const imageCloseBtn = document.getElementById('btn-chat-image-close');
  const imageSendBtn = document.getElementById('btn-chat-image-send');
  const deviceSheet = document.getElementById('device-sheet');
  const deviceConnectionStatus = document.getElementById('device-connection-status');
  const deviceSetupCopy = document.getElementById('device-setup-copy');
  const deviceSetupHelp = document.getElementById('device-setup-help');
  const deviceList = document.getElementById('device-list');
  const deviceEmptyState = document.getElementById('device-empty-state');
  const deviceGlobalMax = document.getElementById('device-global-max');
  const deviceGlobalMaxValue = document.getElementById('device-global-max-value');
  const deviceCurrentAction = document.getElementById('device-current-action');
  const deviceAutonomyBtn = document.getElementById('btn-device-autonomy');
  const devicePauseBtn = document.getElementById('btn-device-pause');
  const deviceStopInlineBtn = document.getElementById('btn-device-stop-inline');
  const deviceSheetToggleBtn = document.getElementById('btn-chat-info');
  const deviceSheetCollapseBtn = document.getElementById('btn-device-sheet-collapse');
  const lovenseConnectBtn = document.getElementById('btn-lovense-connect');
  const lovenseDisconnectBtn = document.getElementById('btn-lovense-disconnect');
  const lovensePairingStatus = document.getElementById('lovense-pairing-status');
  const lovenseQrWrap = document.getElementById('lovense-qr-wrap');
  const lovenseQrImage = document.getElementById('lovense-qr-image');
  const lovenseQrCode = document.getElementById('lovense-qr-code');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxPromptPanel = document.getElementById('lightbox-prompt-panel');
  const lightboxPromptMeta = document.getElementById('lightbox-prompt-meta');
  const lightboxPromptText = document.getElementById('lightbox-prompt-text');
  const lightboxRegenerateBtn = document.getElementById('lightbox-regenerate');
  const lightboxCloseBtn = document.getElementById('lightbox-close');
  const lightboxImageWrap = document.querySelector('.lightbox-image-wrap');
  const lightboxZoomOutBtn = document.getElementById('lightbox-zoom-out');
  const lightboxZoomResetBtn = document.getElementById('lightbox-zoom-reset');
  const lightboxZoomInBtn = document.getElementById('lightbox-zoom-in');

  let lastMsgTime = 0;
  let lastMsgRole = null;
  let selectedImageFile = null;
  let selectedImagePreviewUrl = '';
  let deviceSheetOpen = false;
  let deviceState = null;
  let renderedMessageIds = new Set();
  let lovenseSocket = null;
  let lovenseSocketReady = false;
  let lovensePollTimer = null;
  let socketClientMissingNoticeShown = false;
  let manualImagePending = false;
  let messageMetadata = new Map();
  let lightboxZoom = 1;
  let lightboxDragging = false;
  let lightboxDragStartX = 0;
  let lightboxDragStartY = 0;
  let lightboxStartScrollLeft = 0;
  let lightboxStartScrollTop = 0;
  let lightboxMessageId = null;
  let regeneratingImageId = null;
  const TIME_GROUP_GAP = 60 * 1000;

  function reset() {
    messageList.innerHTML = '';
    messageList.appendChild(typingIndicator);
    lastMsgTime = 0;
    lastMsgRole = null;
    renderedMessageIds = new Set();
    messageMetadata = new Map();
    inputArea.classList.remove('device-phase');
    phaseBadge.classList.add('hidden');
    pttArea.classList.add('hidden');
    stopBtn.classList.add('hidden');
    messageInput.value = '';
    closeImageComposer();
    deviceState = null;
    closeDeviceSheet(true);
    setManualImagePending(false);
    updateSendBtn();
    renderDeviceState();
  }

  function renderMessages(messages, card) {
    messageList.innerHTML = '';
    messageList.appendChild(typingIndicator);
    lastMsgTime = 0;
    lastMsgRole = null;
    renderedMessageIds = new Set();
    messageMetadata = new Map();
    for (const msg of messages) _appendBubble(msg, card, false);
    scrollToBottom(false);
  }

  function appendMessage(msg, card) {
    if (msg?.id && renderedMessageIds.has(String(msg.id))) return;
    _appendBubble(msg, card, true);
    scrollToBottom(true);
  }

  function appendImage(data, card) {
    if (data?.messageId && renderedMessageIds.has(String(data.messageId))) return;
    setManualImagePending(false);
    const fakeMsg = {
      id: data.messageId,
      role: 'assistant',
      content: data.url,
      created_at: data.created_at || Date.now(),
      metadata: data.metadata || {},
      _isImage: true,
    };
    _appendBubble(fakeMsg, card, true);
    scrollToBottom(true);
  }

  function replaceImage(data) {
    const messageId = String(data?.messageId || '');
    if (!messageId) return;

    const row = messageList.querySelector(`.bubble-row[data-msg-id="${messageId}"]`);
    const img = row?.querySelector('.bubble-image');
    if (img && data.url) {
      img.src = data.url;
    }

    if (row?.dataset.msgId) {
      messageMetadata.set(messageId, data.metadata || {});
    }

    if (lightboxMessageId === messageId && data.url) {
      openLightbox(data.url, data.metadata || {}, messageId);
    }

    if (regeneratingImageId === messageId) {
      setRegeneratingImage(null);
    }
  }

  function _appendBubble(msg, card, animate) {
    const isOutgoing = msg.role === 'user';
    const imageUrl = msg._isImage ? msg.content : msg.metadata?.image_url;
    const isImage = msg.role === 'image' || Boolean(msg._isImage || imageUrl);
    const caption = msg.metadata?.caption || (isImage && !msg._isImage && msg.role === 'user' ? '' : '');
    const ts = msg.created_at || Date.now();

    if (msg?.id) renderedMessageIds.add(String(msg.id));
    if (msg?.id) messageMetadata.set(String(msg.id), msg.metadata || {});

    if (ts - lastMsgTime > TIME_GROUP_GAP) {
      const label = document.createElement('div');
      label.className = 'timestamp-label';
      label.textContent = App.formatFullTime(ts);
      messageList.insertBefore(label, typingIndicator);
    }

    const isConsecutive = msg.role === lastMsgRole && (ts - lastMsgTime < TIME_GROUP_GAP);
    lastMsgTime = ts;
    lastMsgRole = msg.role;

    const row = document.createElement('div');
    row.className = ['bubble-row', isOutgoing ? 'outgoing' : 'incoming', isConsecutive ? 'consecutive' : '']
      .filter(Boolean)
      .join(' ');
    row.dataset.msgId = msg.id;

    if (!isOutgoing) {
      const avatarEl = document.createElement('img');
      avatarEl.className = 'bubble-avatar';
      avatarEl.src = card ? `/characters/${App.getSlug() || card.name.toLowerCase()}/${card.avatar || 'reference.png'}` : '';
      avatarEl.alt = card?.name || '';
      row.appendChild(avatarEl);
    }

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (isImage) {
      const imageSource = imageUrl || msg.content;
      bubble.classList.add('image-bubble');
      if (caption) bubble.classList.add('has-caption');

      const img = document.createElement('img');
      img.className = 'bubble-image';
      img.src = imageSource;
      img.alt = caption || 'Sent image';
      img.addEventListener('click', () => openLightbox(imageSource, getMessageMetadata(msg.id, msg.metadata || {}), msg.id));
      bubble.appendChild(img);

      if (caption) {
        const captionEl = document.createElement('div');
        captionEl.className = 'bubble-image-caption';
        captionEl.innerHTML = escapeHtml(caption).replace(/\n/g, '<br>');
        bubble.appendChild(captionEl);
      }
    } else {
      if (!isOutgoing && card?.accent_color) {
        bubble.style.background = card.accent_color;
        bubble.style.color = getContrastColor(card.accent_color);
        bubble.style.setProperty('--bubble-in', card.accent_color);
      }
      bubble.innerHTML = escapeHtml(msg.content || '').replace(/\n/g, '<br>');
    }

    if (animate) {
      bubble.style.opacity = '0';
      bubble.style.transform = isOutgoing ? 'translateX(12px)' : 'translateX(-12px)';
      requestAnimationFrame(() => {
        bubble.style.transition = 'opacity 0.2s, transform 0.25s cubic-bezier(0.34,1.56,0.64,1)';
        bubble.style.opacity = '1';
        bubble.style.transform = 'translateX(0)';
      });
    }

    row.appendChild(bubble);
    messageList.insertBefore(row, typingIndicator);
  }

  function setTyping(visible) {
    typingIndicator.classList.toggle('hidden', !visible);
    if (visible) scrollToBottom(true);
  }

  function enterDevicePhase() {
    inputArea.classList.add('device-phase');
    phaseBadge.classList.remove('hidden');
    phaseBadgeText.textContent = '● Device Mode Active';
    pttArea.classList.remove('hidden');
    stopBtn.classList.remove('hidden');
    if (!deviceSheetOpen) openDeviceSheet();
    refreshDeviceState(App.getSession()?.id);
  }

  function openDeviceSheet() {
    deviceSheetOpen = true;
    renderDeviceSheetVisibility();
  }

  function closeDeviceSheet(force = false) {
    if (!force && !App.getSession()) return;
    deviceSheetOpen = false;
    renderDeviceSheetVisibility();
  }

  function renderDeviceSheetVisibility() {
    const shouldShow = Boolean(App.getSession()) && deviceSheetOpen;
    deviceSheet.classList.toggle('hidden', !shouldShow);
    deviceSheetToggleBtn.classList.toggle('active', shouldShow);
  }

  function showError(text) {
    setManualImagePending(false);
    if (regeneratingImageId) setRegeneratingImage(null);
    const existing = Array.from(messageList.querySelectorAll('[data-inline-error="true"]'))
      .find(node => node.textContent === text);
    if (existing) return;
    const label = document.createElement('div');
    label.style.cssText = 'text-align:center;color:#ff3b30;padding:16px;font-size:14px;';
    label.textContent = text;
    label.dataset.inlineError = 'true';
    messageList.insertBefore(label, typingIndicator);
  }

  function scrollToBottom(smooth) {
    messageList.scrollTo({ top: messageList.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
  }

  function updateSendBtn() {
    const hasText = messageInput.value.trim().length > 0;
    sendBtn.classList.toggle('hidden', !hasText);
    micBtn.classList.toggle('hidden', hasText);
  }

  function setManualImagePending(pending) {
    manualImagePending = pending;
    sceneBtn.disabled = pending || !App.getSession();
    sceneBtn.title = pending ? 'Generating scene image...' : 'Generate Scene Image';
  }

  async function sendMessage(content, isVoice = false) {
    const session = App.getSession();
    if (!session || !content.trim()) return;

    try {
      await fetch(`/api/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim(), is_voice: isVoice }),
      });
    } catch (_) {
      showError('Failed to send message');
    }
  }

  function openImageComposer(file) {
    if (!file) return;
    closeImageComposer();
    selectedImageFile = file;
    selectedImagePreviewUrl = URL.createObjectURL(file);
    imagePreview.src = selectedImagePreviewUrl;
    imageCaption.value = '';
    setImageError('');
    imageModal.classList.remove('hidden');
  }

  function closeImageComposer() {
    imageModal.classList.add('hidden');
    imageCaption.value = '';
    setImageError('');
    imageInput.value = '';
    selectedImageFile = null;
    imagePreview.removeAttribute('src');
    if (selectedImagePreviewUrl) {
      URL.revokeObjectURL(selectedImagePreviewUrl);
      selectedImagePreviewUrl = '';
    }
  }

  async function sendSelectedImage() {
    const session = App.getSession();
    if (!session || !selectedImageFile) {
      setImageError('Pick a photo first.');
      return;
    }

    const caption = imageCaption.value.trim();
    const formData = new FormData();
    formData.append('image', selectedImageFile);
    if (caption) formData.append('content', caption);

    imageSendBtn.disabled = true;
    imageSendBtn.textContent = 'Sending...';
    setImageError('');

    try {
      const res = await fetch(`/api/sessions/${session.id}/messages/photo`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send photo');
      closeImageComposer();
      if (data.message) appendMessage(data.message, App.getCard());
    } catch (err) {
      const message = err.message || 'Failed to send photo';
      setImageError(message);
      showError(message);
    } finally {
      imageSendBtn.disabled = false;
      imageSendBtn.textContent = 'Send Photo';
    }
  }

  async function requestManualSceneImage() {
    const session = App.getSession();
    if (!session || manualImagePending) return;

    setManualImagePending(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/images/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate image');
    } catch (err) {
      setManualImagePending(false);
      showError(err.message || 'Failed to generate image');
    }
  }

  function setImageError(text) {
    imageError.textContent = text;
    imageError.classList.toggle('hidden', !text);
  }

  async function postJson(url, body = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function postDevice(url, body = {}) {
    const data = await postJson(url, body);
    updateDeviceState(data);
    return data;
  }

  async function refreshDeviceState(sessionId = null) {
    try {
      if (sessionId) {
        await postDevice('/api/devices/session', { session_id: sessionId });
      }

      const res = await fetch('/api/devices/status');
      const data = await res.json();
      updateDeviceState(data);
    } catch (err) {
      console.error('[devices] Failed to refresh state:', err);
    }
  }

  function updateDeviceState(state) {
    deviceState = state;
    syncLovenseSocketFromState();
    syncLovensePolling();
    renderDeviceState();
  }

  function renderDeviceState() {
    const pairing = deviceState?.pairing || {};
    const session = deviceState?.session || {};
    const devices = deviceState?.devices || [];
    const inDevicePhase = App.getSession()?.phase === 'device';
    const stage = pairing.stage || pairing.status || 'idle';
    const connected = stage === 'toy_connected';
    const appConnected = stage === 'app_linked_no_toys' || connected;

    if (!deviceState) {
      deviceConnectionStatus.textContent = 'Checking Lovense...';
      lovensePairingStatus.textContent = 'Not linked yet';
    } else {
      deviceConnectionStatus.textContent = pairing.title || pairing.lastError || 'Not linked yet';
      lovensePairingStatus.textContent = pairing.subtitle || pairing.next_step || 'Connect Lovense to begin pairing.';
    }

    lovenseQrWrap.classList.toggle('hidden', !pairing.qr_visible || !pairing.qrCodeUrl);
    lovenseQrImage.src = pairing.qrCodeUrl || '';
    lovenseQrCode.textContent = pairing.deviceCode
      ? `Code: ${pairing.deviceCode}`
      : (pairing.qrCodeRaw ? `QR data ready` : '');

    deviceSetupCopy.textContent = inDevicePhase
      ? 'Your character can control any armed Lovense toy below. You can override everything live at any time.'
      : (pairing.next_step || 'Link Lovense here first. Once a toy appears, give it a body zone and leave it armed so the character can use it in device mode.');
    deviceSetupHelp.classList.toggle('hidden', connected || appConnected);

    deviceGlobalMax.value = session.globalMax ?? 0.85;
    deviceGlobalMaxValue.textContent = `${Math.round((session.globalMax ?? 0.85) * 100)}%`;
    deviceCurrentAction.textContent = session.currentAction
      ? `${session.currentAction.type} via ${session.currentAction.source}`
      : inDevicePhase ? 'Waiting for the next move' : 'Setup only until device mode starts';

    deviceAutonomyBtn.textContent = session.autonomyEnabled ? 'Character Control On' : 'Character Control Off';
    deviceAutonomyBtn.classList.toggle('active', Boolean(session.autonomyEnabled));
    devicePauseBtn.textContent = session.paused ? 'Resume Character' : 'Pause Character';
    devicePauseBtn.classList.toggle('active', Boolean(session.paused));
    deviceAutonomyBtn.disabled = !inDevicePhase;
    devicePauseBtn.disabled = !inDevicePhase;

    lovenseDisconnectBtn.disabled = !pairing.can_disconnect;
    if (stage === 'pairing_pending') {
      lovenseConnectBtn.textContent = 'Show QR Again';
    } else if (stage === 'app_linked_no_toys') {
      lovenseConnectBtn.textContent = 'Refresh Toys';
    } else if (stage === 'toy_connected') {
      lovenseConnectBtn.textContent = 'Refresh Toys';
    } else if (pairing.can_reconnect) {
      lovenseConnectBtn.textContent = 'Reconnect';
    } else {
      lovenseConnectBtn.textContent = 'Connect Lovense';
    }

    deviceEmptyState.classList.toggle('hidden', devices.length > 0);
    deviceEmptyState.textContent = stage === 'app_linked_no_toys'
      ? 'xMessage is linked. Turn on your toy in Lovense Remote or Connect to finish setup.'
      : 'Tap Connect Lovense, then scan the QR code from Lovense Remote or Lovense Connect.';

    deviceList.innerHTML = '';
    for (const device of devices) {
      const card = document.createElement('div');
      card.className = `device-card${device.enabled ? '' : ' disabled'}`;
      card.innerHTML = `
        <div class="device-card-top">
          <div>
            <div class="device-card-name">${escapeHtml(device.name)}</div>
            <div class="device-card-meta">Body zone: ${escapeHtml(device.role)} · Live level: ${Math.round(device.currentLevel * 100)}%</div>
            <div class="device-card-hint">${device.connected ? 'Connected in Lovense' : 'Toy is offline in Lovense'}</div>
          </div>
          <label class="device-enabled-toggle">
            <input type="checkbox" data-device-enable="${device.id}" ${device.enabled ? 'checked' : ''}>
            Armed
          </label>
        </div>
        <div class="device-card-grid">
          <div class="device-field">
            <label for="role-${device.id}">Body zone</label>
            <select id="role-${device.id}" data-device-role="${device.id}">
              ${(deviceState.availableRoles || []).map(role => `<option value="${role}" ${role === device.role ? 'selected' : ''}>${role}</option>`).join('')}
            </select>
          </div>
          <div class="device-field">
            <label for="max-${device.id}">This toy cap ${Math.round(device.maxLevel * 100)}%</label>
            <input type="range" id="max-${device.id}" min="0" max="1" step="0.01" value="${device.maxLevel}" data-device-max="${device.id}">
          </div>
        </div>
        <div class="device-field">
          <label for="level-${device.id}">Manual level</label>
          <div class="device-slider-row">
            <button type="button" data-device-step="${device.id}" data-step="-0.1">−</button>
            <input type="range" id="level-${device.id}" min="0" max="1" step="0.01" value="${device.currentLevel}" data-device-level="${device.id}">
            <button type="button" data-device-step="${device.id}" data-step="0.1">+</button>
          </div>
        </div>
        ${device.isOverridden ? '<div class="device-override-pill">Manual override active</div>' : ''}
      `;
      deviceList.appendChild(card);
    }
  }

  function disconnectLovenseSocket() {
    if (lovenseSocket) {
      try { lovenseSocket.disconnect(); } catch (_) {}
    }
    lovenseSocket = null;
    lovenseSocketReady = false;
  }

  function stopLovensePolling() {
    if (lovensePollTimer) clearInterval(lovensePollTimer);
    lovensePollTimer = null;
  }

  function syncLovensePolling() {
    const stage = deviceState?.pairing?.stage || deviceState?.pairing?.status || 'idle';
    const shouldPoll = stage === 'pairing_pending' || stage === 'app_linked_no_toys';

    if (!shouldPoll) {
      stopLovensePolling();
      return;
    }

    if (lovensePollTimer) return;
    lovensePollTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/devices/lovense/pairing/apps');
        const data = await res.json();
        updateDeviceState(data);
      } catch (_) {
        // keep polling quietly while linking or waiting for toys
      }
    }, stage === 'app_linked_no_toys' ? 3000 : 2500);
  }

  function handleLovenseSocketMessage(raw) {
    if (!raw) return {};
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (_) {
        return {};
      }
    }
    return raw;
  }

  async function reportLovenseStatus(payload) {
    try {
      const data = await postJson('/api/devices/lovense/pairing/status', payload);
      updateDeviceState(data);
    } catch (err) {
      console.error('[lovense] Failed to report status:', err);
    }
  }

  async function reportLovenseDeviceInfo(payload) {
    try {
      const data = await postJson('/api/devices/lovense/pairing/device-info', payload);
      updateDeviceState(data);
    } catch (err) {
      console.error('[lovense] Failed to report device info:', err);
    }
  }

  function bindLovenseSocket(startPayload, options = {}) {
    const { preserveUi = false } = options;
    disconnectLovenseSocket();

    if (!preserveUi && startPayload?.qrcodeUrl) {
      updateDeviceState({
        ...(deviceState || {}),
        provider: 'lovense',
        pairing: {
          ...(deviceState?.pairing || {}),
          stage: 'pairing_pending',
          status: 'pairing_pending',
          socketReady: true,
          qrCodeUrl: startPayload.qrcodeUrl,
          qrCodeRaw: startPayload.qrcode || '',
        },
      });
    }

    if (!window.io) {
      if (!socketClientMissingNoticeShown) {
        showError('Socket.IO client failed to load.');
        socketClientMissingNoticeShown = true;
      }
      return;
    }

    socketClientMissingNoticeShown = false;

    lovenseSocket = window.io(startPayload.socketIoUrl, {
      path: startPayload.socketIoPath,
      transports: ['websocket'],
    });

    lovenseSocket.on('connect', async () => {
      lovenseSocketReady = true;
      await reportLovenseStatus({ appConnected: false, online: false, error: '' });
      lovenseSocket.emit('basicapi_get_qrcode_ts', {
        ackId: `qr_${Date.now()}`,
      });
    });

    lovenseSocket.on('disconnect', async () => {
      lovenseSocketReady = false;
      lovenseSocket = null;
      // reportLovenseStatus triggers updateDeviceState → syncLovenseSocketFromState,
      // which will rebind the socket if socketIoUrl is still in state.
      await reportLovenseStatus({ appConnected: false, online: false, error: '' });
    });

    lovenseSocket.on('basicapi_get_qrcode_tc', async res => {
      const payload = handleLovenseSocketMessage(res);
      if (payload?.data) {
        const state = await postJson('/api/devices/lovense/pairing/qr', {
          qrcodeUrl: payload.data.qrcodeUrl,
          qrcode: payload.data.qrcode,
        });
        updateDeviceState(state);
      }
    });

    lovenseSocket.on('basicapi_update_app_status_tc', async res => {
      const payload = handleLovenseSocketMessage(res);
      const status = typeof payload === 'boolean'
        ? payload
        : payload?.status ?? payload?.data?.status ?? true;
      await reportLovenseStatus({ appConnected: Boolean(status), online: Boolean(status) });
    });

    lovenseSocket.on('basicapi_update_app_online_tc', async res => {
      const payload = handleLovenseSocketMessage(res);
      const online = typeof payload === 'boolean'
        ? payload
        : payload?.online ?? payload?.data?.online ?? false;
      await reportLovenseStatus({ online: Boolean(online) });
    });

    lovenseSocket.on('basicapi_update_device_info_tc', async res => {
      const payload = handleLovenseSocketMessage(res);
      await reportLovenseDeviceInfo(payload);
    });
  }

  async function startLovensePairing() {
    try {
      const stage = deviceState?.pairing?.stage || deviceState?.pairing?.status || 'idle';
      if (stage === 'app_linked_no_toys' || stage === 'toy_connected') {
        await refreshDeviceState(App.getSession()?.id);
        return;
      }

      const payload = await postJson('/api/devices/lovense/pairing/start');
      bindLovenseSocket(payload, { preserveUi: false });
    } catch (err) {
      showError(err.message);
    }
  }

  async function disconnectLovense() {
    stopLovensePolling();
    disconnectLovenseSocket();
    try {
      const data = await postJson('/api/devices/lovense/pairing/disconnect');
      updateDeviceState(data);
    } catch (err) {
      showError(err.message);
    }
  }

  async function sendLovenseCommand(command) {
    if (!lovenseSocket || !lovenseSocketReady) return;
    if (!command?.toyIds?.length) return;

    for (const toyId of command.toyIds) {
      lovenseSocket.emit('basicapi_send_toy_command_ts', {
        command: command.command || 'Function',
        action: command.action || 'Stop',
        timeSec: command.timeSec ?? 3,
        toy: toyId,
        apiVer: command.apiVer ?? 1,
      });
    }
  }

  function handleDeviceCommand(command) {
    if (command?.sessionId && command.sessionId !== App.getSession()?.id) return;
    sendLovenseCommand(command).catch?.(() => {});
  }

  function syncLovenseSocketFromState() {
    const pairing = deviceState?.pairing || {};
    const stage = pairing.stage || pairing.status || 'idle';
    const shouldBind = Boolean(pairing.socketIoUrl && pairing.socketIoPath)
      && stage !== 'idle'
      && stage !== 'expired_or_disconnected'
      && stage !== 'error';

    if (!shouldBind) return;
    if (lovenseSocket) return;

    bindLovenseSocket({
      socketIoUrl: pairing.socketIoUrl,
      socketIoPath: pairing.socketIoPath,
      qrcodeUrl: pairing.qrCodeUrl,
      qrcode: pairing.qrCodeRaw,
    }, { preserveUi: true });
  }

  function handleDeviceEvent(data) {
    if (data.intent === 'stopped') {
      navigator.vibrate?.(120);
    }
  }

  function bindDeviceSheetEvents() {
    deviceSheetToggleBtn.addEventListener('click', () => {
      if (deviceSheetOpen) {
        closeDeviceSheet();
      } else {
        openDeviceSheet();
        refreshDeviceState(App.getSession()?.id);
      }
    });

    deviceSheetCollapseBtn.addEventListener('click', () => closeDeviceSheet());

    lovenseConnectBtn.addEventListener('click', startLovensePairing);
    lovenseDisconnectBtn.addEventListener('click', disconnectLovense);

    deviceAutonomyBtn.addEventListener('click', async () => {
      if (App.getSession()?.phase !== 'device') return;
      const enabled = !(deviceState?.session?.autonomyEnabled);
      await postDevice('/api/devices/autonomy', { enabled });
    });

    devicePauseBtn.addEventListener('click', async () => {
      if (App.getSession()?.phase !== 'device') return;
      const paused = !(deviceState?.session?.paused);
      await postDevice('/api/devices/pause', { paused });
    });

    deviceStopInlineBtn.addEventListener('click', async () => {
      await postDevice('/api/devices/stop');
      navigator.vibrate?.(200);
    });

    let globalMaxTimer = null;
    deviceGlobalMax.addEventListener('input', () => {
      deviceGlobalMaxValue.textContent = `${Math.round(Number(deviceGlobalMax.value) * 100)}%`;
      clearTimeout(globalMaxTimer);
      globalMaxTimer = setTimeout(() => {
        postDevice('/api/devices/global-max', { level: Number(deviceGlobalMax.value) }).catch(err => showError(err.message));
      }, 120);
    });

    deviceList.addEventListener('change', async e => {
      const roleId = e.target.dataset.deviceRole;
      const enableId = e.target.dataset.deviceEnable;
      const maxId = e.target.dataset.deviceMax;

      try {
        if (roleId) {
          await postDevice(`/api/devices/device/${roleId}/role`, { role: e.target.value });
        } else if (enableId) {
          await postDevice(`/api/devices/device/${enableId}/enabled`, { enabled: e.target.checked });
        } else if (maxId) {
          await postDevice(`/api/devices/device/${maxId}/max`, { level: Number(e.target.value) });
        }
      } catch (err) {
        showError(err.message);
      }
    });

    let levelTimer = null;
    deviceList.addEventListener('input', e => {
      if (e.target.dataset.deviceMax) {
        const label = e.target.closest('.device-card')?.querySelector(`label[for="${e.target.id}"]`);
        if (label) label.textContent = `This toy cap ${Math.round(Number(e.target.value) * 100)}%`;
      }

      const levelId = e.target.dataset.deviceLevel;
      if (!levelId) return;

      clearTimeout(levelTimer);
      levelTimer = setTimeout(() => {
        postDevice(`/api/devices/device/${levelId}/level`, { level: Number(e.target.value) }).catch(err => showError(err.message));
      }, 90);
    });

    deviceList.addEventListener('click', async e => {
      const stepId = e.target.dataset.deviceStep;
      if (!stepId) return;

      const device = (deviceState?.devices || []).find(item => item.id === stepId);
      if (!device) return;
      const delta = Number(e.target.dataset.step || 0);
      try {
        await postDevice(`/api/devices/device/${stepId}/level`, { level: device.currentLevel + delta });
      } catch (err) {
        showError(err.message);
      }
    });
  }

  function openLightbox(src, metadata = {}, messageId = null) {
    lightboxMessageId = messageId != null ? String(messageId) : null;
    lightboxImg.src = src;
    setLightboxZoom(1);

    const promptText = String(metadata.prompt_text || '').trim();
    if (promptText) {
      const mode = metadata.image_request_mode === 'manual' ? 'Manual scene render' : 'Character-triggered render';
      const sourceBits = [];
      sourceBits.push(mode);
      if (metadata.reference_image) sourceBits.push(`Reference: ${metadata.reference_image}`);
      if (metadata.seed != null) sourceBits.push(`Seed: ${metadata.seed}`);
      if (metadata.regenerated_count) sourceBits.push(`Regenerated ${metadata.regenerated_count}x`);
      lightboxPromptMeta.textContent = sourceBits.join(' • ');
      lightboxPromptText.textContent = promptText;
      lightboxPromptPanel.classList.remove('hidden');
      lightboxRegenerateBtn.classList.remove('hidden');
      setRegeneratingImage(regeneratingImageId === lightboxMessageId ? lightboxMessageId : null);
    } else if (metadata.kind === 'user_upload') {
      const sourceBits = ['Uploaded photo debug'];
      if (metadata.original_filename) sourceBits.push(`File: ${metadata.original_filename}`);
      if (metadata.caption) sourceBits.push(`Caption: ${metadata.caption}`);
      if (metadata.vision_summary) sourceBits.push(`Summary: ${metadata.vision_summary}`);
      lightboxPromptMeta.textContent = sourceBits.join(' • ');
      lightboxPromptText.textContent = JSON.stringify({
        image_url: metadata.image_url || '',
        caption: metadata.caption || '',
        vision_summary: metadata.vision_summary || '',
        vision_response_text: metadata.vision_response_text || '',
        photo_debug: metadata.photo_debug || null,
      }, null, 2);
      lightboxPromptPanel.classList.remove('hidden');
      lightboxRegenerateBtn.classList.add('hidden');
    } else {
      lightboxPromptMeta.textContent = '';
      lightboxPromptText.textContent = '';
      lightboxPromptPanel.classList.add('hidden');
      lightboxRegenerateBtn.classList.add('hidden');
    }

    lightbox.classList.remove('hidden');
  }

  function setLightboxZoom(nextZoom) {
    lightboxZoom = Math.max(1, Math.min(4, Number(nextZoom) || 1));
    lightboxImg.style.transform = `scale(${lightboxZoom})`;
    lightboxImageWrap.classList.toggle('zoomed', lightboxZoom > 1);
    lightboxZoomResetBtn.textContent = `${Math.round(lightboxZoom * 100)}%`;
    if (lightboxZoom === 1) {
      lightboxImageWrap.scrollLeft = 0;
      lightboxImageWrap.scrollTop = 0;
    }
  }

  function closeLightbox() {
    lightbox.classList.add('hidden');
    lightboxImg.removeAttribute('src');
    lightboxMessageId = null;
    setLightboxZoom(1);
    lightboxPromptMeta.textContent = '';
    lightboxPromptText.textContent = '';
    lightboxPromptPanel.classList.add('hidden');
    lightboxRegenerateBtn.classList.add('hidden');
  }

  function getMessageMetadata(messageId, fallback = {}) {
    if (messageId == null) return fallback;
    return messageMetadata.get(String(messageId)) || fallback;
  }

  function updateMessageMetadata(messageId, metadata) {
    if (messageId == null) return;
    messageMetadata.set(String(messageId), metadata || {});
  }

  function setRegeneratingImage(messageId) {
    regeneratingImageId = messageId ? String(messageId) : null;
    const active = Boolean(regeneratingImageId && lightboxMessageId === regeneratingImageId);
    lightboxRegenerateBtn.disabled = active;
    lightboxRegenerateBtn.textContent = active ? 'Regenerating...' : 'Regenerate';
  }

  async function regenerateCurrentImage() {
    const session = App.getSession();
    if (!session || !lightboxMessageId || regeneratingImageId) return;

    setRegeneratingImage(lightboxMessageId);
    try {
      const res = await fetch(`/api/sessions/${session.id}/images/${lightboxMessageId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to regenerate image');
    } catch (err) {
      setRegeneratingImage(null);
      showError(err.message || 'Failed to regenerate image');
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getContrastColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum > 140 ? '#000000' : '#ffffff';
  }

  messageInput.addEventListener('input', updateSendBtn);
  messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const val = messageInput.value;
      if (val.trim()) {
        messageInput.value = '';
        updateSendBtn();
        sendMessage(val);
      }
    }
  });

  sendBtn.addEventListener('click', () => {
    const val = messageInput.value;
    if (val.trim()) {
      messageInput.value = '';
      updateSendBtn();
      sendMessage(val);
    }
  });

  cameraBtn.addEventListener('click', () => {
    if (!App.getSession()) return;
    imageInput.click();
  });

  sceneBtn.addEventListener('click', requestManualSceneImage);

  imageInput.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) openImageComposer(file);
  });

  imageCancelBtn.addEventListener('click', closeImageComposer);
  imageCloseBtn.addEventListener('click', closeImageComposer);
  imageSendBtn.addEventListener('click', sendSelectedImage);
  imageModal.addEventListener('click', e => {
    if (e.target === imageModal) closeImageComposer();
  });

  lightboxZoomInBtn.addEventListener('click', () => setLightboxZoom(lightboxZoom + 0.25));
  lightboxZoomOutBtn.addEventListener('click', () => setLightboxZoom(lightboxZoom - 0.25));
  lightboxZoomResetBtn.addEventListener('click', () => setLightboxZoom(1));
  lightboxRegenerateBtn.addEventListener('click', regenerateCurrentImage);
  lightboxCloseBtn.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', e => {
    if (e.target === lightbox) closeLightbox();
  });
  lightboxImg.addEventListener('click', e => {
    e.stopPropagation();
    setLightboxZoom(lightboxZoom > 1 ? 1 : 2);
  });
  lightboxImageWrap.addEventListener('wheel', e => {
    if (lightbox.classList.contains('hidden') || !e.ctrlKey) return;
    e.preventDefault();
    setLightboxZoom(lightboxZoom + (e.deltaY < 0 ? 0.2 : -0.2));
  }, { passive: false });
  lightboxImageWrap.addEventListener('mousedown', e => {
    if (lightboxZoom <= 1) return;
    lightboxDragging = true;
    lightboxDragStartX = e.clientX;
    lightboxDragStartY = e.clientY;
    lightboxStartScrollLeft = lightboxImageWrap.scrollLeft;
    lightboxStartScrollTop = lightboxImageWrap.scrollTop;
  });
  lightboxImageWrap.addEventListener('mousemove', e => {
    if (!lightboxDragging) return;
    e.preventDefault();
    lightboxImageWrap.scrollLeft = lightboxStartScrollLeft - (e.clientX - lightboxDragStartX);
    lightboxImageWrap.scrollTop = lightboxStartScrollTop - (e.clientY - lightboxDragStartY);
  });
  ['mouseup', 'mouseleave'].forEach(eventName => {
    lightboxImageWrap.addEventListener(eventName, () => {
      lightboxDragging = false;
    });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !lightbox.classList.contains('hidden')) {
      closeLightbox();
    } else if ((e.key === '+' || e.key === '=') && !lightbox.classList.contains('hidden')) {
      setLightboxZoom(lightboxZoom + 0.25);
    } else if (e.key === '-' && !lightbox.classList.contains('hidden')) {
      setLightboxZoom(lightboxZoom - 0.25);
    }
  });

  bindDeviceSheetEvents();

  return {
    reset,
    renderMessages,
    appendMessage,
    appendImage,
    setTyping,
    enterDevicePhase,
    showError,
    sendMessage,
    updateDeviceState,
    updateMessageMetadata,
    refreshDeviceState,
    handleDeviceCommand,
    handleDeviceEvent,
    replaceImage,
  };
})();
