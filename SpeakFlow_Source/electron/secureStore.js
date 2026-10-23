// Check if electron-store is available (might not be in production build)
let Store;
try {
  Store = require('electron-store');
  // Handle both default export and named export
  if (Store.default) {
    Store = Store.default;
  }
} catch (error) {
  // Fallback implementation for when electron-store is not available
  Store = class FallbackStore {
    constructor(options) {
      this.data = {};
      this.name = options?.name || 'config';
    }

    get(key, defaultValue) {
      const keys = key.split('.');
      let value = this.data;
      for (const k of keys) {
        value = value?.[k];
        if (value === undefined) return defaultValue;
      }
      return value;
    }

    set(key, value) {
      const keys = key.split('.');
      let obj = this.data;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) obj[keys[i]] = {};
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
    }

    clear() {
      this.data = {};
    }
  };
}
const crypto = require('crypto');
const { machineIdSync } = require('node-machine-id');

// Generate encryption key based on machine ID and secret
function generateEncryptionKey() {
  const machineId = machineIdSync(true);
  const secret = 'SpeakFlow-2024-Secure-Storage';
  return crypto
    .createHash('sha256')
    .update(machineId + secret)
    .digest('hex')
    .substring(0, 32); // 32 chars for AES-256
}

// Create encrypted store
const store = new Store({
  name: 'secure-config',
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
    totalMemory: Math.floor(os.totalmem() / 1024 / 1024 / 1024), // GB
    hostname: crypto.createHash('sha256').update(os.hostname()).digest('hex'),
    username: crypto.createHash('sha256').update(os.userInfo().username).digest('hex')
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(fingerprint))
    .digest('hex');
}

// Verify device hasn't changed.
// IMPORTANT: с 25 апреля 2026 функция стала log-only. Раньше при mismatch
// вызывался store.clear() — что выкидывало пользователя из приложения при
// любых изменениях железа (апгрейд RAM, замена CPU, переименование hostname).
// Жалобы «то работает то нет» во многом отсюда.
//
// Безопасность сохранена через два отдельных слоя:
// 1. encryptionKey зависит от machineId (см. generateEncryptionKey) — даже
//    если файл скопировать на другую машину, расшифровать его не получится.
// 2. Сервер хранит refreshToken и валидирует deviceId при логине (есть лимит
//    в 3 устройства). Украденный файл без переноса machineId не пройдёт.
//
// При смене fingerprint просто обновляем запись и логируем — это даёт нам
// телеметрию (если такие случаи массовые — увидим в логах).
function verifyDevice() {
  const currentFingerprint = getDeviceFingerprint();
  const storedDevice = store.get('device');

  if (!storedDevice) {
    // First time - save fingerprint
    store.set('device', {
      fingerprint: currentFingerprint,
      lastVerified: Date.now()
    });
    return true;
  }

  if (storedDevice.fingerprint !== currentFingerprint) {
    console.warn(
      '[secureStore.verifyDevice] Fingerprint changed — possibly hardware upgrade or OS update. ' +
      'Updating stored fingerprint without clearing tokens.'
    );
    store.set('device', {
      fingerprint: currentFingerprint,
      lastVerified: Date.now()
    });
    return true;
  }

  // Update last verified time
  store.set('device.lastVerified', Date.now());
  return true;
}

// API for main process
const secureStore = {
  // Save tokens securely
  saveTokens(accessToken, refreshToken) {
    console.log('🔐 secureStore.saveTokens: CALLED');
    console.log('🔐 Device verification...');

    if (!verifyDevice()) {
      console.error('❌ secureStore.saveTokens: Device verification FAILED');
      throw new Error('Device verification failed');
    }

    console.log('✅ Device verified successfully');
    console.log('💾 Saving tokens to encrypted store...');

    store.set('tokens', {
      accessToken: accessToken,
      refreshToken: refreshToken
    });

    console.log('✅ secureStore.saveTokens: Tokens saved!');
  },

  // Get tokens
  getTokens() {
    console.log('🔐 secureStore.getTokens: CALLED');

    if (!verifyDevice()) {
      console.error('❌ secureStore.getTokens: Device verification FAILED');
      return null;
    }

    const tokens = store.get('tokens');
    console.log('🔐 secureStore.getTokens: Retrieved tokens:', tokens ? 'YES' : 'NO');

    return tokens;
  },

  // Save user data
  saveUser(userData) {
    if (!verifyDevice()) {
      throw new Error('Device verification failed');
    }

    store.set('user', userData);
  },

  // Get user data
  getUser() {
    if (!verifyDevice()) {
      return null;
    }

    return store.get('user');
  },

  // Check if authenticated
  isAuthenticated() {
    if (!verifyDevice()) {
      return false;
    }

    const user = store.get('user');
    const tokens = store.get('tokens');

    return !!(user?.authenticated && tokens?.accessToken);
  },

  // Clear all data (logout)
  clearAll() {
    store.clear();
  },

  // Get device fingerprint
  getFingerprint() {
    return getDeviceFingerprint();
  },

  // Get machine ID
  getMachineId() {
    return machineIdSync(true);
  }
};

module.exports = secureStore;