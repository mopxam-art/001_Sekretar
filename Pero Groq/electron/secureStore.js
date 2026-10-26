/**
 * SecureStore — локальное защищенное хранилище настроек и API-ключей Pero Blitz PRO.
 * Хранит Groq API ключ с шифрованием AES-256 на основе параметров локальной машины.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

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

// Надежный детерминированный ключ шифрования (без внешних команд, устойчив в Electron и Node)
function generateEncryptionKey() {
  try {
    const raw = [
      process.env.COMPUTERNAME || os.hostname(),
      process.env.USERNAME || (os.userInfo && os.userInfo().username) || 'pero_user',
      os.platform(),
      'Sekretar-2026-Secure-Storage'
    ].join(':');
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
  } catch {
    return 'sekretar-fallback-key-2026-dev!!';
  }
}

// Единый детерминированный путь к директории конфигурации pero-blitz-pro
function getResolvedCwd() {
  const base = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
  return path.join(base, 'pero-blitz-pro');
}

const resolvedCwd = getResolvedCwd();
try {
  if (!fs.existsSync(resolvedCwd)) {
    fs.mkdirSync(resolvedCwd, { recursive: true });
  }
} catch (e) {
  console.warn('[SecureStore] Failed to ensure cwd exists:', e.message);
}

const store = new Store({
  name: 'pero-blitz-pro-config',
  configName: 'pero-blitz-pro-config',
  cwd: resolvedCwd,
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
    groqApiKey: { type: 'string' },
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
        useProxy: { type: 'boolean' },
        updateUrl: { type: 'string' },
        manualTypingSpeed: { type: 'number' },
      }
    }
  },
  defaults: {
    groqApiKey: '',
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
      proxyBaseUrl: 'https://api.groq.com',
      useProxy: true,
      httpProxy: 'http://100.86.75.16:8888',
      updateUrl: '',
      manualTypingSpeed: 45,
    }
  }
});

// Device fingerprinting с безопасным fallback
function getDeviceFingerprint() {
  let machineId = 'default-machine-id';
  try {
    const { machineIdSync } = require('node-machine-id');
    machineId = machineIdSync(true);
  } catch {
    machineId = process.env.COMPUTERNAME || os.hostname();
  }

  const fingerprint = {
    machineId,
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMemory: Math.floor(os.totalmem() / 1024 / 1024 / 1024),
    hostname: crypto.createHash('sha256').update(os.hostname()).digest('hex'),
    username: crypto.createHash('sha256').update((os.userInfo && os.userInfo().username) || 'user').digest('hex')
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
  proxyBaseUrl: 'https://api.groq.com',
  useProxy: true,
  httpProxy: 'http://100.86.75.16:8888',
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

  // === GROQ API KEY ===
  saveGroqApiKey(key) {
    if (!key || typeof key !== 'string') {
      store.set('groqApiKey', '');
      return;
    }
    const cleanKey = key.trim();
    store.set('groqApiKey', cleanKey);
    console.log('[SecureStore] Groq API key saved successfully');
  },

  getGroqApiKey() {
    const key = store.get('groqApiKey', null);
    if (!key || typeof key !== 'string') return null;
    const clean = key.trim();
    if (clean === '' || clean === 'gsk_YOUR_GROQ_API_KEY_HERE') return null;
    return clean;
  },

  hasGroqApiKey() {
    const key = this.getGroqApiKey();
    return !!(key && key.startsWith('gsk_'));
  },

  // === SETTINGS ===
  getSettings() {
    const saved = store.get('settings', {});
    const merged = { ...DEFAULTS, ...saved };

    if (merged.useProxy === false) {
      merged.httpProxy = '';
    } else {
      if (!merged.httpProxy || merged.httpProxy.trim() === '') {
        merged.httpProxy = process.env.GROQ_PROXY || 'http://100.86.75.16:8888';
      }
    }

    if (!merged.proxyBaseUrl || merged.proxyBaseUrl.trim() === '') {
      merged.proxyBaseUrl = process.env.GROQ_BASE_URL || 'https://api.groq.com';
    }

    return merged;
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
    try {
      if (!verifyDevice()) return false;
      const tokens = store.get('tokens');
      return !!(tokens && tokens.accessToken);
    } catch {
      return false;
    }
  },

  clearAll() { store.clear(); },
  getStorePath() { return store.path; },
  getFingerprint() {
    return getDeviceFingerprint();
  }
};

module.exports = secureStore;
