/**
 * Sekretar — Main Process
 * Адаптировано из SpeakFlow v1.3.93
 * Изменения: убраны Sentry, Yandex OAuth, подписки → добавлен Groq API (groqService)
 */

const { app, powerMonitor, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let initMain;
try {
  ({ initMain } = require('electron-audio-loopback'));
} catch { initMain = () => {}; }

const electronStoreModule = require('electron-store');
const Store = electronStoreModule.default || electronStoreModule;
require('dotenv').config();

const fileLogger = require('./utils/fileLogger');
fileLogger.attachToConsole();

// ============ PERFORMANCE OPTIMIZATIONS ============
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('disable-extensions');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-translate');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('no-first-run');
app.disableHardwareAcceleration();

if (process.platform === 'win32') {
  app.setAppUserModelId('com.sekretar.app');
}

// ============ MODULES ============
const WindowManager = require('./modules/windowManager');
const HotkeysManager = require('./modules/hotkeys');
const { registerIpcHandlers } = require('./modules/ipc');
const { registerTranslatorHandlers } = require('./modules/translatorHandlers');
const { setupHotkeysCallbacks, setupMeetingDetectorCallbacks, setupSystemEventHandlers } = require('./modules/appEventHandlers');

const secureStore = require('./secureStore');
const groqService = require('./groqService');
const audioCacheManager = require('./audioCacheManager');
const { AutoUpdaterManager } = require('./modules/autoUpdater');

// Инициализируем groqService с secureStore
groqService.init(secureStore);

// ============ ENVIRONMENT ============
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ============ CONFIG RECOVERY ============
try {
  const { recoverConfigs } = require('./utils/configRecovery');
  const recovery = recoverConfigs(app.getPath('userData'));
  if (Object.values(recovery).some(v => String(v).startsWith('recovered'))) {
    console.log('[Store] config recovery from backup:', JSON.stringify(recovery));
  }
} catch (e) {
  console.error('[Store] config recovery guard failed:', e);
}

let persistentStore = new Store({ clearInvalidConfig: true });
let autoUpdater = null;
let windowManager = null;
let hotkeysManager = null;

// ============ LAZY SERVICES ============
let _overlay = null;

function getOverlay() {
  if (!_overlay) {
    console.log('[Lazy] Creating RecordingOverlay');
    const RecordingOverlay = require('./overlay');
    _overlay = new RecordingOverlay();
    _overlay.create();
  }
  return _overlay;
}

// ============ PROTOCOL HANDLER REGISTRATION ============
if (process.platform === 'win32') {
  if (isDev) {
    app.setAsDefaultProtocolClient('peroblitz', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('peroblitz');
  }
}

// ============ SINGLE INSTANCE LOCK ============
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  try { require('tree-kill')(process.pid); } catch {}
  setTimeout(() => app.exit(0), 500);
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (windowManager) {
      windowManager.showWindow();
      const mw = windowManager.getMainWindow();
      if (mw) { if (mw.isMinimized()) mw.restore(); mw.focus(); }
    }
    const url = commandLine.find(arg => arg.startsWith('peroblitz://'));
    if (url) handleDeepLink(url);
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

// ============ DEEP LINK HANDLER ============
let rendererReadyForDeepLinks = false;
const pendingDeepLinks = [];

function deliverDeepLink(channel, payload) {
  if (windowManager) {
    windowManager.showWindow();
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && rendererReadyForDeepLinks) {
      mainWindow.webContents.send(channel, payload);
      return;
    }
  }
  pendingDeepLinks.push({ channel, payload });
}

ipcMain.on('renderer-ready-for-deeplinks', () => {
  rendererReadyForDeepLinks = true;
  if (windowManager) {
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow) {
      while (pendingDeepLinks.length > 0) {
        const { channel, payload } = pendingDeepLinks.shift();
        mainWindow.webContents.send(channel, payload);
      }
    }
  }
});

function handleDeepLink(url) {
  try {
    const parsedUrl = new URL(url);
    const route = parsedUrl.hostname || parsedUrl.pathname.replace(/^\//, '');

    if (route === 'auth') {
      const token = parsedUrl.searchParams.get('token');
      if (token) deliverDeepLink('auth-from-deeplink', token);
    }
  } catch (error) {
    console.error('[DeepLink] Failed to parse deep link');
  }
}

// ============ IPC HANDLERS ============
function registerMainHandlers() {
  // Триальный период
  ipcMain.handle('trial:get', async () => {
    return secureStore.getTrialSeconds();
  });
  
  ipcMain.handle('trial:deduct', async (_e, seconds) => {
    return secureStore.deductTrialSeconds(seconds);
  });

  // Сохранить API ключ
  ipcMain.handle('groq:set-api-key', async (_e, key) => {
    try {
      const result = await groqService.validateApiKey(key);
      if (result.valid) {
        groqService.setApiKey(key);
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Получить статус
  ipcMain.handle('groq:get-status', async () => {
    const hasKey = secureStore.hasGroqApiKey();
    const key = secureStore.getGroqApiKey();
    return {
      hasKey,
      keyPreview: key ? `${key.substring(0, 8)}...${key.slice(-4)}` : null,
    };
  });

  // Транскрипция (вызывается из renderer после записи)
  ipcMain.handle('groq:transcribe', async (_e, audioBuffer, options = {}) => {
    try {
      const buffer = Buffer.from(audioBuffer);
      const settings = secureStore.getSettings();
      const lang = settings.language || 'ru';
      const actualLang = lang === 'auto' ? null : lang;
      
      const result = await groqService.transcribeAudio(buffer, actualLang);
      let text = result.text || '';

      const shouldCleanup = options.cleanup !== undefined ? options.cleanup : settings.aiCleanup;
      const useParagraphs = settings.useParagraphs || false;

      // AI-очистка если включена
      if (shouldCleanup && text.trim()) {
        try {
          text = await groqService.cleanupText(text, useParagraphs);
        } catch (cleanErr) {
          console.warn('[API] Cleanup failed, using raw text:', cleanErr.message);
        }
      }

      return { success: true, text };
    } catch (err) {
      console.error('[API] Transcription error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Перевод
  ipcMain.handle('groq:translate', async (_e, text, targetLang) => {
    try {
      const translated = await groqService.translateText(text, targetLang);
      return { success: true, text: translated };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Настройки
  ipcMain.handle('settings:get', async () => {
    return secureStore.getSettings();
  });
  ipcMain.handle('settings:save', async (_e, settings) => {
    secureStore.saveSettings(settings);
    return { success: true };
  });
  ipcMain.handle('settings:set', async (_e, key, value) => {
    secureStore.saveSetting(key, value);
    if (key === 'autostart') {
      app.setLoginItemSettings({
        openAtLogin: value,
        path: process.execPath,
      });
    }
    return { success: true };
  });

  // Проверка соединения с Groq (напрямую или через прокси)
  ipcMain.handle('network:test-connection', async () => {
    try {
      return await groqService.testConnection();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // === SECURE STORE ===
  ipcMain.handle('secure-store:save-tokens', async (_e, accessToken, refreshToken) => {
    try {
      secureStore.saveTokens(accessToken, refreshToken);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('secure-store:get-tokens', async () => secureStore.getTokens());
  ipcMain.handle('secure-store:save-user', async (_e, userData) => {
    try {
      secureStore.saveUser(userData);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('secure-store:get-user', async () => secureStore.getUser());
  ipcMain.handle('secure-store:is-authenticated', async () => secureStore.isAuthenticated());
  ipcMain.handle('secure-store:clear', async () => secureStore.clearAll());
}

// ============ APP READY ============
app.whenReady().then(async () => {
  try { fileLogger.configureLogger(); } catch {}

  console.log('[Main] Sekretar starting...');
  const startTime = Date.now();

  // Path diagnostics
  try {
    const criticalPaths = {
      userData: app.getPath('userData'),
      temp: app.getPath('temp'),
      appPath: app.getAppPath(),
      execPath: process.execPath,
    };
    console.log('[Paths] System paths:', JSON.stringify(criticalPaths, null, 2));
  } catch {}

  // Init audio loopback
  try { initMain(); } catch {}

  // Register Main IPC handlers (раньше всего остального)
  registerMainHandlers();

  // IPC log bridge
  ipcMain.handle('log-from-renderer', (_event, level, message, context) => {
    try {
      const validLevels = ['error', 'warn', 'info', 'verbose', 'debug', 'silly'];
      const safeLevel = validLevels.includes(level) ? level : 'info';
      fileLogger.log[safeLevel](`[Renderer] ${message}`, context);
    } catch {}
  });

  ipcMain.handle('open-logs-folder', async () => {
    try {
      const { shell } = require('electron');
      await shell.openPath(path.join(app.getPath('userData'), 'logs'));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Handle deep link on first launch (Windows)
  if (process.platform === 'win32') {
    const deepLinkUrl = process.argv.find(arg => arg.startsWith('peroblitz://'));
    if (deepLinkUrl) handleDeepLink(deepLinkUrl);
  }

  // ============ WindowManager ============
  try {
    console.log('[Main] Creating WindowManager...');
    windowManager = new WindowManager(isDev, null); // null вместо Sentry
    console.log('[Main] WindowManager created successfully');
  } catch (error) {
    console.error('[Main] CRITICAL: Failed to create WindowManager:', error);
    throw error;
  }

  try {
    console.log('[Main] Creating HotkeysManager...');
    hotkeysManager = new HotkeysManager();
    console.log('[Main] HotkeysManager created successfully');
  } catch (error) {
    console.error('[Main] Failed to create HotkeysManager:', error);
  }

  let mainWindow = null;
  try {
    console.log('[Main] Creating main window...');
    mainWindow = windowManager.createWindow();
    console.log('[Main] Main window created successfully');

    console.log('[Main] Creating tray...');
    windowManager.createTray();
    console.log('[Main] Tray created successfully');
  } catch (error) {
    console.error('[Main] CRITICAL: Failed to create window/tray:', error);
    throw error;
  }

  // RecordingOverlay
  let overlay = null;
  try {
    console.log('[Main] Creating RecordingOverlay...');
    overlay = getOverlay();
    console.log('[Main] RecordingOverlay created successfully');
  } catch (error) {
    console.error('[Main] Failed to create RecordingOverlay:', error);
  }


  // Hotkeys
  try {
    console.log('[Main] Setting up hotkeys callbacks...');
    const settings = secureStore.getSettings();
    hotkeysManager.loadSettings({
      recording: settings.hotkey,
      mode: settings.hotkeyMode,
      translation: settings.translateHotkey,
      undo: settings.undoHotkey,
      meeting: settings.meetingHotkey,
      tabComplete: settings.hotkey,
      unifiedMemory: settings.memoryHotkey,
    });
    setupHotkeysCallbacks(hotkeysManager, windowManager, {
      getOverlay,
      audioCacheManager,
    });
    console.log('[Main] Hotkeys callbacks configured');
    hotkeysManager.initialize();
    console.log('[Main] Hotkeys initialized successfully');
  } catch (error) {
    console.error('[Main] Failed to setup hotkeys:', error);
  }

  // Register all IPC handlers
  try {
    registerIpcHandlers({
      windowManager,
      hotkeysManager,
      audioCacheManager,
      getOverlay,
      persistentStore,
      secureStore,
      getAutoUpdater: () => autoUpdater,
      isDev,
    });
    console.log('[IPC] All handlers registered (modular)');
  } catch (error) {
    console.error('[Main] Failed to register IPC handlers:', error);
  }


  // System events
  try {
    setupSystemEventHandlers(app, powerMonitor, windowManager, hotkeysManager);
    console.log('[EventHandlers] System event handlers configured');
  } catch (error) {
    console.error('[Main] Failed to setup system events:', error);
  }

  // Auto-updater (non-blocking, every 3h)
  try {
    autoUpdater = new AutoUpdaterManager(windowManager);
    const savedSettings = secureStore.getSettings();
    if (savedSettings && savedSettings.updateUrl) {
      autoUpdater.setFeed(savedSettings.updateUrl);
    }
    setTimeout(() => {
      autoUpdater.checkForUpdates();
    }, 10000);
    setInterval(() => {
      autoUpdater.checkForUpdates();
    }, 3 * 60 * 60 * 1000);
  } catch (err) {
    console.warn('[Main] AutoUpdater init warning:', err.message);
  }


  console.log(`[Main] Initialization complete in ${Date.now() - startTime}ms`);
});

// ============ APP EVENTS ============
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (windowManager) windowManager.showWindow();
});
app.on('before-quit', () => {
});
