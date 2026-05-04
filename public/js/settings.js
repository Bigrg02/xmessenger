// ===== Settings & Character Management =====

const Settings = (() => {
  const screenList     = document.getElementById('screen-list');
  const screenSettings = document.getElementById('screen-settings');
  const screenForm     = document.getElementById('screen-char-form');

  let editingSlug = null;
  let loadToken = 0;

  // ── Navigation ──────────────────────────────────────────────

  function openSettings() {
    screenList.classList.add('slide-out');
    screenSettings.classList.add('active');
    loadSettingsCharList();
  }

  function closeSettings() {
    screenSettings.classList.remove('active');
    screenList.classList.remove('slide-out');
    App.refreshCharacterList();
  }

  function openForm(slug = null) {
    editingSlug = slug;
    loadToken++;
    screenSettings.classList.add('slide-out');
    screenForm.classList.add('active');
    document.getElementById('char-form').scrollTo(0, 0);

    if (slug) {
      document.getElementById('form-title').textContent = 'Edit Character';
      document.getElementById('delete-section').classList.remove('hidden');
      loadFormData(slug);
    } else {
      document.getElementById('form-title').textContent = 'New Character';
      document.getElementById('delete-section').classList.add('hidden');
      resetForm();
    }
  }

  function closeForm() {
    screenForm.classList.remove('active');
    screenSettings.classList.remove('slide-out');
    loadSettingsCharList();
  }

  // ── Character List (Settings screen) ────────────────────────

  async function loadSettingsCharList() {
    const el = document.getElementById('settings-char-list');
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--label-secondary)">Loading…</div>';

    try {
      const res = await fetch('/api/admin/characters');
      const chars = await res.json();

      if (!chars.length) {
        el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--label-secondary)">No characters yet.<br>Tap + to create one.</div>';
        return;
      }

      el.innerHTML = '';
      for (const c of chars) {
        const row = document.createElement('div');
        row.className = 'settings-char-row';
        const avatarSrc = `/characters/${c.slug}/${c.avatar || 'reference.png'}`;
        row.innerHTML = `
          <img class="settings-char-avatar" src="${avatarSrc}" alt="${c.name}"
            onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><circle cx=%2220%22 cy=%2220%22 r=%2220%22 fill=%22%23ddd%22/></svg>'">
          <span class="settings-char-name">${c.name}</span>
          <button class="settings-char-edit" data-slug="${c.slug}">Edit</button>
        `;
        row.querySelector('.settings-char-edit').addEventListener('click', e => {
          e.stopPropagation();
          openForm(c.slug);
        });
        row.addEventListener('click', () => openForm(c.slug));
        el.appendChild(row);
      }
    } catch (err) {
      el.innerHTML = `<div style="padding:24px;text-align:center;color:#ff3b30">Error: ${err.message}</div>`;
    }
  }

  // ── Model Picker ─────────────────────────────────────────────

  let allModels = null; // session cache

  async function fetchModels() {
    if (allModels) return allModels;
    const res = await fetch('/api/admin/models');
    if (!res.ok) throw new Error('Failed to load models');
    allModels = await res.json();
    return allModels;
  }

  function formatPricePer1M(perToken) {
    const n = parseFloat(perToken);
    if (!n) return null;
    const pm = n * 1_000_000;
    if (pm < 0.001) return '<$0.01';
    if (pm < 10)  return `$${pm.toFixed(2)}`;
    return `$${pm.toFixed(1)}`;
  }

  function buildPriceHtml(pricing) {
    const inP  = formatPricePer1M(pricing?.prompt);
    const outP = formatPricePer1M(pricing?.completion);
    if (!inP && !outP) return '<span class="price-free">free</span>';
    return `<span class="price-in">${inP ?? '?'}</span> in<br><span class="price-out">${outP ?? '?'}</span> out`;
  }

  function renderModelList(models, filter, selectedId) {
    const list = document.getElementById('model-list');
    const status = document.getElementById('model-status');
    list.innerHTML = '';

    const q = (filter || '').toLowerCase().trim();
    const filtered = q
      ? models.filter(m =>
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q)
        )
      : models;

    if (!filtered.length) {
      status.textContent = 'No models match';
      status.classList.remove('hidden');
      return;
    }
    status.classList.add('hidden');

    const visible = filtered.slice(0, 120);
    for (const m of visible) {
      const div = document.createElement('div');
      div.className = 'model-item' + (m.id === selectedId ? ' selected' : '');
      div.dataset.id = m.id;
      div.innerHTML = `
        <div class="model-item-body">
          <span class="model-item-name">${m.name}</span>
          <span class="model-item-id">${m.id}</span>
        </div>
        <div class="model-item-price">${buildPriceHtml(m.pricing)}</div>
      `;
      div.addEventListener('mousedown', e => {
        e.preventDefault(); // keep input focused so blur doesn't fire first
        selectModel(m.id, m.name);
      });
      div.addEventListener('touchstart', e => {
        e.preventDefault();
        selectModel(m.id, m.name);
      }, { passive: false });
      list.appendChild(div);
    }

    if (filtered.length > 120) {
      const more = document.createElement('div');
      more.className = 'model-status';
      more.style.display = 'block';
      more.textContent = `${filtered.length - 120} more — keep typing to filter`;
      list.appendChild(more);
    }
  }

  function selectModel(id, name) {
    document.getElementById('form-model').value = id;
    document.getElementById('model-search').value = name || id;
    closeModelDropdown();
  }

  function openModelDropdown() {
    const dd = document.getElementById('model-dropdown');
    dd.classList.add('open');
    const status = document.getElementById('model-status');
    const selectedId = document.getElementById('form-model').value;

    if (allModels) {
      renderModelList(allModels, document.getElementById('model-search').value, selectedId);
    } else {
      status.textContent = 'Loading models…';
      status.classList.remove('hidden');
      document.getElementById('model-list').innerHTML = '';
      fetchModels()
        .then(models => renderModelList(models, document.getElementById('model-search').value, selectedId))
        .catch(err => {
          status.textContent = `Error: ${err.message}`;
        });
    }
  }

  function closeModelDropdown() {
    document.getElementById('model-dropdown').classList.remove('open');
  }

  function setModelValue(modelId) {
    document.getElementById('form-model').value = modelId || '';
    const model = allModels?.find(m => m.id === modelId);
    document.getElementById('model-search').value = model ? model.name : (modelId || '');
  }

  function initModelPicker() {
    const searchInput = document.getElementById('model-search');

    searchInput.addEventListener('focus', openModelDropdown);
    searchInput.addEventListener('blur', () => setTimeout(closeModelDropdown, 200));
    searchInput.addEventListener('input', () => {
      const selectedId = document.getElementById('form-model').value;
      if (allModels) renderModelList(allModels, searchInput.value, selectedId);
    });
  }

  // ── Form helpers ─────────────────────────────────────────────

  function resetForm() {
    document.getElementById('form-slug').value = '';
    document.getElementById('form-name').value = '';
    document.getElementById('form-accent').value = '#ff6b9d';
    document.getElementById('form-personality').value = '';
    document.getElementById('form-texting-style').value = '';
    document.getElementById('form-scenario').value = '';
    document.getElementById('form-first-message').value = '';
    document.getElementById('form-appearance').value = '';
    setModelValue('openai/gpt-4o');
    clearPhotoSlot('portrait');
    clearPhotoSlot('fullbody');
    syncSwatches('#ff6b9d');
  }

  async function loadFormData(slug) {
    const token = loadToken;
    resetForm();
    document.getElementById('form-saving').classList.remove('hidden');

    try {
      const res = await fetch(`/api/admin/characters/${slug}`);
      if (token !== loadToken) return;
      if (!res.ok) throw new Error('Character not found');
      const c = await res.json();

      document.getElementById('form-slug').value = slug;
      document.getElementById('form-name').value = c.name || '';
      document.getElementById('form-accent').value = c.accent_color || '#ff6b9d';
      document.getElementById('form-personality').value = c.personality || '';
      document.getElementById('form-texting-style').value = c.texting_style || '';
      document.getElementById('form-scenario').value = c.scenario || '';
      document.getElementById('form-first-message').value = c.first_message || '';
      document.getElementById('form-appearance').value = c.appearance_prompt || '';

      setModelValue(c.model || 'openai/gpt-4o');
      syncSwatches(c.accent_color || '#ff6b9d');

      const portrait = c.reference_portrait || c.avatar;
      if (portrait) showPhotoPreview('portrait', `/characters/${slug}/${portrait}`);
      if (c.reference_fullbody) showPhotoPreview('fullbody', `/characters/${slug}/${c.reference_fullbody}`);
    } catch (err) {
      console.error('[settings] loadFormData error:', err);
    } finally {
      document.getElementById('form-saving').classList.add('hidden');
    }
  }

  function clearPhotoSlot(type) {
    const preview     = document.getElementById(`preview-${type}`);
    const placeholder = document.getElementById(`placeholder-${type}`);
    const slot        = document.getElementById(`slot-${type}`);
    preview.src = '';
    preview.classList.add('hidden');
    placeholder.classList.remove('hidden');
    slot.classList.remove('has-photo');
    document.getElementById(`input-${type}`).value = '';
  }

  function showPhotoPreview(type, src) {
    const preview     = document.getElementById(`preview-${type}`);
    const placeholder = document.getElementById(`placeholder-${type}`);
    const slot        = document.getElementById(`slot-${type}`);
    preview.src = src;
    preview.classList.remove('hidden');
    placeholder.classList.add('hidden');
    slot.classList.add('has-photo');
  }

  function syncSwatches(color) {
    document.querySelectorAll('.color-swatch').forEach(sw => {
      sw.classList.toggle('selected', sw.dataset.color.toLowerCase() === color.toLowerCase());
    });
  }

  // ── Save ─────────────────────────────────────────────────────

  async function saveForm() {
    const name = document.getElementById('form-name').value.trim();
    if (!name) { alert('Please enter a character name.'); return; }

    const model = document.getElementById('form-model').value.trim();
    if (!model) { alert('Please select a model.'); return; }

    const overlay = document.getElementById('form-saving');
    overlay.classList.remove('hidden');

    try {
      const fd = new FormData();
      fd.append('name', name);
      fd.append('accent_color', document.getElementById('form-accent').value);
      fd.append('model', model);
      fd.append('personality', document.getElementById('form-personality').value.trim());
      fd.append('texting_style', document.getElementById('form-texting-style').value.trim());
      fd.append('scenario', document.getElementById('form-scenario').value.trim());
      fd.append('first_message', document.getElementById('form-first-message').value.trim());
      fd.append('appearance_prompt', document.getElementById('form-appearance').value.trim());

      const portraitFile = document.getElementById('input-portrait').files[0];
      const fullbodyFile = document.getElementById('input-fullbody').files[0];
      if (portraitFile) fd.append('portrait', portraitFile);
      if (fullbodyFile) fd.append('fullbody', fullbodyFile);

      const url    = editingSlug ? `/api/admin/characters/${editingSlug}` : '/api/admin/characters';
      const method = editingSlug ? 'PATCH' : 'POST';

      const res  = await fetch(url, { method, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');

      closeForm();
      App.refreshCharacterList();
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    } finally {
      overlay.classList.add('hidden');
    }
  }

  // ── Delete ────────────────────────────────────────────────────

  async function deleteCharacter() {
    if (!editingSlug) return;
    if (!confirm('Delete this character? All conversation history will also be lost.')) return;

    const overlay = document.getElementById('form-saving');
    overlay.classList.remove('hidden');
    document.querySelector('#form-saving .saving-label').textContent = 'Deleting…';

    try {
      const res = await fetch(`/api/admin/characters/${editingSlug}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      closeForm();
      App.refreshCharacterList();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      overlay.classList.add('hidden');
      document.querySelector('#form-saving .saving-label').textContent = 'Saving…';
    }
  }

  // ── Init ──────────────────────────────────────────────────────

  function init() {
    document.getElementById('btn-settings').addEventListener('click', openSettings);
    document.getElementById('btn-settings-back').addEventListener('click', closeSettings);
    document.getElementById('btn-new-character').addEventListener('click', () => openForm(null));
    document.getElementById('btn-form-back').addEventListener('click', closeForm);
    document.getElementById('btn-form-save').addEventListener('click', saveForm);
    document.getElementById('btn-delete-char').addEventListener('click', deleteCharacter);

    initModelPicker();

    ['portrait', 'fullbody'].forEach(type => {
      const input = document.getElementById(`input-${type}`);
      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        showPhotoPreview(type, URL.createObjectURL(file));
      });
    });

    document.querySelectorAll('.color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        document.getElementById('form-accent').value = sw.dataset.color;
        syncSwatches(sw.dataset.color);
      });
    });

    document.getElementById('form-accent').addEventListener('input', e => syncSwatches(e.target.value));
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => Settings.init());
