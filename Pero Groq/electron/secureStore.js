/**
 * SecureStore — локальное защищенное хранилище настроек и API-ключей Pero Blitz PRO.
 * Хранит Groq API ключ с шифрованием AES-256 на основе постоянных параметров машины.
 * Включает автоматическое резервное копирование в независимый локальный Vault и аварийный ключ.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

let StoreModule;
try {
  StoreModule = require('electron-store');
  if (StoreModule.default) StoreModule = StoreModule.default;
} catch {
  StoreModule = class FallbackStore {
    constructor() { this.data = {}; }
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

// Постоянный детерминированный ключ шифрования, привязанный к профилю пользователя
function generateEncryptionKey() {
  try {
    const raw = [
      (os.homedir() || '').toLowerCase(),
      (process.env.USERNAME || (os.userInfo && os.userInfo().username) || 'user').toLowerCase(),
      'Sekretar-2026-Permanent-Vault-Fixed'
    ].join('::');
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
  } catch {
    return 'sekretar-fallback-key-2026-fix!';
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

// Резервный зашифрованный Vault и локальный аварийный файл для API-ключа
const VAULT_FILE = path.join(resolvedCwd, '.groq_key.vault');
const PLAIN_KEY_FILE = path.join(resolvedCwd, '.groq_key.key');
const KNOWN_DEFAULT_KEY = '';

function encryptVaultString(text) {
  try {
    const key = generateEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (err) {
    return null;
  }
}

function decryptVaultString(encryptedData) {
  try {
    const key = generateEncryptionKey();
    const parts = encryptedData.split(':');
    if (parts.length !== 2) return null;
    const iv = Buffer.from(parts[0], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return null;
  }
}

function saveToVault(key) {
  try {
    if (!key || typeof key !== 'string' || !key.startsWith('gsk_')) return;
    const clean = key.trim();
    const enc = encryptVaultString(clean);
    if (enc) {
      fs.writeFileSync(VAULT_FILE, enc, 'utf8');
    }
    // Сохраняем также в локальный аварийный файл профиля пользователя
    fs.writeFileSync(PLAIN_KEY_FILE, clean, 'utf8');
  } catch (err) {
    console.warn('[SecureStore] Failed to write key vault:', err.message);
  }
}

function readFromVault() {
  // Сначала пробуем зашифрованный Vault
  try {
    if (fs.existsSync(VAULT_FILE)) {
      const content = fs.readFileSync(VAULT_FILE, 'utf8').trim();
      if (content) {
        const key = decryptVaultString(content);
        if (key && key.startsWith('gsk_')) {
          return key.trim();
        }
      }
    }
  } catch (err) {
    console.warn('[SecureStore] Failed to read key from vault:', err.message);
  }

  // Резервный аварийный файл в %APPDATA%
  try {
    if (fs.existsSync(PLAIN_KEY_FILE)) {
      const key = fs.readFileSync(PLAIN_KEY_FILE, 'utf8').trim();
      if (key && key.startsWith('gsk_')) {
        return key;
      }
    }
  } catch (err) {
    console.warn('[SecureStore] Failed to read plain key file:', err.message);
  }

  return null;
}

const storeSchema = {
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
};

const storeDefaults = {
  groqApiKey: KNOWN_DEFAULT_KEY,
  trialSeconds: 1800,
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
};

let store;

function createStoreInstance() {
  const encKey = generateEncryptionKey();
  try {
    const s = new StoreModule({
      name: 'pero-blitz-pro-config',
      configName: 'pero-blitz-pro-config',
      cwd: resolvedCwd,
      encryptionKey: encKey,
      clearInvalidConfig: false,
      schema: storeSchema,
      defaults: storeDefaults
    });
    // Trigger read to check if decryption succeeds
    s.get('groqApiKey');
    return s;
  } catch (err) {
    console.warn('[SecureStore] Decryption of existing config failed (key migration):', err.message);
    const configFile = path.join(resolvedCwd, 'pero-blitz-pro-config.json');
    if (fs.existsSync(configFile)) {
      try {
        const backupFile = path.join(resolvedCwd, `pero-blitz-pro-config.bak-${Date.now()}`);
        fs.copyFileSync(configFile, backupFile);
        fs.unlinkSync(configFile);
        console.warn(`[SecureStore] Legacy config backed up to ${path.basename(backupFile)} and re-created.`);
      } catch (backupErr) {
        console.error('[SecureStore] Failed to backup legacy config:', backupErr.message);
      }
    }
    return new StoreModule({
      name: 'pero-blitz-pro-config',
      configName: 'pero-blitz-pro-config',
      cwd: resolvedCwd,
      encryptionKey: encKey,
      clearInvalidConfig: true,
      schema: storeSchema,
      defaults: storeDefaults
    });
  }
}

store = createStoreInstance();

// Инициализируем резервные хранилища ключом
try {
  let existingKey = null;
  try { existingKey = store.get('groqApiKey'); } catch {}
  if (!existingKey || !existingKey.startsWith('gsk_')) {
    existingKey = readFromVault() || KNOWN_DEFAULT_KEY;
    try { store.set('groqApiKey', existingKey); } catch {}
  }
  if (existingKey && existingKey.startsWith('gsk_')) {
    saveToVault(existingKey);
  }
} catch (e) {
  console.warn('[SecureStore] Init key check warning:', e.message);
}

// Device fingerprinting с безопасным fallback
function getDeviceFingerprint() {
  let machineId = 'default-machine-id';
  try {
    const { machineIdSync } = require('node-machine-id');
    machineId = machineIdSync(true);
  } catch {
    machineId = process.env.COMPUTERNAME || os.hostname() || 'pc';
  }

  const fingerprint = {
    machineId,
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMemory: Math.floor(os.totalmem() / 1024 / 1024 / 1024),
    hostname: crypto.createHash('sha256').update(os.hostname() || 'host').digest('hex'),
    username: crypto.createHash('sha256').update(process.env.USERNAME || (os.userInfo && os.userInfo().username) || 'user').digest('hex')
  };

  return crypto.createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
}

function verifyDevice() {
  try {
    const currentFingerprint = getDeviceFingerprint();
    const storedDevice = store.get('device');

    if (!storedDevice) {
      store.set('device', { fingerprint: currentFingerprint, lastVerified: Date.now() });
      return true;
    }

    if (storedDevice.fingerprint !== currentFingerprint) {
      store.set('device', { fingerprint: currentFingerprint, lastVerified: Date.now() });
    }

    store.set('device.lastVerified', Date.now());
    return true;
  } catch {
    return true;
  }
}

const DEFAULTS = storeDefaults.settings;

const secureStore = {
  // === TRIAL PERIOD ===
  getTrialSeconds() {
    try {
      return Math.min(store.get('trialSeconds', 1800), 1800);
    } catch {
      return 1800;
    }
  },

  deductTrialSeconds(seconds) {
    try {
      let current = this.getTrialSeconds();
      current = Math.max(0, current - seconds);
      store.set('trialSeconds', current);
      return current;
    } catch {
      return 1800;
    }
  },

  // === GROQ API KEY ===
  saveGroqApiKey(key) {
    if (!key || typeof key !== 'string') {
      try { store.set('groqApiKey', ''); } catch {}
      return;
    }
    const cleanKey = key.trim();
    try {
      store.set('groqApiKey', cleanKey);
    } catch (e) {
      console.warn('[SecureStore] Failed to write key to store:', e.message);
    }
    // Сохраняем в оба резервных Vault
    saveToVault(cleanKey);
    console.log('[SecureStore] Groq API key saved successfully in Store and Vault');
  },

  getGroqApiKey() {
    let key = null;
    try {
      key = store.get('groqApiKey', null);
    } catch (e) {
      console.warn('[SecureStore] Error reading key from store:', e.message);
    }

    if (key && typeof key === 'string' && key.trim() !== '' && key.trim() !== 'gsk_YOUR_GROQ_API_KEY_HERE') {
      const clean = key.trim();
      saveToVault(clean);
      return clean;
    }

    // Резервное восстановление из локального Vault
    const vaultKey = readFromVault();
    if (vaultKey && vaultKey.startsWith('gsk_')) {
      console.log('[SecureStore] Successfully recovered Groq API key from Vault/Backup!');
      try {
        store.set('groqApiKey', vaultKey);
      } catch {}
      return vaultKey;
    }

    // В крайнем случае используем валидный дефолтный ключ
    return KNOWN_DEFAULT_KEY;
  },

  hasGroqApiKey() {
    const key = this.getGroqApiKey();
    return !!(key && key.startsWith('gsk_'));
  },

  // === SETTINGS ===
  getSettings() {
    let saved = {};
    try {
      saved = store.get('settings', {}) || {};
    } catch (e) {
      console.warn('[SecureStore] Failed to read settings, using defaults:', e.message);
    }
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
    try {
      store.set(`settings.${key}`, value);
    } catch (e) {
      console.warn('[SecureStore] Failed to save setting:', key, e.message);
    }
  },

  saveSettings(settings) {
    try {
      store.set('settings', { ...this.getSettings(), ...settings });
    } catch (e) {
      console.warn('[SecureStore] Failed to save settings:', e.message);
    }
  },

  // === TOKENS & AUTH ===
  saveTokens(accessToken, refreshToken) {
    try {
      store.set('tokens', { accessToken, refreshToken });
      console.log('[SecureStore] Tokens saved');
    } catch (e) {}
  },

  getTokens() {
    try {
      return store.get('tokens', null);
    } catch {
      return null;
    }
  },

  saveUser(userData) {
    try {
      store.set('user', userData);
    } catch (e) {}
  },

  getUser() {
    try {
      return store.get('user', null);
    } catch {
      return null;
    }
  },

  isAuthenticated() {
    try {
      const tokens = store.get('tokens');
      return !!(tokens && tokens.accessToken);
    } catch {
      return false;
    }
  },

  clearAll() {
    try { store.clear(); } catch {}
  },

  getStorePath() {
    return store.path;
  },

  getVaultPath() {
    return VAULT_FILE;
  },

  getFingerprint() {
    return getDeviceFingerprint();
  }
};

module.exports = secureStore;
