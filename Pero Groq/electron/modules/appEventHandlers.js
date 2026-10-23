/**
 * App Event Handlers
 * Настройка всех event handlers для hotkeys и других событий
 */

const { ipcMain } = require('electron');
const sharedState = require('./sharedState');

/**
 * Настроить обработчики событий для hotkeys manager
 */
function setupHotkeysCallbacks(hotkeysManager, windowManager, options) {
  const { getOverlay } = options;
  let lastToggleTime = 0;
  const TOGGLE_COOLDOWN_MS = 600;

  // ============ RECORDING CALLBACKS ============
  hotkeysManager.onStartRecording = (mode) => {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow) return;

    if (
      !mainWindow.isDestroyed() &&
      mainWindow.isFocused()
    ) {
      windowManager.hideWindow();
      console.log('[EventHandlers] Hidden focused mainWindow before recording start');
    }

    if (mode === 'toggle') {
      const now = Date.now();
      if (now - lastToggleTime < TOGGLE_COOLDOWN_MS) {
        console.log(`[EventHandlers] Ignoring toggle bounce (${now - lastToggleTime}ms < ${TOGGLE_COOLDOWN_MS}ms)`);
        return;
      }
      lastToggleTime = now;
      
      const currentlyRecording = sharedState.getIsRecording();
      if (!currentlyRecording) {
        console.log('[EventHandlers] Starting recording (toggle mode)');
        sharedState.setIsRecording(true);
        mainWindow.webContents.send('start-recording');
        if (getOverlay) getOverlay().updateState(true);
      } else {
        console.log('[EventHandlers] Stopping recording (toggle mode)');
        sharedState.setIsRecording(false);
        mainWindow.webContents.send('stop-recording');
        if (getOverlay) getOverlay().updateState(false);
      }
    } else if (mode === 'streaming') {
      const currentlyRecording = sharedState.getIsRecording();
      if (!currentlyRecording) {
        console.log('[EventHandlers] Starting recording (streaming mode)');
        sharedState.setIsRecording(true);
        mainWindow.webContents.send('start-streaming-recording');
        if (getOverlay) getOverlay().updateState(true);
      } else {
        console.log('[EventHandlers] Stopping recording (streaming mode)');
        sharedState.setIsRecording(false);
        mainWindow.webContents.send('stop-recording');
        if (getOverlay) getOverlay().updateState(false);
      }
    } else {
      // Hold mode: начинаем запись только если еще не записываем
      if (!sharedState.getIsRecording()) {
        console.log('[EventHandlers] Starting recording (hold mode)');
        sharedState.setIsRecording(true);
        mainWindow.webContents.send('start-recording');
        if (getOverlay) getOverlay().updateState(true);
      }
    }
  };

  hotkeysManager.onStopRecording = () => {
    if (sharedState.getIsRecording()) {
      console.log('[EventHandlers] Stopping recording (hold mode - key released)');
      sharedState.setIsRecording(false);
      const mainWindow = windowManager.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stop-recording');
        if (getOverlay) getOverlay().updateState(false);
      }
    }
  };

  console.log('[EventHandlers] Hotkeys callbacks configured');
}

/**
 * Настроить обработчики системных событий (resume/suspend)
 */
function setupSystemEventHandlers(app, powerMonitor, windowManager, hotkeysManager) {
  powerMonitor.on('resume', () => {
    console.log('[EventHandlers] System resumed - reinitializing hotkeys');
    if (hotkeysManager) {
      hotkeysManager.setupKeyboardListener();
    }
    // Fix for black screen on wake up
    if (windowManager) {
      const mw = windowManager.getMainWindow();
      if (mw && !mw.isDestroyed() && mw.isVisible()) {
        console.log('[EventHandlers] Forcing window repaint to fix black screen');
        mw.hide();
        setTimeout(() => {
          if (!mw.isDestroyed()) mw.showInactive();
        }, 100);
      }
    }
  });

  console.log('[EventHandlers] System event handlers configured');
}

module.exports = {
  setupHotkeysCallbacks,
  setupSystemEventHandlers
};
