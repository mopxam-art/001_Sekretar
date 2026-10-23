const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

const CONFIG = {
  WINDOW_SIZE: { width: 420, height: 320 },
  AUTO_HIDE_DELAY: 5000, // 5 seconds default
  MAX_HISTORY: 10 // Max translations in session
};

class TranslationOverlay {
  constructor() {
    this.window = null;
    this.isVisible = false;
    this.autoHideTimer = null;
    this.autoHideDelay = CONFIG.AUTO_HIDE_DELAY;
    this.sessionHistory = []; // Translation history for this session
  }

  create() {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // Position: bottom-right corner with padding
    const windowX = screenWidth - CONFIG.WINDOW_SIZE.width - 20;
    const windowY = screenHeight - CONFIG.WINDOW_SIZE.height - 80;

    this.window = new BrowserWindow({
      width: CONFIG.WINDOW_SIZE.width,
      height: CONFIG.WINDOW_SIZE.height,
      x: windowX,
      y: windowY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      focusable: false,
      hasShadow: false,
      show: false, // Start hidden
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'translationOverlayPreload.js')
      }
    });

    this.window.loadFile(path.join(__dirname, 'translationOverlay.html'));

    // FIX: Ensure overlay stays on top of fullscreen games
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setFullScreenable(false);

    // Setup IPC handlers
    this.setupHandlers();

    // Prevent window close, just hide
    this.window.on('close', (e) => {
      e.preventDefault();
      this.hide();
    });

    return this.window;
  }

  setupHandlers() {
    // Handle close button
    ipcMain.on('translation-overlay-close', () => {
      this.hide();
    });

    // Handle mouse enter - pause auto-hide
    ipcMain.on('translation-overlay-mouse-enter', () => {
      this.clearAutoHideTimer();
    });

    // Handle mouse leave - resume auto-hide
    ipcMain.on('translation-overlay-mouse-leave', () => {
      this.startAutoHideTimer();
    });

    // Handle copy translation
    ipcMain.on('translation-overlay-copy', (event, text) => {
      const { clipboard } = require('electron');
      clipboard.writeText(text);
    });

    // Handle clear history
    ipcMain.on('translation-overlay-clear-history', () => {
      this.sessionHistory = [];
      this.sendHistoryUpdate();
    });
  }

  show(translationData) {
    if (!this.window || this.window.isDestroyed()) {
      this.create();
    }

    // Add to session history
    this.addToHistory(translationData);

    // Send translation data to window
    this.window.webContents.send('translation-data', {
      ...translationData,
      history: this.sessionHistory
    });

    // Show window
    if (!this.window.isVisible()) {
      this.window.show();
      this.isVisible = true;
    }

    // Ensure window doesn't steal focus
    if (this.window.isFocused()) {
      this.window.blur();
    }

    // Start auto-hide timer
    this.startAutoHideTimer();
  }

  hide() {
    this.clearAutoHideTimer();
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
      this.isVisible = false;
    }
  }

  addToHistory(translationData) {
    // Add timestamp
    const entry = {
      ...translationData,
      timestamp: Date.now()
    };

    // Add to beginning of history
    this.sessionHistory.unshift(entry);

    // Limit history size
    if (this.sessionHistory.length > CONFIG.MAX_HISTORY) {
      this.sessionHistory = this.sessionHistory.slice(0, CONFIG.MAX_HISTORY);
    }
  }

  sendHistoryUpdate() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('history-update', this.sessionHistory);
    }
  }

  startAutoHideTimer() {
    this.clearAutoHideTimer();
    this.autoHideTimer = setTimeout(() => {
      this.hide();
    }, this.autoHideDelay);
  }

  clearAutoHideTimer() {
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  }

  setAutoHideDelay(delay) {
    this.autoHideDelay = delay * 1000; // Convert seconds to ms
  }

  destroy() {
    this.clearAutoHideTimer();
    if (this.window && !this.window.isDestroyed()) {
      this.window.removeAllListeners();
      this.window.destroy();
      this.window = null;
    }
  }

  getSessionHistory() {
    return this.sessionHistory;
  }

  clearSessionHistory() {
    this.sessionHistory = [];
  }
}

module.exports = TranslationOverlay;
