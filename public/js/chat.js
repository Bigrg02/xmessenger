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

  let lastMsgTime = 0;
  let lastMsgRole = null;
  const TIME_GROUP_GAP = 60 * 1000; // 1 minute

  function reset() {
    messageList.innerHTML = '';
    messageList.appendChild(typingIndicator);
    lastMsgTime = 0;
    lastMsgRole = null;
    inputArea.classList.remove('device-phase');
    phaseBadge.classList.add('hidden');
    pttArea.classList.add('hidden');
    stopBtn.classList.add('hidden');
    messageInput.value = '';
    updateSendBtn();
  }

  function renderMessages(messages, card) {
    // Clear and re-render full history
    messageList.innerHTML = '';
    messageList.appendChild(typingIndicator);
    lastMsgTime = 0;
    lastMsgRole = null;

    for (const msg of messages) {
      _appendBubble(msg, card, false);
    }
    scrollToBottom(false);
  }

  function appendMessage(msg, card) {
    _appendBubble(msg, card, true);
    scrollToBottom(true);
  }

  function appendImage(data, card) {
    const fakeMsg = {
      id: data.messageId,
      role: 'assistant',
      content: data.url,
      created_at: data.created_at || Date.now(),
      _isImage: true,
    };
    _appendBubble(fakeMsg, card, true);
    scrollToBottom(true);
  }

  function _appendBubble(msg, card, animate) {
    const isOutgoing = msg.role === 'user';
    const isImage = msg.role === 'image' || msg._isImage;
    const ts = msg.created_at;

    // Timestamp divider if gap > TIME_GROUP_GAP
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
    row.className = [
      'bubble-row',
      isOutgoing ? 'outgoing' : 'incoming',
      isConsecutive ? 'consecutive' : '',
    ].filter(Boolean).join(' ');
    row.dataset.msgId = msg.id;

    // Avatar (incoming only)
    if (!isOutgoing) {
      const avatarEl = document.createElement('img');
      avatarEl.className = 'bubble-avatar';
      avatarEl.src = card ? `/characters/${card.name.toLowerCase()}/${card.avatar || 'reference.png'}` : '';
      avatarEl.alt = card?.name || '';
      row.appendChild(avatarEl);
    }

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (isImage) {
      bubble.classList.add('image-bubble');
      const img = document.createElement('img');
      img.className = 'bubble-image';
      img.src = msg.content;
      img.alt = 'Sent image';
      img.addEventListener('click', () => openLightbox(msg.content));
      bubble.appendChild(img);
    } else {
      // Apply character accent color to incoming bubbles
      if (!isOutgoing && card?.accent_color) {
        bubble.style.background = card.accent_color;
        bubble.style.color = getContrastColor(card.accent_color);
        // Also fix the tail color
        bubble.style.setProperty('--bubble-in', card.accent_color);
      }
      // Render newlines as separate text nodes with <br>
      bubble.innerHTML = escapeHtml(msg.content).replace(/\n/g, '<br>');
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
    // In device phase, use PTT as primary — keep text input available too
  }

  function showError(text) {
    const label = document.createElement('div');
    label.style.cssText = 'text-align:center;color:#ff3b30;padding:16px;font-size:14px;';
    label.textContent = text;
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

  async function sendMessage(content, isVoice = false) {
    const session = App.getSession();
    if (!session || !content.trim()) return;

    try {
      await fetch(`/api/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim(), is_voice: isVoice }),
      });
    } catch (err) {
      showError('Failed to send message');
    }
  }

  function openLightbox(src) {
    const lb = document.getElementById('lightbox');
    document.getElementById('lightbox-img').src = src;
    lb.classList.remove('hidden');
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getContrastColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum > 140 ? '#000000' : '#ffffff';
  }

  // Wire input events
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

  return {
    reset,
    renderMessages,
    appendMessage,
    appendImage,
    setTyping,
    enterDevicePhase,
    showError,
    sendMessage,
  };
})();
