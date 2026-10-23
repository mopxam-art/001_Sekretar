const { BrowserWindow, ipcMain, screen, app } = require('electron');
const path = require('path');

class LiveAssistantOverlay {
  constructor() {
    this.window = null;
    this.isActive = false;
  }

  create(options = {}) {
    const { autoStartFromMeeting = false } = options;

    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();

      // If auto-started from meeting, enable system audio
      if (autoStartFromMeeting) {
        this.window.webContents.send('enable-system-audio');
      }
      return;
    }

    // Get screen dimensions for positioning
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // Create Live Assistant overlay window
    // FIX: Disabled acrylic/vibrancy effects - they require GPU and crash fullscreen games
    this.window = new BrowserWindow({
      width: 400,
      height: 600,
      x: Math.floor((screenWidth - 400) / 2), // Centered horizontally
      y: 20, // Top of screen with small margin
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      focusable: true, // Allow focus for input fields
      hasShadow: false, // FIX: Disabled shadow to reduce GPU usage
      // FIX: Disabled glass effects - they conflict with fullscreen games
      // vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
      // backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'overlay', 'preload.js')
      }
    });

    // Load Live Assistant HTML (modular structure in live-assistant folder)
    this.window.loadFile(path.join(__dirname, 'live-assistant', 'index.html'));

    // FIX: Ensure overlay stays on top of fullscreen games
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setFullScreenable(false);

    // Open DevTools only in development mode
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    if (isDev) {
      this.window.webContents.openDevTools({ mode: 'detach' });
    }

    // Show window after loading
    this.window.once('ready-to-show', () => {
      this.window.show();
      this.isActive = true;

      // If auto-started from meeting, enable system audio
      if (autoStartFromMeeting) {
        this.window.webContents.send('enable-system-audio');
      }
    });

    // Handle close - just hide
    this.window.on('close', (e) => {
      e.preventDefault();
      this.hide();
    });

    // Set up IPC handlers
    this.setupHandlers();

    return this.window;
  }

  setupHandlers() {
    // Handle finish button
    ipcMain.on('live-assistant-finish', (event, fullTranscript) => {
      console.log('📝 Live Assistant finished with transcript length:', fullTranscript?.length || 0);
      this.isActive = false;

      // Send event to main window to create note
      const mainWindows = BrowserWindow.getAllWindows();
      const mainWindow = mainWindows.find(w => w.id !== this.window?.id);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('live-assistant-finished', {
          transcript: fullTranscript,
          timestamp: Date.now()
        });
      }

      // Close Live Assistant window
      this.destroy();
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

  // Send transcript update to overlay
  updateTranscript(text, isInterim = false) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('live-assistant-transcript', {
        text,
        isInterim
      });
    }
  }

  // Send AI insights update to overlay
  updateAIInsights(insights) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('live-assistant-ai-insights', insights);
    }
  }

  destroy() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.removeAllListeners();
      this.window.destroy();
      this.window = null;
    }
    this.isActive = false;
  }
}

module.exports = LiveAssistantOverlay;
