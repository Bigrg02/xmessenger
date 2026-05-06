// ===== Settings & Character Management =====

const Settings = (() => {
  const screenList     = document.getElementById('screen-list');
  const screenSettings = document.getElementById('screen-settings');
  const screenForm     = document.getElementById('screen-char-form');
  const draftModal     = document.getElementById('draft-modal');
  const promptModal    = document.getElementById('prompt-modal');
  const workflowNodesEl = document.getElementById('comfy-workflow-nodes');
  const comfyCharacterSelectEl = document.getElementById('comfy-test-character');

  let editingSlug = null;
  let loadToken = 0;
  let comfySettingsLoaded = false;
  let comfyUiState = null;
  let comfyCharacters = [];

  // ── Navigation ──────────────────────────────────────────────

  function openSettings() {
    screenList.classList.add('slide-out');
    screenSettings.classList.add('active');
    loadSettingsCharList();
    loadComfyUiSettings();
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

  function openDraftModal() {
    document.getElementById('draft-prompt-input').value = '';
    draftModal.classList.remove('hidden');
    setTimeout(() => document.getElementById('draft-prompt-input').focus(), 10);
  }

  function closeDraftModal() {
    draftModal.classList.add('hidden');
  }

  function openPromptModal() {
    const name = document.getElementById('form-name').value.trim();
    if (!editingSlug || !name) {
      alert('Save or open a character first to preview its prompt.');
      return;
    }

    document.getElementById('prompt-phase-select').value = 'text';
    document.getElementById('prompt-sample-message').value = 'hey, how is your day going?';
    document.getElementById('prompt-preview-output').value = 'Loading prompt preview...';
    document.getElementById('prompt-preview-flags').innerHTML = '';
    promptModal.classList.remove('hidden');
    refreshPromptPreview();
  }

  function closePromptModal() {
    promptModal.classList.add('hidden');
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
          <a class="settings-char-export" href="/api/admin/characters/${c.slug}/export" download="${c.slug}.zip" title="Export ZIP">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </a>
          <button class="settings-char-edit" data-slug="${c.slug}">Edit</button>
        `;
        row.querySelector('.settings-char-export').addEventListener('click', e => e.stopPropagation());
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

  function splitIdValue(value) {
    return String(value || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  function setIdInputValue(inputId, values) {
    document.getElementById(inputId).value = Array.from(new Set(values)).join(', ');
  }

  function ensureDefaultComfyTestInputs() {
    const clothingEl = document.getElementById('comfy-test-clothing');
    const locationEl = document.getElementById('comfy-test-location');
    const actionEl = document.getElementById('comfy-test-action');

    if (clothingEl && !clothingEl.value.trim()) {
      clothingEl.value = 'black lace bra and emerald thong';
    }
    if (locationEl && !locationEl.value.trim()) {
      locationEl.value = 'leaning against the bedroom mirror';
    }
    if (actionEl && !actionEl.value.trim()) {
      actionEl.value = 'She is standing, facing the camera, waist-up mirror selfie with one hand on her hip';
    }
  }

  function getSelectedComfyCharacterSlug() {
    if (!comfyCharacterSelectEl) return '';

    const directValue = String(comfyCharacterSelectEl.value || '').trim();
    if (directValue) return directValue;

    const selectedOption = comfyCharacterSelectEl.selectedOptions?.[0];
    const optionSlug = String(selectedOption?.dataset?.slug || '').trim();
    if (optionSlug) return optionSlug;

    const selectedText = String(selectedOption?.textContent || '').trim();
    if (!selectedText) return '';

    const match = comfyCharacters.find(character => String(character.name || '').trim() === selectedText);
    return match?.slug || '';
  }

  function appendNodeId(inputId, nodeId) {
    const current = splitIdValue(document.getElementById(inputId).value);
    if (!current.includes(String(nodeId))) current.push(String(nodeId));
    setIdInputValue(inputId, current);
  }

  function renderWorkflowNodes(nodes = []) {
    if (!workflowNodesEl) return;

    if (!nodes.length) {
      workflowNodesEl.innerHTML = '<div class="workflow-node-empty">No workflow nodes found yet. Upload or refresh the shared workflow to inspect bindable nodes.</div>';
      return;
    }

    workflowNodesEl.innerHTML = '';
    for (const node of nodes) {
      const row = document.createElement('div');
      row.className = 'workflow-node-item';
      const actions = [];
      if (node.prompt_eligible) {
        actions.push(`<button type="button" class="workflow-node-action" data-bind-target="prompt" data-node-id="${escapeHtml(String(node.id || ''))}">Prompt</button>`);
      }
      if (node.reference_eligible) {
        actions.push(`<button type="button" class="workflow-node-action" data-bind-target="reference" data-node-id="${escapeHtml(String(node.id || ''))}">Reference</button>`);
      }
      if (node.seed_eligible) {
        actions.push(`<button type="button" class="workflow-node-action" data-bind-target="seed" data-node-id="${escapeHtml(String(node.id || ''))}">Seed</button>`);
      }

      row.innerHTML = `
        <div class="workflow-node-main">
          <div class="workflow-node-title">${escapeHtml(node.title || '(Untitled)')}</div>
          <div class="workflow-node-meta">${escapeHtml(node.class_type || 'Unknown')}<br>#${escapeHtml(String(node.id || ''))}</div>
        </div>
        <div class="workflow-node-actions">${actions.join('')}</div>
      `;
      row.querySelectorAll('[data-bind-target]').forEach(button => {
        button.addEventListener('click', () => {
          const nodeId = button.dataset.nodeId;
          const target = button.dataset.bindTarget;
          if (target === 'prompt') appendNodeId('comfy-prompt-node-ids', nodeId);
          if (target === 'reference') appendNodeId('comfy-reference-node-ids', nodeId);
          if (target === 'seed') appendNodeId('comfy-seed-node-ids', nodeId);
        });
      });
      workflowNodesEl.appendChild(row);
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }

  function setButtonBusy(button, busyLabel) {
    if (!button) return () => {};
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
    return () => {
      button.disabled = false;
      button.textContent = originalLabel;
    };
  }

  function formatDateTime(timestamp) {
    if (!timestamp) return '';
    try {
      return new Date(timestamp).toLocaleString();
    } catch (_) {
      return '';
    }
  }

  function renderServerStatus(data) {
    const el = document.getElementById('comfy-server-status');
    const effectiveUrl = data?.effective_server_url || 'Not set';
    const validation = data?.last_validation || null;
    const serverCheck = validation?.checks?.find(check => check.key === 'server');
    const statusClass = serverCheck ? (serverCheck.ok ? 'ok' : 'error') : 'neutral';
    const statusLabel = serverCheck ? (serverCheck.ok ? 'Reachable' : 'Unreachable') : 'Not tested yet';
    const checkedAt = validation?.checked_at ? `Last checked ${escapeHtml(formatDateTime(validation.checked_at))}` : 'Run dry validation to test the selected server.';

    el.className = `workflow-status-card ${statusClass}`;
    el.innerHTML = `
      <div class="workflow-status-line"><strong>Active server:</strong> ${escapeHtml(effectiveUrl)}</div>
      <div class="workflow-status-line"><strong>Status:</strong> ${escapeHtml(statusLabel)}</div>
      <div class="workflow-status-line workflow-status-muted">${checkedAt}</div>
    `;
  }

  function renderWorkflowStatus(data) {
    const el = document.getElementById('comfy-workflow-status');
    const status = data?.workflow_status || {};
    const exists = !!status.exists;
    const nodes = Number(status.node_count || 0);
    const titled = Number(status.titled_node_count || 0);
    const updatedAt = status.updated_at ? formatDateTime(status.updated_at) : '';
    el.className = `workflow-status-card ${exists ? 'ok' : 'warning'}`;
    el.innerHTML = exists
      ? `
        <div class="workflow-status-line"><strong>${escapeHtml(status.filename || 'workflow.json')}</strong> is active.</div>
        <div class="workflow-status-line">${nodes} total nodes, ${titled} titled nodes detected.</div>
        <div class="workflow-status-line workflow-status-muted">${updatedAt ? `Updated ${escapeHtml(updatedAt)}` : 'Shared workflow file is ready.'}</div>
      `
      : `
        <div class="workflow-status-line"><strong>No shared workflow uploaded yet.</strong></div>
        <div class="workflow-status-line workflow-status-muted">Upload a ComfyUI API workflow JSON here to manage everything inside the app.</div>
      `;
  }

  function renderValidationResult(validation) {
    const summaryEl = document.getElementById('comfy-validation-summary');
    const resultsEl = document.getElementById('comfy-validation-results');
    const promptEl = document.getElementById('comfy-validation-prompt-preview');

    if (!validation) {
      summaryEl.className = 'workflow-validation-summary';
      summaryEl.textContent = 'No validation run yet.';
      resultsEl.innerHTML = '';
      promptEl.value = '';
      return;
    }

    summaryEl.className = `workflow-validation-summary ${validation.ok ? 'ok' : 'error'}`;
    summaryEl.innerHTML = `
      <div class="workflow-validation-summary-main">${escapeHtml(validation.summary || (validation.ok ? 'Validation passed.' : 'Validation failed.'))}</div>
      <div class="workflow-validation-summary-sub">${escapeHtml(validation.server_url || '')}${validation.checked_at ? ` • ${escapeHtml(formatDateTime(validation.checked_at))}` : ''}</div>
    `;

    resultsEl.innerHTML = (validation.checks || []).map(check => `
      <div class="workflow-check ${check.ok ? 'ok' : 'error'}">
        <div class="workflow-check-header">
          <span class="workflow-check-dot"></span>
          <strong>${escapeHtml(check.label || check.key || 'Check')}</strong>
        </div>
        <div class="workflow-check-message">${escapeHtml(check.message || '')}</div>
        ${check.detail ? `<pre class="workflow-check-detail">${escapeHtml(JSON.stringify(check.detail, null, 2))}</pre>` : ''}
      </div>
    `).join('');

    promptEl.value = validation.prompt_preview || '';
  }

  async function populateComfyCharacterOptions(selectedSlug = '') {
    if (!comfyCharacterSelectEl) return;

    const currentValue = selectedSlug || comfyCharacterSelectEl.value;
    try {
      const res = await fetch('/api/admin/characters');
      const chars = await res.json();
      if (!res.ok) throw new Error(chars.error || 'Failed to load characters');
      comfyCharacters = Array.isArray(chars) ? chars : [];

      comfyCharacterSelectEl.innerHTML = '<option value="">Select a character</option>';
      for (const character of comfyCharacters) {
        const option = document.createElement('option');
        option.value = character.slug;
        option.dataset.slug = character.slug;
        option.textContent = character.name;
        if (character.slug === currentValue) option.selected = true;
        comfyCharacterSelectEl.appendChild(option);
      }

      if (!comfyCharacterSelectEl.value && comfyCharacters.length) {
        comfyCharacterSelectEl.value = comfyCharacters[0].slug;
      }
    } catch (_) {
      comfyCharacters = [];
      comfyCharacterSelectEl.innerHTML = '<option value="">Unable to load characters</option>';
    }
  }

  function applyComfyUiPayload(data, { markLoaded = true, selectedCharacterSlug = '' } = {}) {
    comfyUiState = data || null;

    document.getElementById('comfy-server-url').value = data?.settings?.server_url || '';
    document.getElementById('comfy-prompt-node-ids').value = (data?.settings?.prompt_node_ids || []).join(', ');
    document.getElementById('comfy-reference-node-ids').value = (data?.settings?.reference_image_node_ids || []).join(', ');
    document.getElementById('comfy-seed-node-ids').value = (data?.settings?.seed_node_ids || []).join(', ');

    renderServerStatus(data);
    renderWorkflowStatus(data);
    renderWorkflowNodes(data?.workflow_nodes || []);
    renderValidationResult(data?.last_validation || null);
    ensureDefaultComfyTestInputs();
    populateComfyCharacterOptions(
      selectedCharacterSlug
      || data?.last_validation?.selected_character_slug
      || ''
    );

    if (markLoaded) comfySettingsLoaded = true;
  }

  async function loadComfyUiSettings(force = false) {
    if (comfySettingsLoaded && !force) return;

    workflowNodesEl.innerHTML = '<div class="workflow-node-empty">Loading workflow nodes...</div>';

    try {
      const res = await fetch('/api/admin/comfyui-settings');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load ComfyUI settings');
      applyComfyUiPayload(data);
    } catch (err) {
      workflowNodesEl.innerHTML = `<div class="workflow-node-empty">Error loading workflow nodes: ${escapeHtml(err.message)}</div>`;
      renderValidationResult(null);
      document.getElementById('comfy-server-status').className = 'workflow-status-card error';
      document.getElementById('comfy-server-status').textContent = `Error loading image system settings: ${err.message}`;
      document.getElementById('comfy-workflow-status').className = 'workflow-status-card error';
      document.getElementById('comfy-workflow-status').textContent = 'Unable to load workflow status.';
    }
  }

  async function saveComfyUiSettings(options = {}) {
    const btn = options.button || document.getElementById('btn-comfyui-save');
    const releaseButton = options.skipButtonState ? () => {} : setButtonBusy(btn, options.busyLabel || 'Saving...');

    try {
      const res = await fetch('/api/admin/comfyui-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server_url: document.getElementById('comfy-server-url').value.trim(),
          prompt_node_ids: document.getElementById('comfy-prompt-node-ids').value.trim(),
          reference_image_node_ids: document.getElementById('comfy-reference-node-ids').value.trim(),
          seed_node_ids: document.getElementById('comfy-seed-node-ids').value.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save ComfyUI settings');

      applyComfyUiPayload(data, {
        selectedCharacterSlug: getSelectedComfyCharacterSlug(),
      });
      return data;
    } catch (err) {
      if (!options.quiet) {
        alert(`ComfyUI settings failed to save: ${err.message}`);
      }
      throw err;
    } finally {
      releaseButton();
    }
  }

  async function uploadComfyWorkflow() {
    const input = document.getElementById('comfy-workflow-upload');
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const releaseButton = setButtonBusy(document.getElementById('btn-comfyui-upload'), 'Uploading...');
    try {
      const formData = new FormData();
      formData.append('workflow', file);
      const res = await fetch('/api/admin/comfyui-workflow', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload workflow');
      applyComfyUiPayload(data);
    } catch (err) {
      alert(`Workflow upload failed: ${err.message}`);
    } finally {
      releaseButton();
    }
  }

  async function validateComfyUiSettings() {
    const button = document.getElementById('btn-comfyui-validate');
    const releaseButton = setButtonBusy(button, 'Validating...');

    try {
      const selectedCharacterSlug = getSelectedComfyCharacterSlug();
      const sampleClothing = document.getElementById('comfy-test-clothing').value.trim();
      const sampleLocation = document.getElementById('comfy-test-location').value.trim();
      const sampleAction = document.getElementById('comfy-test-action').value.trim();

      await saveComfyUiSettings({
        quiet: true,
        skipButtonState: true,
      });

      const payload = {
        selected_character_slug: selectedCharacterSlug,
        sample_clothing: sampleClothing,
        sample_location: sampleLocation,
        sample_action: sampleAction,
      };

      const res = await fetch('/api/admin/comfyui-settings/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to validate image system');
      applyComfyUiPayload(data, { selectedCharacterSlug });
    } catch (err) {
      alert(`Image setup validation failed: ${err.message}`);
    } finally {
      releaseButton();
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
    document.getElementById('form-example-dialogue').value = '';
    document.getElementById('form-pet-names').value = '';
    document.getElementById('form-backstory').value = '';
    document.getElementById('form-relationship').value = '';
    document.getElementById('form-scenario').value = '';
    document.getElementById('form-sexual-personality').value = '';
    document.getElementById('form-core-desires').value = '';
    document.getElementById('form-turn-ons').value = '';
    document.getElementById('form-kinks').value = '';
    document.getElementById('form-limits').value = '';
    document.getElementById('form-aftercare-style').value = '';
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
      document.getElementById('form-example-dialogue').value = c.example_dialogue || '';
      document.getElementById('form-pet-names').value = (c.pet_names || []).join(', ');
      document.getElementById('form-backstory').value = c.backstory || '';
      document.getElementById('form-relationship').value = c.relationship_to_user || '';
      document.getElementById('form-scenario').value = c.scenario || '';
      document.getElementById('form-sexual-personality').value = c.sexual_personality || '';
      document.getElementById('form-core-desires').value = c.core_desires || '';
      document.getElementById('form-turn-ons').value = (c.turn_ons || []).join(', ');
      document.getElementById('form-kinks').value = (c.kinks || []).join(', ');
      document.getElementById('form-limits').value = (c.limits || []).join(', ');
      document.getElementById('form-aftercare-style').value = c.aftercare_style || '';
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

  function collectDraftSeed() {
    return {
      name: document.getElementById('form-name').value.trim(),
      personality: document.getElementById('form-personality').value.trim(),
      texting_style: document.getElementById('form-texting-style').value.trim(),
      example_dialogue: document.getElementById('form-example-dialogue').value.trim(),
      pet_names: document.getElementById('form-pet-names').value.trim(),
      backstory: document.getElementById('form-backstory').value.trim(),
      relationship_to_user: document.getElementById('form-relationship').value.trim(),
      scenario: document.getElementById('form-scenario').value.trim(),
      sexual_personality: document.getElementById('form-sexual-personality').value.trim(),
      core_desires: document.getElementById('form-core-desires').value.trim(),
      turn_ons: document.getElementById('form-turn-ons').value.trim(),
      kinks: document.getElementById('form-kinks').value.trim(),
      limits: document.getElementById('form-limits').value.trim(),
      aftercare_style: document.getElementById('form-aftercare-style').value.trim(),
      first_message: document.getElementById('form-first-message').value.trim(),
      appearance_prompt: document.getElementById('form-appearance').value.trim(),
    };
  }

  function applyGeneratedDraft(draft) {
    document.getElementById('form-name').value = draft.name || document.getElementById('form-name').value;
    document.getElementById('form-personality').value = draft.personality || '';
    document.getElementById('form-texting-style').value = draft.texting_style || '';
    document.getElementById('form-example-dialogue').value = draft.example_dialogue || '';
    document.getElementById('form-pet-names').value = (draft.pet_names || []).join(', ');
    document.getElementById('form-backstory').value = draft.backstory || '';
    document.getElementById('form-relationship').value = draft.relationship_to_user || '';
    document.getElementById('form-scenario').value = draft.scenario || '';
    document.getElementById('form-sexual-personality').value = draft.sexual_personality || '';
    document.getElementById('form-core-desires').value = draft.core_desires || '';
    document.getElementById('form-turn-ons').value = (draft.turn_ons || []).join(', ');
    document.getElementById('form-kinks').value = (draft.kinks || []).join(', ');
    document.getElementById('form-limits').value = (draft.limits || []).join(', ');
    document.getElementById('form-aftercare-style').value = draft.aftercare_style || '';
    document.getElementById('form-first-message').value = draft.first_message || '';
    document.getElementById('form-appearance').value = draft.appearance_prompt || '';
  }

  function renderPromptFlags(sections = {}, flags = {}) {
    const container = document.getElementById('prompt-preview-flags');
    const items = [
      ['base', 'Base Persona', sections.base],
      ['limits', 'Limits', sections.limits],
      ['exampleDialogue', 'Example Dialogue', sections.exampleDialogue],
      ['backstory', 'Backstory', sections.backstory || flags.includeBackstory],
      ['adult', 'Adult Context', sections.adult || flags.adultContext],
      ['devicePhaseStyle', 'Device Style', sections.devicePhaseStyle],
    ];

    container.innerHTML = '';
    for (const [, label, active] of items) {
      const pill = document.createElement('span');
      pill.className = `prompt-flag${active ? ' active' : ''}`;
      pill.textContent = label;
      container.appendChild(pill);
    }
  }

  async function refreshPromptPreview() {
    if (!editingSlug) return;

    const phase = document.getElementById('prompt-phase-select').value;
    const sampleMessage = document.getElementById('prompt-sample-message').value.trim();
    const output = document.getElementById('prompt-preview-output');
    const refreshBtn = document.getElementById('btn-prompt-refresh');
    const originalLabel = refreshBtn.textContent;

    output.value = 'Loading prompt preview...';
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing...';

    try {
      const res = await fetch('/api/admin/prompt-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: editingSlug,
          phase,
          sample_user_message: sampleMessage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load prompt preview');

      output.value = data.prompt || '';
      renderPromptFlags(data.sections || {}, data.flags || {});
    } catch (err) {
      output.value = `Error loading prompt preview: ${err.message}`;
      document.getElementById('prompt-preview-flags').innerHTML = '';
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = originalLabel;
    }
  }

  // ── Model Test ───────────────────────────────────────────────

  const REFUSAL_RE = /\b(i (can't|cannot|am unable|won't|will not)|i (don't|do not) (feel comfortable|think i should)|against my (guidelines|policy|values)|not (appropriate|something i can)|as an ai\b|i (must|need to) (decline|refuse)|i('m| am) (not able|sorry, (but )?i))/i;

  async function runModelTest() {
    const model = document.getElementById('form-model').value.trim();
    if (!model) { alert('Select a model first.'); return; }

    const levels = ['soft', 'medium', 'hard'];
    const btn = document.getElementById('btn-run-test');
    btn.disabled = true;
    btn.classList.add('running');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><polygon points="5,3 19,12 5,21"/></svg> Testing…';

    for (const level of levels) {
      document.getElementById(`test-response-${level}`).className = 'test-response hidden';
      document.getElementById(`test-response-${level}`).textContent = '';
      const st = document.getElementById(`test-status-${level}`);
      st.textContent = '';
      st.className = 'test-status';
    }

    for (const level of levels) {
      const prompt  = document.getElementById(`test-prompt-${level}`).value.trim();
      const respEl  = document.getElementById(`test-response-${level}`);
      const statEl  = document.getElementById(`test-status-${level}`);

      statEl.textContent = 'sending…';
      statEl.className = 'test-status pending';
      respEl.textContent = 'Waiting for response…';
      respEl.className = 'test-response pending';

      try {
        const res  = await fetch('/api/admin/test-model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt }),
        });
        const data = await res.json();

        if (data.error) {
          respEl.textContent = data.error;
          respEl.className = 'test-response fail';
          statEl.textContent = '✗ error';
          statEl.className = 'test-status fail';
        } else {
          const refused = REFUSAL_RE.test(data.response);
          respEl.textContent = data.response;
          respEl.className = `test-response ${refused ? 'fail' : 'pass'}`;
          statEl.textContent = refused ? '✗ refused' : '✓ passed';
          statEl.className = `test-status ${refused ? 'fail' : 'pass'}`;
        }
      } catch (err) {
        respEl.textContent = `Network error: ${err.message}`;
        respEl.className = 'test-response fail';
        statEl.textContent = '✗ error';
        statEl.className = 'test-status fail';
      }
    }

    btn.disabled = false;
    btn.classList.remove('running');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><polygon points="5,3 19,12 5,21"/></svg> Run Test';
  }

  async function generateCharacterDraft(conceptPrompt) {
    const model = document.getElementById('form-model').value.trim();
    const seed = collectDraftSeed();
    if (!seed.name) { alert('Enter a character name first.'); return; }
    if (!model) { alert('Select a model first.'); return; }
    if (!conceptPrompt?.trim()) { alert('Give it a one-line concept first.'); return; }

    const hasExistingContent = Object.entries(seed).some(([key, value]) => key !== 'name' && value);
    if (hasExistingContent && !confirm('Generate a full cohesive draft from the current inputs? This will replace the form text fields.')) {
      return;
    }

    closeDraftModal();

    const overlay = document.getElementById('form-saving');
    const overlayLabel = document.querySelector('#form-saving .saving-label');
    const generateBtn = document.getElementById('btn-generate-draft');
    const originalLabel = overlayLabel.textContent;
    const originalButton = generateBtn.innerHTML;

    overlay.classList.remove('hidden');
    overlayLabel.textContent = 'Generating draft...';
    generateBtn.disabled = true;
    generateBtn.classList.add('running');
    generateBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 3v6"/><path d="M12 15v6"/><path d="M3 12h6"/><path d="M15 12h6"/><path d="M5.64 5.64l4.24 4.24"/><path d="M14.12 14.12l4.24 4.24"/><path d="M18.36 5.64l-4.24 4.24"/><path d="M9.88 14.12l-4.24 4.24"/></svg> Generating...';

    try {
      const res = await fetch('/api/admin/generate-character-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, seed, concept_prompt: conceptPrompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      applyGeneratedDraft(data.draft || {});
    } catch (err) {
      alert(`Draft generation failed: ${err.message}`);
    } finally {
      overlay.classList.add('hidden');
      overlayLabel.textContent = originalLabel;
      generateBtn.disabled = false;
      generateBtn.classList.remove('running');
      generateBtn.innerHTML = originalButton;
    }
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
      fd.append('example_dialogue', document.getElementById('form-example-dialogue').value.trim());
      fd.append('pet_names', document.getElementById('form-pet-names').value.trim());
      fd.append('backstory', document.getElementById('form-backstory').value.trim());
      fd.append('relationship_to_user', document.getElementById('form-relationship').value.trim());
      fd.append('scenario', document.getElementById('form-scenario').value.trim());
      fd.append('sexual_personality', document.getElementById('form-sexual-personality').value.trim());
      fd.append('core_desires', document.getElementById('form-core-desires').value.trim());
      fd.append('turn_ons', document.getElementById('form-turn-ons').value.trim());
      fd.append('kinks', document.getElementById('form-kinks').value.trim());
      fd.append('limits', document.getElementById('form-limits').value.trim());
      fd.append('aftercare_style', document.getElementById('form-aftercare-style').value.trim());
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

    const importInput = document.getElementById('import-char-input');
    document.getElementById('btn-import-character').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      importInput.value = '';
      if (!file) return;

      const btn = document.getElementById('btn-import-character');
      btn.disabled = true;
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/admin/characters/import', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Import failed');
        await loadSettingsCharList();
        App.refreshCharacterList();
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    });
    document.getElementById('btn-comfyui-refresh').addEventListener('click', () => loadComfyUiSettings(true));
    document.getElementById('btn-comfyui-save').addEventListener('click', saveComfyUiSettings);
    document.getElementById('btn-comfyui-download').addEventListener('click', () => {
      window.location.href = '/api/admin/comfyui-workflow';
    });
    document.getElementById('btn-comfyui-upload').addEventListener('click', () => {
      document.getElementById('comfy-workflow-upload').click();
    });
    document.getElementById('comfy-workflow-upload').addEventListener('change', uploadComfyWorkflow);
    document.getElementById('btn-comfyui-validate').addEventListener('click', validateComfyUiSettings);
    document.getElementById('btn-form-back').addEventListener('click', closeForm);
    document.getElementById('btn-form-save').addEventListener('click', saveForm);
    document.getElementById('btn-delete-char').addEventListener('click', deleteCharacter);

    initModelPicker();
    document.getElementById('btn-run-test').addEventListener('click', runModelTest);
    document.getElementById('btn-prompt-preview').addEventListener('click', openPromptModal);
    document.getElementById('btn-generate-draft').addEventListener('click', openDraftModal);
    document.getElementById('btn-draft-modal-close').addEventListener('click', closeDraftModal);
    document.getElementById('btn-draft-modal-cancel').addEventListener('click', closeDraftModal);
    document.getElementById('btn-draft-modal-generate').addEventListener('click', () => {
      generateCharacterDraft(document.getElementById('draft-prompt-input').value);
    });
    draftModal.addEventListener('click', e => {
      if (e.target === draftModal) closeDraftModal();
    });
    document.getElementById('draft-prompt-input').addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        generateCharacterDraft(e.target.value);
      }
    });
    document.getElementById('btn-prompt-modal-close').addEventListener('click', closePromptModal);
    document.getElementById('btn-prompt-refresh').addEventListener('click', refreshPromptPreview);
    document.getElementById('btn-prompt-copy').addEventListener('click', async () => {
      const text = document.getElementById('prompt-preview-output').value;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {}
    });
    promptModal.addEventListener('click', e => {
      if (e.target === promptModal) closePromptModal();
    });

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
