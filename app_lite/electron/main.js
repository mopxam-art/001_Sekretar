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

// ============ SINGLE INSTANCE LOCK ============
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  try { require('tree-kill')(process.pid); } catch {}
  setTimeout(() => app.exit(0), 500);
} else {
  app.on('second-instance', () => {
    if (windowManager) {
      windowManager.showWindow();
      const mw = windowManager.getMainWindow();
      if (mw) { if (mw.isMinimized()) mw.restore(); mw.focus(); }
    }
  });
}

// ============ GROQ IPC HANDLERS ============
function registerGroqHandlers() {
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
      const result = await groqService.transcribeAudio(buffer, options.language || 'ru');
      let text = result.text || '';

      const settings = secureStore.getSettings();
      const shouldCleanup = options.cleanup !== undefined ? options.cleanup : settings.aiCleanup;
      const useParagraphs = settings.useParagraphs || false;

      // AI-очистка если включена
      if (shouldCleanup && text.trim()) {
        try {
          text = await groqService.cleanupText(text, useParagraphs);
        } catch (cleanErr) {
          console.warn('[Groq] Cleanup failed, using raw text:', cleanErr.message);
        }
      }

      return { success: true, text };
    } catch (err) {
      console.error('[Groq] Transcription error:', err.message);
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
    return { success: true };
  });
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

  // Register Groq IPC handlers (раньше всего остального)
  registerGroqHandlers();

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
    setTimeout(() => {
      autoUpdater.checkForUpdates();
    }, 10000);
    setInterval(() => {
      autoUpdater.checkForUpdates();
    }, 3 * 60 * 60 * 1000);
  } catch {}


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
