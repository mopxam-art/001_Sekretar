const { BrowserWindow, ipcMain, screen, app } = require('electron');
const path = require('path');

/**
 * LiveAssistantSidebar - боковая панель с real-time AI подсказками
 * Прикрепляется к правому краю экрана на время встречи
 */
class LiveAssistantSidebar {
  constructor() {
    this.window = null;
    this.isActive = false;
    this.meetingInfo = null;
    this.handlersRegistered = false;
  }

  /**
   * Создать и показать sidebar
   * @param {Object} options - опции
   * @param {Object} options.meetingInfo - информация о встрече (platform, title)
   */
  create(options = {}) {
    const { meetingInfo = null } = options;
    this.meetingInfo = meetingInfo;

    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return this.window;
    }

    // Get screen dimensions
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // Sidebar dimensions
    const sidebarWidth = 380;
    const sidebarHeight = screenHeight - 40; // почти на всю высоту, с отступом

    // Create sidebar window (right edge of screen)
    this.window = new BrowserWindow({
      width: sidebarWidth,
      height: sidebarHeight,
      x: screenWidth - sidebarWidth - 10,
      y: 20,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: false, // показываем в taskbar
      resizable: false,
      movable: true,
      focusable: true,
      hasShadow: true,
      vibrancy: process.platform === 'darwin' ? 'sidebar' : undefined,
      backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'sidebarPreload.js')
      }
    });

    // Load sidebar HTML
    this.window.loadFile(path.join(__dirname, 'live-assistant-sidebar', 'index.html'));

    // Open DevTools in dev mode
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    if (isDev) {
      this.window.webContents.openDevTools({ mode: 'detach' });
    }

    // Send meeting info when ready
    this.window.webContents.on('did-finish-load', () => {
      if (this.meetingInfo) {
        this.window.webContents.send('meeting-info', this.meetingInfo);
      }
      // Auto-start recording with small delay
      setTimeout(() => {
        this.window.webContents.send('auto-start');
      }, 500);
    });

    this.window.once('ready-to-show', () => {
      this.window.show();
      this.isActive = true;
    });

    // Handle close
    this.window.on('close', (e) => {
      e.preventDefault();
      this.hide();
    });

    this.setupHandlers();
    return this.window;
  }

  setupHandlers() {
    // Prevent duplicate handlers
    if (this.handlersRegistered) return;
    this.handlersRegistered = true;

    // Handle finish button
    ipcMain.on('sidebar-finish', (event, data) => {
      console.log('📝 sidebar-finish received, data:', data);
      this.isActive = false;
      const transcript = data?.transcript;

      console.log('📝 Transcript length:', transcript?.length || 0);

      // Auto-save transcript as meeting note if there's content
      if (transcript && transcript.trim().length > 50) {
        const allWindows = BrowserWindow.getAllWindows();
        console.log('📝 All windows count:', allWindows.length);

        // Find the main window (not the sidebar, not notification)
        const mainWindow = allWindows.find(w => {
          if (this.window && w.id === this.window.id) return false;
          if (w.isDestroyed()) return false;
          // Main window has larger size
          const bounds = w.getBounds();
          return bounds.width > 300 && bounds.height > 300;
        });

        console.log('📝 Main window found:', !!mainWindow, mainWindow?.id);

        if (mainWindow && !mainWindow.isDestroyed()) {
          // Send to main window to save as note
          console.log('📝 Sending save-meeting-note to main window');
          mainWindow.webContents.send('save-meeting-note', transcript);
        } else {
          console.error('❌ Main window not found or destroyed');
        }
      } else {
        console.log('📝 Transcript too short, not saving:', transcript?.trim().length || 0);
      }

      this.destroy();
    });

    // Handle minimize/collapse
    ipcMain.on('sidebar-minimize', () => {
      if (this.window && !this.window.isDestroyed()) {
        // Collapse to small floating button
        this.window.setSize(60, 60);
        const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
        this.window.setPosition(screenWidth - 70, 20);
      }
    });

    // Handle expand
    ipcMain.on('sidebar-expand', () => {
      if (this.window && !this.window.isDestroyed()) {
        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
        this.window.setSize(380, screenHeight - 40);
        this.window.setPosition(screenWidth - 390, 20);
      }
    });
  }

  show() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.isActive = true;
    }
  }

  hide() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
      this.isActive = false;
    }
  }

  // Send transcript update
  updateTranscript(text, isInterim = false) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('transcript-update', { text, isInterim });
    }
  }

  // Send AI suggestion
  updateAISuggestion(suggestion) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('ai-suggestion', suggestion);
    }
  }

  // Mute sidebar (when dictation is active)
  mute() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('sidebar-mute');
    }
  }

  // Unmute sidebar (when dictation stops)
  unmute() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('sidebar-unmute');
    }
  }

  destroy() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.removeAllListeners();
      this.window.destroy();
      this.window = null;
    }
    this.isActive = false;
    this.meetingInfo = null;
  }

  isWindowActive() {
    return this.isActive && this.window && !this.window.isDestroyed();
  }
}

module.exports = LiveAssistantSidebar;
