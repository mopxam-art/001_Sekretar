/**
 * SecureStore — хранилище настроек Sekretar
 * Упрощённая версия SpeakFlow secureStore — только Groq API ключ
 */

let Store;
try {
  Store = require('electron-store');
  if (Store.default) Store = Store.default;
} catch {
  Store = class FallbackStore {
    constructor(o) { this.data = {}; }
    get(k, d) {
      const v = k.split('.').reduce((a, b) => a?.[b], this.data);
      return v !== undefined ? v : d;
    }
    set(k, v) {
      const keys = k.split('.');
      let o = this.data;
      for (let i = 0; i < keys.length - 1; i++) { if (!o[keys[i]]) o[keys[i]] = {}; o = o[keys[i]]; }
      o[keys[keys.length - 1]] = v;
    }
    clear() { this.data = {}; }
    delete(k) { const keys = k.split('.'); let o = this.data; for (let i = 0; i < keys.length - 1; i++) o = o?.[keys[i]]; if (o) delete o[keys[keys.length-1]]; }
  };
}

const crypto = require('crypto');
const { machineIdSync } = require('node-machine-id');

function generateEncryptionKey() {
  try {
    const machineId = machineIdSync(true);
    const secret = 'Sekretar-2026-Secure-Storage';
    return crypto.createHash('sha256').update(machineId + secret).digest('hex').substring(0, 32);
  } catch {
    return 'sekretar-fallback-key-2026-dev!!';
  }
}

const store = new Store({
  name: 'pero-blitz-config',
  clearInvalidConfig: true,
  schema: {
    groqApiKey: { type: 'string' },
    settings: {
      type: 'object',
      properties: {
        hotkey: { type: 'string' },
        hotkeyMode: { type: 'string', enum: ['hold', 'toggle'] },
        language: { type: 'string' },
        aiCleanup: { type: 'boolean' },
        useParagraphs: { type: 'boolean' },
        audioDucking: { type: 'boolean' },
        overlayVisible: { type: 'boolean' },
        autostart: { type: 'boolean' },
        meetingDetector: { type: 'boolean' },
        translateHotkey: { type: 'string' },
        undoHotkey: { type: 'string' },
        meetingHotkey: { type: 'string' },
        memoryHotkey: { type: 'string' },
        proxyBaseUrl: { type: 'string' },
      }
    }
  },
  defaults: {
    groqApiKey: '',
    settings: {
      hotkey: 'CommandOrControl+Alt',
      hotkeyMode: 'hold',
      language: 'ru',
      aiCleanup: true,
      useParagraphs: false,
      audioDucking: true,
      overlayVisible: true,
      autostart: false,
      meetingDetector: false,
      translateHotkey: 'CommandOrControl+Shift+T',
      undoHotkey: 'CommandOrControl+Shift+Z',
      meetingHotkey: 'CommandOrControl+Shift+M',
      memoryHotkey: 'CommandOrControl+Shift+U',
      proxyBaseUrl: '',
    }
  }
});

// Дефолтные настройки (совпадают с SpeakFlow)
const DEFAULTS = {
  hotkey: 'CommandOrControl+Alt',
  hotkeyMode: 'toggle',
  language: 'ru',
  aiCleanup: true,
  useParagraphs: false,
  audioDucking: true,
  overlayVisible: true,
  autostart: false,
  meetingDetector: true,
  translateHotkey: 'CommandOrControl+Shift+T',
  undoHotkey: 'CommandOrControl+Shift+Z',
  meetingHotkey: 'CommandOrControl+Shift+M',
  memoryHotkey: 'CommandOrControl+Shift+U',
  proxyBaseUrl: '',
};

const secureStore = {
  // === GROQ API KEY ===
  saveGroqApiKey(key) {
    store.set('groqApiKey', key);
    console.log('[SecureStore] Groq API key saved');
  },

  getGroqApiKey() {
    return store.get('groqApiKey', null);
  },

  hasGroqApiKey() {
    const key = store.get('groqApiKey', null);
    return !!(key && key.startsWith('gsk_'));
  },

  // === SETTINGS ===
  getSettings() {
    const saved = store.get('settings', {});
    return { ...DEFAULTS, ...saved };
  },

  saveSetting(key, value) {
    store.set(`settings.${key}`, value);
  },

  saveSettings(settings) {
    store.set('settings', { ...this.getSettings(), ...settings });
  },

  // === COMPAT with SpeakFlow callers ===
  // WindowManager and others call these — keep stubs so copied code doesn't crash
  getUser() { return null; },
  saveUser() {},
  getTokens() { return null; },
  saveTokens() {},
  isAuthenticated() { return true; }, // всегда авторизован (BYOK модель)
  clearAll() { store.clear(); },
  getMachineId() {
    try { return machineIdSync(true); } catch { return 'unknown'; }
  },
};

module.exports = secureStore;
