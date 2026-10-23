/**
 * Auto Updater Module
 * Handles automatic updates via electron-updater
 */

const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

class AutoUpdaterManager {
  constructor(windowManager) {
    this.windowManager = windowManager;
    this.mainWindow = windowManager?.getMainWindow ? windowManager.getMainWindow() : windowManager;
    this.updateAvailable = false;
    this.updateInfo = null;
    this.downloadProgress = 0;
    this.updateDownloaded = false;

    // Retry on network errors: Max 3 attempts every 5 min
    this.errorRetryCount = 0;
    this.maxErrorRetries = 3;
    this.retryTimer = null;

    // Fast retries
    this.quickRetryCount = 0;
    this.maxQuickRetries = 2;
    this.quickRetryDelays = [5000, 20000];
    this.quickRetryTimer = null;

    autoUpdater.autoDownload = false; // User controls download via button
    autoUpdater.autoInstallOnAppQuit = true;

    if (!app.isPackaged) {
      autoUpdater.forceDevUpdateConfig = true;
    }

    this.setupEventListeners();
  }

  /**
   * Set custom update feed URL or GitHub repository
   * Supports:
   * - "https://github.com/owner/repo"
   * - "owner/repo"
   * - "https://my-server.com/releases"
   */
  setFeed(urlOrRepo) {
    if (!urlOrRepo || !urlOrRepo.trim()) return;
    const str = urlOrRepo.trim();
    try {
      if (str.includes('github.com')) {
        const match = str.match(/github\.com\/([^/]+)\/([^/]+)/);
        if (match) {
          const owner = match[1];
          const repo = match[2].replace(/\.git$/, '');
          autoUpdater.setFeedURL({
            provider: 'github',
            owner,
            repo
          });
          console.log(`[AutoUpdater] Configured GitHub feed: ${owner}/${repo}`);
          return;
        }
      }
      if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(str)) {
        const [owner, repo] = str.split('/');
        autoUpdater.setFeedURL({
          provider: 'github',
          owner,
          repo
        });
        console.log(`[AutoUpdater] Configured GitHub feed: ${owner}/${repo}`);
        return;
      }
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: str
      });
      console.log(`[AutoUpdater] Configured generic feed URL: ${str}`);
    } catch (err) {
      console.error('[AutoUpdater] Failed to set feed URL:', err.message);
    }
  }

  /**
   * Initialize with main window reference
   */
  init(mainWindow) {
    this.mainWindow = mainWindow;
    console.log('[AutoUpdater] Initialized with window');
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
      this.quickRetryCount = 0;
      this.sendToRenderer('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('[AutoUpdater] No updates available. Current version:', app.getVersion());
      this.updateAvailable = false;
      this.errorRetryCount = 0;
      this.quickRetryCount = 0;
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
      this.errorRetryCount = 0;
      this.quickRetryCount = 0;
      this.sendToRenderer('update-downloaded', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes
      });
    });

    autoUpdater.on('error', (error) => {
      console.error('[AutoUpdater] Error:', error);

      const isNetworkError = !!(error.message && (
        error.message.includes('net::') ||
        error.message.includes('ECONN') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('timeout') ||
        error.message.includes('aborted') ||
        error.message.includes('socket hang up')
      ));

      this.sendToRenderer('update-error', {
        message: error.message,
        isNetworkError
      });
    });
  }

  cleanup() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.quickRetryTimer) {
      clearTimeout(this.quickRetryTimer);
      this.quickRetryTimer = null;
    }
  }

  /**
   * Send message to renderer process
   */
  sendToRenderer(channel, data = {}) {
    const win = (this.mainWindow && !this.mainWindow.isDestroyed())
      ? this.mainWindow
      : (this.windowManager?.getMainWindow && !this.windowManager.getMainWindow()?.isDestroyed()
          ? this.windowManager.getMainWindow()
          : null);
    if (win) {
      win.webContents.send(channel, data);
    }
  }

  /**
   * Check for updates manually
   */
  async checkForUpdates(customFeed) {
    try {
      if (customFeed) {
        this.setFeed(customFeed);
      }
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
   */
  quitAndInstall() {
    if (!this.updateDownloaded) {
      console.warn('[AutoUpdater] No update downloaded to install');
      return { success: false, error: 'Update not downloaded yet' };
    }
    console.log('[AutoUpdater] Quitting and installing update...');

    const win = (this.mainWindow && !this.mainWindow.isDestroyed())
      ? this.mainWindow
      : (this.windowManager?.getMainWindow && !this.windowManager.getMainWindow()?.isDestroyed()
          ? this.windowManager.getMainWindow()
          : null);

    if (win) {
      try {
        win.hide();
      } catch (err) {}
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
