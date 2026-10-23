/**
 * Auto Updater Module
 * Handles automatic updates via electron-updater
 */

const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

class AutoUpdaterManager {
  constructor() {
    this.mainWindow = null;
    this.updateAvailable = false;
    this.updateInfo = null;
    this.downloadProgress = 0;
    this.updateDownloaded = false;

    // N4 (29.04.2026): retry на сетевых ошибках. Max 3 попытки через 5 мин.
    // Сбрасывается при успешном update-downloaded или update-not-available.
    this.errorRetryCount = 0;
    this.maxErrorRetries = 3;
    this.retryTimer = null;

    // cold-start Шаг 13 (21.06.2026): быстрые ТИХИЕ ретраи перед медленными
    // 5-мин и перед алармом UI. Транзиентный net::ERR_CONNECTION_RESET
    // (cold-start / антивирус) чинится за секунды — не пугаем юзера «не удалось»
    // на 1-м блипе (реальный лог: 09:46 reset → 09:49 проверка прошла). Аларм —
    // только если и быстрые ретраи не помогли.
    this.quickRetryCount = 0;
    this.maxQuickRetries = 2;
    this.quickRetryDelays = [5000, 20000]; // 5с, затем 20с
    this.quickRetryTimer = null;

    // Configure auto-updater (Telegram-style: фоновая загрузка, юзер решает только когда ставить)
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    // For development testing — используем app.isPackaged (NOT NODE_ENV,
    // см. .env комментарий: NODE_ENV ломает Vite production build)
    if (!app.isPackaged) {
      autoUpdater.forceDevUpdateConfig = true;
    }

    this.setupEventListeners();
  }

  /**
   * Initialize with main window reference
   */
  init(mainWindow) {
    this.mainWindow = mainWindow;
    console.log('[AutoUpdater] Initialized');
  }

  /**
   * Setup auto-updater event listeners
   */
  setupEventListeners() {
    autoUpdater.on('checking-for-update', () => {
      console.log('[AutoUpdater] Checking for updates...');
      this.sendToRenderer('update-checking');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('[AutoUpdater] Update available:', info.version);
      this.updateAvailable = true;
      this.updateInfo = info;
      this.quickRetryCount = 0; // Шаг 13: проверка прошла → сброс быстрых ретраев
      this.sendToRenderer('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('[AutoUpdater] No updates available. Current version:', app.getVersion());
      this.updateAvailable = false;
      // N4: сбрасываем счётчик retry — сеть работает корректно
      this.errorRetryCount = 0;
      this.quickRetryCount = 0; // Шаг 13: сеть ок → сбрасываем и быстрые ретраи
      this.sendToRenderer('update-not-available', {
        currentVersion: app.getVersion()
      });
    });

    autoUpdater.on('download-progress', (progressObj) => {
      this.downloadProgress = progressObj.percent;
      console.log(`[AutoUpdater] Download progress: ${progressObj.percent.toFixed(1)}%`);
      this.sendToRenderer('update-download-progress', {
        percent: progressObj.percent,
        bytesPerSecond: progressObj.bytesPerSecond,
        transferred: progressObj.transferred,
        total: progressObj.total
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[AutoUpdater] Update downloaded:', info.version);
      this.updateDownloaded = true;
      // N4: сбрасываем счётчик retry — скачивание удалось
      this.errorRetryCount = 0;
      this.quickRetryCount = 0; // Шаг 13
      this.sendToRenderer('update-downloaded', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes
      });
    });

    autoUpdater.on('error', (error) => {
      console.error('[AutoUpdater] Error:', error);

      // N4 (29.04.2026): определяем сетевые ошибки — на них имеет смысл retry.
      // Не-сетевые ошибки (404, signature mismatch и т.п.) показываем сразу
      // без retry — повторная попытка бесполезна.
      const isNetworkError = !!(error.message && (
        error.message.includes('net::') ||
        error.message.includes('ECONN') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('timeout') ||
        error.message.includes('aborted') ||
        error.message.includes('socket hang up')
      ));

      // cold-start Шаг 13.1/13.2: на сетевой ошибке — сначала БЫСТРЫЕ ТИХИЕ
      // ретраи (5с/20с) БЕЗ уведомления UI. Транзиентный обрыв чинится за
      // секунды → юзер ничего пугающего не видит. Фоновый чек — тихий; ручной
      // чек всё равно получит фидбэк через return-value checkForUpdates()
      // (useAutoUpdater:122), так что 13.4 соблюдён без отдельного флага.
      if (isNetworkError && this.quickRetryCount < this.maxQuickRetries) {
        const delayMs = this.quickRetryDelays[this.quickRetryCount] || 20000;
        this.quickRetryCount++;
        console.log(`[AutoUpdater] Quick SILENT retry ${this.quickRetryCount}/${this.maxQuickRetries} in ${delayMs}ms`);
        if (this.quickRetryTimer) clearTimeout(this.quickRetryTimer);
        this.quickRetryTimer = setTimeout(() => {
          this.quickRetryTimer = null;
          this.checkForUpdates().catch(err =>
            console.error('[AutoUpdater] Quick retry failed:', err)
          );
        }, delayMs);
        return; // НЕ шлём update-error/retry-scheduled — тихо
      }

      // Быстрые ретраи исчерпаны (или не-сетевая ошибка) → теперь уведомляем UI.
      this.sendToRenderer('update-error', {
        message: error.message,
        isNetworkError,
        willRetry: isNetworkError && this.errorRetryCount < this.maxErrorRetries
      });

      if (isNetworkError && this.errorRetryCount < this.maxErrorRetries) {
        this.errorRetryCount++;
        const delayMs = 5 * 60 * 1000;
        console.log(`[AutoUpdater] Scheduling slow retry ${this.errorRetryCount}/${this.maxErrorRetries} in 5 min`);

        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          console.log('[AutoUpdater] Retry attempt', this.errorRetryCount);
          this.checkForUpdates().catch(err =>
            console.error('[AutoUpdater] Retry failed:', err)
          );
        }, delayMs);

        this.sendToRenderer('update-retry-scheduled', {
          attempt: this.errorRetryCount,
          maxAttempts: this.maxErrorRetries,
          delayMinutes: 5
        });
      }
    });
  }

  /**
   * N4 cleanup: вызывается из main.js при before-quit чтобы не оставлять
   * висящий retryTimer (иначе после quit он попытается checkForUpdates
   * на уже выгруженном app).
   */
  cleanup() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      console.log('[AutoUpdater] retryTimer cleared on cleanup');
    }
    // Шаг 13: чистим и быстрый ретрай-таймер
    if (this.quickRetryTimer) {
      clearTimeout(this.quickRetryTimer);
      this.quickRetryTimer = null;
      console.log('[AutoUpdater] quickRetryTimer cleared on cleanup');
    }
  }

  /**
   * Send message to renderer process
   */
  sendToRenderer(channel, data = {}) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Check for updates manually
   */
  async checkForUpdates() {
    try {
      console.log('[AutoUpdater] Manual update check initiated');
      const result = await autoUpdater.checkForUpdates();
      return { success: true, updateInfo: result?.updateInfo };
    } catch (error) {
      console.error('[AutoUpdater] Check for updates failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Download available update
   */
  async downloadUpdate() {
    try {
      if (!this.updateAvailable) {
        return { success: false, error: 'No update available' };
      }
      console.log('[AutoUpdater] Starting download...');
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      console.error('[AutoUpdater] Download failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Install downloaded update and restart app
   *
   * Скрываем главное окно ДО запуска NSIS установщика. Без этого
   * UAC prompt от установщика всплывает «за» окном SpeakFlow и юзеру
   * кажется что клик «Перезапустить» не сработал. Найдено при тесте
   * auto-update v1.3.67 → v1.3.68 (28.04.2026).
   */
  quitAndInstall() {
    if (!this.updateDownloaded) {
      console.warn('[AutoUpdater] No update downloaded to install');
      return { success: false, error: 'Update not downloaded yet' };
    }
    console.log('[AutoUpdater] Quitting and installing update...');

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.hide();
      } catch (err) {
        console.warn('[AutoUpdater] Failed to hide main window before install:', err);
      }
    }

    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (err) {
        console.error('[AutoUpdater] quitAndInstall failed:', err);
      }
    }, 200);

    return { success: true };
  }

  /**
   * DEV-only: симулировать update-downloaded событие для тестирования UI-баннера
   * без реального скачивания обновления. В production режиме (app.isPackaged)
   * игнорируется. NB: проверяем app.isPackaged а не NODE_ENV — последний
   * нельзя использовать (см. .env комментарий).
   */
  simulateDownloaded() {
    if (app.isPackaged) {
      console.warn('[AutoUpdater] simulateDownloaded called in production — ignored');
      return { success: false, error: 'Available only in dev mode' };
    }
    console.log('[AutoUpdater] DEV: simulating update-downloaded event');
    this.updateDownloaded = true;
    this.updateInfo = {
      version: '1.3.99-dev-test',
      releaseDate: new Date().toISOString(),
      releaseNotes: '🧪 Тест баннера обновления (dev mode)',
    };
    this.sendToRenderer('update-downloaded', this.updateInfo);
    return { success: true };
  }

  /**
   * Get current update status
   */
  getStatus() {
    return {
      updateAvailable: this.updateAvailable,
      updateInfo: this.updateInfo,
      downloadProgress: this.downloadProgress,
      updateDownloaded: this.updateDownloaded,
      currentVersion: app.getVersion()
    };
  }
}

module.exports = { AutoUpdaterManager };
