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
  name: 'pero-blitz-pro-config',
  encryptionKey: generateEncryptionKey(),
  clearInvalidConfig: true,
  schema: {
    tokens: {
      type: 'object',
      properties: {
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' }
      }
    },
    user: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        email: { type: 'string' },
        authenticated: { type: 'boolean' }
      }
    },
    device: {
      type: 'object',
      properties: {
        fingerprint: { type: 'string' },
        lastVerified: { type: 'number' }
      }
    },
    trialSeconds: { type: 'number' },
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
        httpProxy: { type: 'string' },
        manualTypingSpeed: { type: 'number' },
      }
    }
  },
  defaults: {
    trialSeconds: 1800, // 30 minutes
    settings: {
      hotkey: 'CommandOrControl+Alt',
      hotkeyMode: 'toggle',
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
      httpProxy: '',
      manualTypingSpeed: 45,
    }
  }
});

// Device fingerprinting
function getDeviceFingerprint() {
  const os = require('os');
  const machineId = machineIdSync(true);

  const fingerprint = {
    machineId,
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMemory: Math.floor(os.totalmem() / 1024 / 1024 / 1024),
    hostname: crypto.createHash('sha256').update(os.hostname()).digest('hex'),
    username: crypto.createHash('sha256').update(os.userInfo().username).digest('hex')
  };

  return crypto.createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
}

function verifyDevice() {
  const currentFingerprint = getDeviceFingerprint();
  const storedDevice = store.get('device');

  if (!storedDevice) {
    store.set('device', { fingerprint: currentFingerprint, lastVerified: Date.now() });
    return true;
  }

  if (storedDevice.fingerprint !== currentFingerprint) {
    console.warn('[secureStore] Fingerprint changed. Updating without clearing.');
    store.set('device', { fingerprint: currentFingerprint, lastVerified: Date.now() });
  }

  store.set('device.lastVerified', Date.now());
  return true;
}

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
  httpProxy: '',
  manualTypingSpeed: 45,
};

const secureStore = {
  // === TRIAL PERIOD ===
  getTrialSeconds() {
    return Math.min(store.get('trialSeconds', 1800), 1800);
  },

  deductTrialSeconds(seconds) {
    let current = this.getTrialSeconds();
    current = Math.max(0, current - seconds);
    store.set('trialSeconds', current);
    return current;
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

  // === TOKENS & AUTH ===
  saveTokens(accessToken, refreshToken) {
    if (!verifyDevice()) throw new Error('Device verification failed');
    store.set('tokens', { accessToken, refreshToken });
    console.log('[SecureStore] Tokens saved');
  },

  getTokens() {
    if (!verifyDevice()) return null;
    return store.get('tokens');
  },

  saveUser(userData) {
    if (!verifyDevice()) throw new Error('Device verification failed');
    store.set('user', userData);
  },

  getUser() {
    if (!verifyDevice()) return null;
    return store.get('user');
  },

  isAuthenticated() {
    if (!verifyDevice()) return false;
    const tokens = store.get('tokens');
    return !!(tokens && tokens.accessToken);
  },

  clearAll() { store.clear(); },
  getMachineId() {
    try { return machineIdSync(true); } catch { return 'unknown'; }
  },
  getFingerprint() {
    return getDeviceFingerprint();
  }
};

module.exports = secureStore;
