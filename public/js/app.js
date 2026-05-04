// ===== xMessage App Controller =====
// Manages screen transitions and top-level state

const App = (() => {
  let currentSession = null;
  let currentCard = null;
  let sseSource = null;

  const screenList = document.getElementById('screen-list');
  const screenChat = document.getElementById('screen-chat');

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    const oneDay = 86400000;
    const oneWeek = 7 * oneDay;

    if (diff < oneDay && d.getDate() === now.getDate()) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    if (diff < oneWeek) {
      return d.toLocaleDateString([], { weekday: 'short' });
    }
    return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' });
  }

  function formatFullTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString([], {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  async function loadCharacterList() {
    const list = document.getElementById('character-list');
    list.innerHTML = '<div style="padding:32px;text-align:center;color:var(--label-secondary)">Loading…</div>';

    try {
      const res = await fetch('/api/characters');
      const chars = await res.json();

      if (!chars.length) {
        list.innerHTML = '<div style="padding:32px;text-align:center;color:var(--label-secondary)">No characters found.<br>Add one to /characters/</div>';
        return;
      }

      list.innerHTML = '';
      for (const c of chars) {
        const row = document.createElement('div');
        row.className = 'char-row';
        row.innerHTML = `
          <img class="char-avatar" src="${c.avatar}" alt="${c.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><circle cx=%2220%22 cy=%2220%22 r=%2220%22 fill=%22%23ddd%22/></svg>'">
          <div class="char-info">
            <div class="char-name-row">
              <span class="char-name">${c.name}</span>
              <span class="char-time">${formatTime(c.last_message_at)}</span>
            </div>
            <div class="char-preview">${c.last_message ? truncate(c.last_message, 60) : 'Tap to start a conversation'}</div>
          </div>
          <div class="char-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></div>
        `;
        row.addEventListener('click', () => openChat(c.slug, c.session_id));
        list.appendChild(row);
      }
    } catch (err) {
      list.innerHTML = `<div style="padding:32px;text-align:center;color:#ff3b30">Error loading characters:<br>${err.message}</div>`;
    }
  }

  async function openChat(characterSlug, existingSessionId) {
    screenList.classList.add('slide-out');
    screenChat.classList.add('active');

    Chat.reset();
    document.getElementById('chat-header-name').textContent = '…';
    document.getElementById('chat-avatar').src = '';

    try {
      let res, data;
      if (existingSessionId) {
        res = await fetch(`/api/sessions/${existingSessionId}`);
        data = await res.json();
      } else {
        res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ character_name: characterSlug, resume: true }),
        });
        data = await res.json();
      }

      currentSession = data.session;
      currentCard = data.card;

      const slug = data.slug || characterSlug;
      const avatarUrl = `/characters/${slug}/${currentCard.avatar || 'reference.png'}`;
      document.getElementById('chat-avatar').src = avatarUrl;
      document.getElementById('chat-header-name').textContent = currentCard.name;
      document.getElementById('online-dot').classList.add('visible');

      // Set accent color on CSS var
      document.documentElement.style.setProperty('--char-accent', currentCard.accent_color || '#007AFF');

      // Render existing messages
      Chat.renderMessages(data.messages, currentCard);

      // Set phase
      if (currentSession.phase === 'device') Chat.enterDevicePhase();

      // Connect SSE
      connectSSE(currentSession.id);

    } catch (err) {
      console.error('Failed to open chat:', err);
      Chat.showError('Could not load conversation');
    }
  }

  function connectSSE(sessionId) {
    if (sseSource) sseSource.close();
    sseSource = new EventSource(`/api/sessions/${sessionId}/events`);

    sseSource.addEventListener('message', e => {
      const msg = JSON.parse(e.data);
      Chat.appendMessage(msg, currentCard);
    });

    sseSource.addEventListener('image', e => {
      const data = JSON.parse(e.data);
      Chat.appendImage(data, currentCard);
    });

    sseSource.addEventListener('typing', e => {
      const { visible } = JSON.parse(e.data);
      Chat.setTyping(visible);
    });

    sseSource.addEventListener('audio', e => {
      const { url } = JSON.parse(e.data);
      Audio.play(url);
    });

    sseSource.addEventListener('device', e => {
      const data = JSON.parse(e.data);
      if (data.intent === 'stopped') {
        // handled by stop button
      }
    });

    sseSource.addEventListener('phase', e => {
      const { phase } = JSON.parse(e.data);
      if (phase === 'device') {
        currentSession.phase = 'device';
        Chat.enterDevicePhase();
      }
    });

    sseSource.addEventListener('server_error', e => {
      const { message } = JSON.parse(e.data);
      Chat.showError(message);
    });

    sseSource.onerror = () => {
      setTimeout(() => {
        if (currentSession) connectSSE(currentSession.id);
      }, 3000);
    };
  }

  function closeChat() {
    if (sseSource) { sseSource.close(); sseSource = null; }
    currentSession = null;
    currentCard = null;
    screenChat.classList.remove('active');
    screenList.classList.remove('slide-out');
    loadCharacterList();
  }

  function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  function init() {
    loadCharacterList();

    document.getElementById('btn-back').addEventListener('click', closeChat);

    // Search filter
    document.getElementById('search-input').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.char-row').forEach(row => {
        const name = row.querySelector('.char-name')?.textContent.toLowerCase() || '';
        row.style.display = name.includes(q) ? '' : 'none';
      });
    });

    // Emergency stop
    document.getElementById('stop-btn').addEventListener('click', async () => {
      await fetch('/api/devices/stop', { method: 'POST' });
      navigator.vibrate?.(200);
    });

    // Lightbox
    document.getElementById('lightbox-close').addEventListener('click', () => {
      document.getElementById('lightbox').classList.add('hidden');
    });
    document.getElementById('lightbox').addEventListener('click', e => {
      if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
    });

    // Keyboard shortcut: Escape = emergency stop
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') document.getElementById('stop-btn').click();
    });
  }

  return {
    init,
    getSession: () => currentSession,
    getCard: () => currentCard,
    formatFullTime,
    refreshCharacterList: loadCharacterList,
  };
})();

// ===== Audio Player =====
const Audio = (() => {
  let player = null;

  function play(url) {
    if (!url) return;
    if (player) { player.pause(); player.src = ''; }
    player = new window.Audio(url);
    player.play().catch(() => {});
  }

  return { play };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
