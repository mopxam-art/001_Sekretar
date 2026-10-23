/**
 * Memory Overlay
 *
 * Overlay window for Voice Memory Search.
 * Shows on top of all windows, records voice query,
 * searches memory and generates prompt.
 */

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

class MemoryOverlay {
  constructor() {
    this.window = null;
    this.isVisible = false;
    this.isQuitting = false;
    this.ipcSetup = false;
  }

  /**
   * Create overlay window
   */
  create() {
    if (this.window) return this.window;

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // Center of screen
    const windowWidth = 500;
    const windowHeight = 400;
    const windowX = Math.floor(screenWidth / 2 - windowWidth / 2);
    const windowY = Math.floor(screenHeight / 2 - windowHeight / 2);

    this.window = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      x: windowX,
      y: windowY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      hasShadow: false,
      show: false,
      // ВАЖНО: Не привязываем к главному окну
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    // Устанавливаем уровень поверх всех окон (включая fullscreen игры)
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setFullScreenable(false);

    // Load HTML UI
    this.window.loadFile(path.join(__dirname, 'ui', 'memory-overlay.html'));

    // Prevent window close, just hide
    this.window.on('close', (e) => {
      if (!this.isQuitting) {
        e.preventDefault();
        this.hide();
      }
    });

    this.setupIPC();

    console.log('[MemoryOverlay] Created');
    return this.window;
  }

  /**
   * Setup IPC handlers
   */
  setupIPC() {
    // Не регистрировать повторно
    if (this.ipcSetup) return;
    this.ipcSetup = true;

    // Close overlay
    ipcMain.handle('memory-overlay-close', () => {
      this.hide();
      return { success: true };
    });

    // Get auth config for renderer to make API calls
    ipcMain.handle('memory-overlay-get-config', () => {
      try {
        const secureStore = require('../secureStore');
        const tokens = secureStore.getTokens();
        const API_URL = process.env.API_URL || 'http://localhost:4000';

        return {
          token: tokens?.accessToken || null,
          apiUrl: API_URL
        };
      } catch (err) {
        console.error('[MemoryOverlay] Get config error:', err);
        return { token: null, apiUrl: 'http://localhost:4000' };
      }
    });

    // Search memory directly via API
    ipcMain.handle('memory-overlay-search', async (event, query) => {
      try {
        const secureStore = require('../secureStore');
        const tokens = secureStore.getTokens();
        const token = tokens?.accessToken;
        const API_URL = process.env.API_URL || 'http://localhost:4000';

        if (!token) {
          return { error: 'Not authenticated' };
        }

        const response = await fetch(`${API_URL}/api/memory/generate-prompt`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'x-device-id': 'memory-overlay'
          },
          body: JSON.stringify({ query })
        });

        if (!response.ok) {
          return { error: `API error: ${response.status}` };
        }

        const data = await response.json();
        return { prompt: data.prompt, contexts: data.contexts };
      } catch (err) {
        console.error('[MemoryOverlay] Search error:', err);
        return { error: err.message };
      }
    });

    // Insert text result
    ipcMain.handle('memory-overlay-insert', async (event, text) => {
      // Hide overlay first
      this.hide();

      // Small delay to let focus return to previous app
      await new Promise(r => setTimeout(r, 100));

      // Use the existing insert-text handler
      const { clipboard } = require('electron');
      const savedClipboard = clipboard.readText();
      clipboard.writeText(text);

      // Trigger paste via keysender or fallback
      try {
        const { Hardware } = require('keysender');
        const ks = new Hardware();
        await ks.keyboard.sendKey(['ctrl', 'v']);

        setTimeout(() => {
          clipboard.writeText(savedClipboard);
        }, 150);

        return { success: true, method: 'keysender' };
      } catch (err) {
        // Fallback to robotjs
        try {
          const robot = require('@jitsi/robotjs');
          robot.keyTap('v', 'control');
          setTimeout(() => {
            clipboard.writeText(savedClipboard);
          }, 150);
          return { success: true, method: 'robotjs' };
        } catch (robotErr) {
          return { error: 'Insert failed' };
        }
      }
    });
  }

  /**
   * Show overlay
   */
  show() {
    if (!this.window) {
      this.create();
    }

    // Сбросить состояние UI
    this.window.webContents.send('memory-overlay-reset');

    // Показать окно БЕЗ focus() чтобы не поднимать главное окно
    this.window.showInactive();

    // Установить поверх после показа
    this.window.setAlwaysOnTop(true, 'screen-saver');

    this.isVisible = true;
    console.log('[MemoryOverlay] Shown');
  }

  /**
   * Hide overlay
   */
  hide() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
      this.isVisible = false;
      console.log('[MemoryOverlay] Hidden');
    }
  }

  /**
   * Toggle visibility
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Remove IPC handlers
   */
  removeIPC() {
    if (!this.ipcSetup) return;

    try {
      ipcMain.removeHandler('memory-overlay-close');
      ipcMain.removeHandler('memory-overlay-get-config');
      ipcMain.removeHandler('memory-overlay-search');
      ipcMain.removeHandler('memory-overlay-insert');
    } catch (err) {
      console.error('[MemoryOverlay] Error removing IPC handlers:', err);
    }

    this.ipcSetup = false;
  }

  /**
   * Destroy window
   */
  destroy() {
    this.isQuitting = true;
    this.removeIPC();

    if (this.window && !this.window.isDestroyed()) {
      this.window.removeAllListeners();
      this.window.destroy();
      this.window = null;
    }
  }
}

module.exports = MemoryOverlay;
