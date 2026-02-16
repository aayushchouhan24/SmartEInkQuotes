/* ═══════════════════════════════════════════════════════════════════════════ */
/* EInk Smart Display — Main Application                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── API_BASE auto-detects the current host (works on Vercel or local) ─────
  const API_BASE = window.location.origin;

  // ── BLE UUIDs (must match ESP32 firmware) ───────────────────────────────
  const BLE_SVC = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
  const BLE_C_SSID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
  const BLE_C_PASS = 'beb5483f-36e1-4688-b7f5-ea07361b26a8';
  const BLE_C_SRV = 'beb54840-36e1-4688-b7f5-ea07361b26a8';
  const BLE_C_CMD = 'beb54841-36e1-4688-b7f5-ea07361b26a8';
  const BLE_C_STATUS = 'beb54842-36e1-4688-b7f5-ea07361b26a8';

  // ── State ─────────────────────────────────────────────────────────────────
  let token = localStorage.getItem('eink_token');
  let currentUser = null;
  let settings = null;
  let isLogin = true;
  let logEntries = [];

  // BLE State
  let bleDevice = null;
  let bleCmdChar = null;
  let bleSsidChar = null;
  let blePassChar = null;
  let bleSrvChar = null;
  let bleStatusChar = null;
  let bleConnected = false;
  let wifiOk = false;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ── DOM References ────────────────────────────────────────────────────────
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ═════════════════════════════════════════════════════════════════════════
  // API CLIENT
  // ═════════════════════════════════════════════════════════════════════════

  const API = {
    async request(path, options = {}) {
      const headers = { 'Content-Type': 'application/json', ...options.headers };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      if (res.status === 401) {
        logout();
        throw new Error('Session expired');
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    },

    login: (email, password) =>
      API.request('/api/auth/login', { method: 'POST', body: { email, password } }),

    register: (email, password) =>
      API.request('/api/auth/register', { method: 'POST', body: { email, password } }),

    me: () => API.request('/api/auth/me'),

    getSettings: () => API.request('/api/settings'),

    updateSettings: (data) =>
      API.request('/api/settings', { method: 'PUT', body: data }),

    getPreview: async () => {
      const res = await fetch(`${API_BASE}/api/preview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('No preview');
      return res.blob();
    },

    uploadImage: (base64) =>
      API.request('/api/upload', { method: 'POST', body: { image: base64 } }),

    getQuote: async () => {
      const res = await fetch(`${API_BASE}/api/quote`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.text();
    },
  };

  // ═════════════════════════════════════════════════════════════════════════
  // BLUETOOTH (Web Bluetooth API)
  // ═════════════════════════════════════════════════════════════════════════

  function updateBleUI(connected) {
    bleConnected = connected;
    const pill = $('#conn-bt');
    const text = $('#conn-bt-text');
    if (!pill) return;

    if (connected) {
      pill.classList.remove('offline');
      pill.classList.add('online');
      text.textContent = 'BT';
      $('#dash-connection').textContent = bleDevice?.name || 'Connected';
      $('#dash-connection').style.color = 'var(--success)';
    } else {
      pill.classList.remove('online');
      pill.classList.add('offline');
      text.textContent = 'BT';
      $('#dash-connection').textContent = 'Disconnected';
      $('#dash-connection').style.color = 'var(--text-muted)';
    }
  }

  // Expose globally so the onclick in HTML can call it
  window.bleConnect = async function () {
    if (!navigator.bluetooth) {
      toast('Web Bluetooth not available. Use Chrome/Edge on desktop or Android, with HTTPS or localhost.', 'error');
      addLog('Web Bluetooth not supported in this browser', 'error');
      return;
    }

    try {
      addLog('Scanning for EInk device...', 'info');
      toast('Scanning for Bluetooth devices...', 'info');

      bleDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_SVC] }],
      });

      bleDevice.addEventListener('gattserverdisconnected', () => {
        updateBleUI(false);
        addLog('Bluetooth disconnected', 'error');
        toast('Device disconnected', 'error');
      });

      addLog('Connecting to ' + bleDevice.name + '...', 'info');
      const server = await bleDevice.gatt.connect();
      const svc = await server.getPrimaryService(BLE_SVC);

      bleSsidChar = await svc.getCharacteristic(BLE_C_SSID);
      blePassChar = await svc.getCharacteristic(BLE_C_PASS);
      bleSrvChar = await svc.getCharacteristic(BLE_C_SRV);
      bleCmdChar = await svc.getCharacteristic(BLE_C_CMD);
      bleStatusChar = await svc.getCharacteristic(BLE_C_STATUS);

      // Read current values from device
      try {
        const ssidVal = dec.decode(await bleSsidChar.readValue());
        const srvVal = dec.decode(await bleSrvChar.readValue());
        if (ssidVal && ssidVal !== '(not set)') {
          if ($('#wifi-ssid')) $('#wifi-ssid').value = ssidVal;
        }
        
        // Auto-configure device if not set
        if (!srvVal || srvVal === '(not set)' || srvVal === '') {
          addLog('Device not configured — sending server URL + key...', 'info');
          const deviceKey = currentUser?.deviceKey || '';
          
          if (deviceKey) {
            // Write server URL + device key in format: "serverUrl|deviceKey"
            const combined = `${API_BASE}|${deviceKey}`;
            await bleSrvChar.writeValue(enc.encode(combined));
            addLog('→ Server configured', '');
            toast('Device auto-configured with server', 'success');
          } else {
            addLog('Warning: No device key yet — loading settings...', 'error');
          }
        } else {
          addLog('Device server: ' + srvVal.split('|')[0], 'info');
        }
      } catch (e) {
        // Some characteristics may not be readable
      }

      // Subscribe to status notifications
      try {
        await bleStatusChar.startNotifications();
        bleStatusChar.addEventListener('characteristicvaluechanged', (e) => {
          const msg = dec.decode(e.target.value);
          addLog('← ' + msg, '');
          parseBleStatus(msg);
        });
      } catch (e) {
        addLog('BLE notify error: ' + e.message, 'error');
      }

      updateBleUI(true);
      toast('Connected to ' + bleDevice.name, 'success');
      addLog('Connected! Ready to control device.', 'info');

      // Request status
      await bleSendCmd('STATUS');
    } catch (e) {
      if (e.name !== 'NotFoundError') {
        // NotFoundError = user cancelled the picker
        addLog('BLE error: ' + e.message, 'error');
        toast('Bluetooth error: ' + e.message, 'error');
      }
    }
  };

  function parseBleStatus(msg) {
    if (msg.startsWith('m:')) {
      const parts = Object.fromEntries(
        msg.split(' ').map((p) => {
          const [k, v] = p.split(':');
          return [k, v];
        }),
      );
      if (parts.w === '1') {
        wifiOk = true;
      }
      if (parts.ip && parts.ip !== '-') {
        addLog('Device IP: ' + parts.ip, 'info');
      }
    } else if (msg === 'wifi:ok') {
      wifiOk = true;
      toast('Device WiFi connected!', 'success');
    } else if (msg === 'wifi:fail') {
      toast('Device WiFi failed — check credentials', 'error');
    }
  }

  async function bleSendCmd(cmd) {
    if (!bleCmdChar || !bleConnected) {
      toast('Not connected via Bluetooth', 'error');
      return;
    }
    try {
      addLog('→ ' + cmd, '');
      await bleCmdChar.writeValue(enc.encode(cmd));
    } catch (e) {
      addLog('BLE write error: ' + e.message, 'error');
      toast('BLE error: ' + e.message, 'error');
    }
  }

  async function bleSaveWifi(ssid, pass, serverUrl) {
    if (!bleConnected) {
      toast('Connect via Bluetooth first', 'error');
      return;
    }
    try {
      await bleSsidChar.writeValue(enc.encode(ssid));
      await blePassChar.writeValue(enc.encode(pass));
      await bleSrvChar.writeValue(enc.encode(serverUrl));
      await bleSendCmd('SAVE');
      addLog('WiFi config sent to device', 'info');
      toast('WiFi config saved to device — reconnecting...', 'success');
    } catch (e) {
      addLog('BLE save error: ' + e.message, 'error');
      toast('Failed to save: ' + e.message, 'error');
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // TOAST NOTIFICATIONS
  // ═════════════════════════════════════════════════════════════════════════

  function toast(message, type = 'info') {
    const container = $('#toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);

    setTimeout(() => {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 300);
    }, 3500);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ACTIVITY LOG
  // ═════════════════════════════════════════════════════════════════════════

  function addLog(msg, type = '') {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logEntries.unshift({ time, msg, type });
    if (logEntries.length > 50) logEntries.pop();
    renderLog();
  }

  function renderLog() {
    const el = $('#dash-log');
    if (!el) return;
    if (logEntries.length === 0) {
      el.innerHTML = '<div class="log-empty">No activity yet</div>';
      return;
    }
    el.innerHTML = logEntries
      .map(
        (e) => {
          const iconCls = e.type === 'error' ? 'error' : e.type === 'info' ? 'info' : 'success';
          const iconSvg = e.type === 'error'
            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
            : e.type === 'info'
            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
            : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>';
          return `<div class="log-entry"><div class="log-icon ${iconCls}">${iconSvg}</div><span class="log-msg">${e.msg}</span><span class="log-time">${e.time}</span></div>`;
        },
      )
      .join('');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // CLOCK
  // ═════════════════════════════════════════════════════════════════════════

  function updateClock() {
    const el = $('#header-clock');
    if (el) {
      el.textContent = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // AUTH
  // ═════════════════════════════════════════════════════════════════════════

  function setupAuth() {
    const form = $('#auth-form');
    const toggleLink = $('#auth-toggle-link');
    const errorEl = $('#auth-error');
    const btnText = $('#auth-btn-text');
    const toggleText = $('#auth-toggle-text');

    toggleLink.addEventListener('click', (e) => {
      e.preventDefault();
      isLogin = !isLogin;
      btnText.textContent = isLogin ? 'Sign In' : 'Create Account';
      toggleLink.textContent = isLogin ? 'Sign Up' : 'Sign In';
      toggleText.textContent = isLogin ? "Don't have an account?" : 'Already have an account?';
      errorEl.textContent = '';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#auth-email').value.trim();
      const password = $('#auth-password').value;
      const btn = $('#auth-submit');

      errorEl.textContent = '';
      btn.disabled = true;
      btnText.textContent = isLogin ? 'Signing in...' : 'Creating account...';

      try {
        const data = isLogin ? await API.login(email, password) : await API.register(email, password);
        token = data.token;
        currentUser = data.user;
        settings = data.user.settings;
        localStorage.setItem('eink_token', token);
        showApp();
        addLog('Signed in successfully', 'info');
      } catch (err) {
        errorEl.textContent = err.message;
      } finally {
        btn.disabled = false;
        btnText.textContent = isLogin ? 'Sign In' : 'Create Account';
      }
    });
  }

  function logout() {
    token = null;
    currentUser = null;
    settings = null;
    localStorage.removeItem('eink_token');
    $('#auth-screen').classList.remove('hidden');
    $('#app').classList.add('hidden');
    $('#auth-email').value = '';
    $('#auth-password').value = '';
    $('#auth-error').textContent = '';
  }

  function showApp() {
    $('#auth-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    loadSettings();
  }

  // ═════════════════════════════════════════════════════════════════════════
  // NAVIGATION
  // ═════════════════════════════════════════════════════════════════════════

  const PAGE_TITLES = {
    dashboard: 'Dashboard',
    display: 'Display',
    settings: 'Settings',
  };

  function setupNavigation() {
    $$('.nav-item[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        $$('.nav-item[data-page]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        $$('.page').forEach((p) => p.classList.remove('active'));
        $(`#page-${page}`).classList.add('active');
        $('#page-title').textContent = PAGE_TITLES[page] || page;
      });
    });

    $('#btn-logout').addEventListener('click', logout);
    if ($('#btn-logout-settings')) {
      $('#btn-logout-settings').addEventListener('click', logout);
    }

    // Clear log button
    $('#btn-clear-log')?.addEventListener('click', () => {
      logEntries.length = 0;
      renderLog();
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SETTINGS LOAD / APPLY
  // ═════════════════════════════════════════════════════════════════════════

  async function loadSettings() {
    try {
      const data = await API.getSettings();
      settings = data.settings;
      currentUser = { ...currentUser, deviceKey: data.deviceKey, lastDeviceContact: data.lastDeviceContact };
      applySettingsToUI();
      addLog('Settings loaded', 'info');
    } catch (err) {
      addLog('Failed to load settings: ' + err.message, 'error');
    }
  }

  function applySettingsToUI() {
    if (!settings) return;

    // Dashboard
    updateDashboard();

    // Display mode cards
    $$('.mode-card').forEach((c) => {
      c.classList.toggle('active', parseInt(c.dataset.mode) === settings.displayMode);
    });

    // View type
    $$('.radio-card[data-view]').forEach((c) => {
      c.classList.toggle('active', c.dataset.view === settings.viewType);
    });

    // Custom content visibility
    updateCustomContentVisibility();

    // Custom quote
    if ($('#custom-quote')) {
      $('#custom-quote').value = settings.customQuote || '';
      updateQuoteCount();
    }

    // Duration
    if ($('#duration-slider')) {
      $('#duration-slider').value = settings.duration;
      $('#duration-val').textContent = settings.duration + 's';
    }

    // AI Settings
    if (settings.aiSettings) {
      renderTags('quote-type-tags', settings.aiSettings.quoteTypes || []);
      renderTags('anime-tags', settings.aiSettings.animeList || []);

      if ($('#temp-slider')) {
        const tempVal = Math.round((settings.aiSettings.temperature || 1.0) * 10);
        $('#temp-slider').value = tempVal;
        $('#temp-val').textContent = (tempVal / 10).toFixed(1);
      }

      if ($('#image-style')) {
        $('#image-style').value = settings.aiSettings.imageStyle || 'anime';
      }
    }

    // WiFi
    if ($('#wifi-ssid')) $('#wifi-ssid').value = settings.wifi?.ssid || '';
    if ($('#wifi-pass')) $('#wifi-pass').value = settings.wifi?.password || '';

    // Device key
    if ($('#device-key-display')) {
      $('#device-key-display').textContent = currentUser?.deviceKey || '—';
    }

    // Account email
    if ($('#account-email')) {
      $('#account-email').textContent = currentUser?.email || '—';
    }

    // WiFi indicator
    updateWifiIndicator();

    // Load preview
    loadPreview();
  }

  function updateDashboard() {
    if (!settings) return;

    const modeNames = ['Full Auto', 'Quote Custom', 'Both Custom'];
    const viewNames = { both: 'Both', image: 'Image Only', quote: 'Quote Only' };

    $('#dash-mode').textContent = modeNames[settings.displayMode] || '—';
    $('#dash-duration').textContent =
      settings.displayMode === 0 ? `Every ${settings.duration}s` : 'Static';
    $('#dash-view').textContent = viewNames[settings.viewType] || '—';

    // Connection status (BLE takes priority)
    if (bleConnected) {
      $('#dash-connection').textContent = bleDevice?.name || 'Connected';
      $('#dash-connection').style.color = 'var(--success)';
    } else if (currentUser?.lastDeviceContact) {
      const last = new Date(currentUser.lastDeviceContact);
      const diff = Date.now() - last.getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 5) {
        $('#dash-connection').textContent = 'Online (API)';
        $('#dash-connection').style.color = 'var(--success)';
      } else {
        $('#dash-connection').textContent = `${mins}m ago`;
        $('#dash-connection').style.color = 'var(--warning)';
      }
    } else {
      $('#dash-connection').textContent = 'Disconnected';
      $('#dash-connection').style.color = 'var(--text-muted)';
    }
  }

  function updateWifiIndicator() {
    // WiFi status tracking - no UI pill needed
    if (currentUser?.lastDeviceContact) {
      const diff = Date.now() - new Date(currentUser.lastDeviceContact).getTime();
      if (diff < 5 * 60 * 1000) {
        wifiOk = true;
        return;
      }
    }
    wifiOk = false;
  }

  function updateCustomContentVisibility() {
    const card = $('#custom-content-card');
    const imgSection = $('#custom-image-section');
    if (!card || !settings) return;

    if (settings.displayMode === 0) {
      card.style.display = 'none';
    } else {
      card.style.display = 'block';
      imgSection.style.display = settings.displayMode === 2 ? 'block' : 'none';
    }
  }

  async function loadPreview() {
    try {
      const blob = await API.getPreview();
      const url = URL.createObjectURL(blob);
      const img = $('#dash-preview');
      img.src = url;
      img.onload = () => {
        $('#dash-preview-empty')?.classList.add('hidden');
      };
    } catch {
      // No preview available
    }

    // Load last quote
    if (settings?.customQuote && settings.displayMode !== 0) {
      $('#dash-quote').textContent = `"${settings.customQuote}"`;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // TAG INPUT SYSTEM
  // ═════════════════════════════════════════════════════════════════════════

  function renderTags(containerId, tags) {
    const container = $(`#${containerId}`);
    if (!container) return;

    container.innerHTML = tags
      .map(
        (tag) =>
          `<span class="tag">${escHtml(tag)}<button class="tag-remove" data-tag="${escHtml(tag)}" title="Remove">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button></span>`,
      )
      .join('');

    // Attach remove handlers
    container.querySelectorAll('.tag-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tagToRemove = btn.dataset.tag;
        const updated = tags.filter((t) => t !== tagToRemove);
        renderTags(containerId, updated);
      });
    });
  }

  function getTagsFromContainer(containerId) {
    const container = $(`#${containerId}`);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.tag')).map((el) =>
      el.childNodes[0].textContent.trim(),
    );
  }

  function addTag(containerId, inputId) {
    const input = $(`#${inputId}`);
    const value = input.value.trim();
    if (!value) return;

    const currentTags = getTagsFromContainer(containerId);
    // Support comma-separated input
    const newTags = value
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t && !currentTags.includes(t));

    if (newTags.length > 0) {
      renderTags(containerId, [...currentTags, ...newTags]);
    }
    input.value = '';
  }

  // ═════════════════════════════════════════════════════════════════════════
  // DISPLAY PAGE HANDLERS
  // ═════════════════════════════════════════════════════════════════════════

  function setupDisplay() {
    // Mode selection
    $$('.mode-card').forEach((card) => {
      card.addEventListener('click', async () => {
        const mode = parseInt(card.dataset.mode);
        $$('.mode-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        settings.displayMode = mode;
        updateCustomContentVisibility();
        updateDashboard();

        try {
          await API.updateSettings({ displayMode: mode });
          toast('Display mode updated', 'success');
          addLog(`Mode changed to ${['Full Auto', 'Quote Custom', 'Both Custom'][mode]}`, 'info');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });

    // View type selection
    $$('.radio-card[data-view]').forEach((card) => {
      card.addEventListener('click', async () => {
        const view = card.dataset.view;
        $$('.radio-card[data-view]').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        settings.viewType = view;
        updateDashboard();

        try {
          await API.updateSettings({ viewType: view });
          toast('View type updated', 'success');
          addLog(`View type changed to ${view}`, 'info');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });

    // Custom quote character count
    const quoteTextarea = $('#custom-quote');
    if (quoteTextarea) {
      quoteTextarea.addEventListener('input', updateQuoteCount);
    }

    // Save custom content
    $('#btn-save-content')?.addEventListener('click', async () => {
      const btn = $('#btn-save-content');
      btn.disabled = true;

      try {
        const data = { customQuote: $('#custom-quote').value.trim() };
        await API.updateSettings(data);
        settings.customQuote = data.customQuote;
        toast('Custom content saved', 'success');
        addLog('Custom content updated', 'info');
        updateDashboard();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });

    // Image upload
    setupImageUpload();
  }

  function updateQuoteCount() {
    const el = $('#custom-quote-count');
    const textarea = $('#custom-quote');
    if (el && textarea) {
      el.textContent = textarea.value.length;
    }
  }

  function setupImageUpload() {
    const zone = $('#upload-zone');
    const input = $('#upload-input');
    const preview = $('#upload-preview');
    const img = $('#upload-img');
    const removeBtn = $('#upload-remove');

    if (!zone) return;

    zone.addEventListener('click', () => input.click());

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleImageFile(e.dataTransfer.files[0]);
    });

    input.addEventListener('change', () => {
      if (input.files.length) handleImageFile(input.files[0]);
    });

    removeBtn?.addEventListener('click', async () => {
      preview.style.display = 'none';
      zone.style.display = 'flex';
      img.src = '';
      try {
        await API.updateSettings({ customImage: '' });
        toast('Image removed', 'info');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function handleImageFile(file) {
    if (!file.type.startsWith('image/')) {
      toast('Please select an image file', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result;
      const img = $('#upload-img');
      img.src = base64;
      $('#upload-preview').style.display = 'block';
      $('#upload-zone').style.display = 'none';

      try {
        await API.uploadImage(base64);
        toast('Image uploaded successfully', 'success');
        addLog('Custom image uploaded', 'info');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    reader.readAsDataURL(file);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SETTINGS PAGE HANDLERS
  // ═════════════════════════════════════════════════════════════════════════

  function setupSettings() {
    // Duration slider
    const durationSlider = $('#duration-slider');
    if (durationSlider) {
      durationSlider.addEventListener('input', () => {
        $('#duration-val').textContent = durationSlider.value + 's';
      });
    }

    $('#btn-apply-duration')?.addEventListener('click', async () => {
      const duration = parseInt($('#duration-slider').value);
      try {
        await API.updateSettings({ duration });
        settings.duration = duration;
        toast('Duration updated', 'success');
        addLog(`Refresh duration set to ${duration}s`, 'info');
        updateDashboard();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    // Temperature slider
    const tempSlider = $('#temp-slider');
    if (tempSlider) {
      tempSlider.addEventListener('input', () => {
        $('#temp-val').textContent = (tempSlider.value / 10).toFixed(1);
      });
    }

    // Tag inputs
    $('#btn-add-quote-type')?.addEventListener('click', () => {
      addTag('quote-type-tags', 'quote-type-input');
    });

    $('#quote-type-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag('quote-type-tags', 'quote-type-input');
      }
    });

    $('#btn-add-anime')?.addEventListener('click', () => {
      addTag('anime-tags', 'anime-input');
    });

    $('#anime-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag('anime-tags', 'anime-input');
      }
    });

    // Save AI settings
    $('#btn-save-ai')?.addEventListener('click', async () => {
      const btn = $('#btn-save-ai');
      btn.disabled = true;

      try {
        const data = {
          aiSettings: {
            quoteTypes: getTagsFromContainer('quote-type-tags'),
            animeList: getTagsFromContainer('anime-tags'),
            temperature: parseInt($('#temp-slider').value) / 10,
            imageStyle: $('#image-style').value,
          },
        };
        await API.updateSettings(data);
        if (settings) settings.aiSettings = data.aiSettings;
        toast('AI settings saved', 'success');
        addLog('AI settings updated', 'info');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });

    // WiFi save
    $('#btn-save-wifi')?.addEventListener('click', async () => {
      const ssid = $('#wifi-ssid').value.trim();
      const pass = $('#wifi-pass').value;

      try {
        // Save to cloud
        const data = { wifi: { ssid, password: pass } };
        await API.updateSettings(data);
        toast('WiFi settings saved to cloud', 'success');
        addLog('WiFi configuration saved', 'info');

        // Also push to device via BLE if connected
        if (bleConnected) {
          const deviceKey = currentUser?.deviceKey || '';
          const combined = `${API_BASE}|${deviceKey}`;
          await bleSaveWifi(ssid, pass, combined);
        } else {
          toast('Connect via BT to push WiFi config to device', 'info');
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    // Device key copy
    $('#btn-copy-key')?.addEventListener('click', () => {
      const key = $('#device-key-display').textContent;
      if (key && key !== '—') {
        navigator.clipboard.writeText(key).then(
          () => toast('Device key copied!', 'success'),
          () => toast('Failed to copy', 'error'),
        );
      }
    });

    // Regenerate device key
    $('#btn-regen-key')?.addEventListener('click', async () => {
      if (!confirm('Regenerate device key? Your ESP32 will need to be updated.')) return;
      try {
        const data = await API.updateSettings({ regenerateKey: true });
        if (currentUser) currentUser.deviceKey = data.deviceKey;
        $('#device-key-display').textContent = data.deviceKey;
        toast('Device key regenerated', 'success');
        addLog('Device key regenerated — update your ESP32', 'info');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // DASHBOARD HANDLERS
  // ═════════════════════════════════════════════════════════════════════════

  function setupDashboard() {
    $('#btn-refresh-preview')?.addEventListener('click', async () => {
      const btn = $('#btn-refresh-preview');
      btn.disabled = true;
      btn.innerHTML =
        '<div class="spinner"></div> Generating...';

      try {
        // Trigger a new quote to ensure content exists
        const quote = await API.getQuote();
        addLog('Generated: ' + quote, '');

        // Also tell the device to refresh via BLE if connected
        if (bleConnected) {
          await bleSendCmd('REFRESH');
        }

        // Try to load preview
        await new Promise((r) => setTimeout(r, 1000));
        await loadPreview();

        if (quote) {
          $('#dash-quote').textContent = `"${quote}"`;
        }

        toast('Preview refreshed', 'success');
      } catch (err) {
        addLog('Preview error: ' + err.message, 'error');
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 4v6h-6M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg> Refresh Preview`;
      }
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═════════════════════════════════════════════════════════════════════════

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═════════════════════════════════════════════════════════════════════════

  async function init() {
    setupAuth();
    setupNavigation();
    setupDisplay();
    setupSettings();
    setupDashboard();

    // Clock
    updateClock();
    setInterval(updateClock, 30000);

    // Auto-login if token exists
    if (token) {
      try {
        const data = await API.me();
        currentUser = data.user;
        settings = data.user.settings;
        showApp();
      } catch {
        logout();
      }
    }

    // Periodic dashboard refresh (every 30 seconds)
    setInterval(() => {
      if (settings) {
        updateWifiIndicator();
        updateDashboard();
      }
    }, 30000);
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
