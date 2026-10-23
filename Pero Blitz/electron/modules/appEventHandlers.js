/**
 * App Event Handlers
 * Настройка всех event handlers для hotkeys и других событий
 */

const { ipcMain } = require('electron');

/**
 * Настроить обработчики событий для hotkeys manager
 */
function setupHotkeysCallbacks(hotkeysManager, windowManager, options) {
  const { getOverlay } = options;
  let isRecording = false;

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
      // Toggle mode: переключаем состояние
      isRecording = !isRecording;
      if (isRecording) {
        console.log('[EventHandlers] Starting recording (toggle mode)');
        mainWindow.webContents.send('start-recording');
        if (getOverlay) getOverlay().updateState(true);
      } else {
        console.log('[EventHandlers] Stopping recording (toggle mode)');
        mainWindow.webContents.send('stop-recording');
        if (getOverlay) getOverlay().updateState(false);
      }
    } else if (mode === 'streaming') {
      // Streaming mode: работает как toggle, но с мгновенной вставкой текста
      isRecording = !isRecording;
      if (isRecording) {
        console.log('[EventHandlers] Starting recording (streaming mode)');
        mainWindow.webContents.send('start-streaming-recording');
        if (getOverlay) getOverlay().updateState(true);
      } else {
        console.log('[EventHandlers] Stopping recording (streaming mode)');
        mainWindow.webContents.send('stop-recording');
        if (getOverlay) getOverlay().updateState(false);
      }
    } else {
      // Hold mode: начинаем запись только если еще не записываем
      if (!isRecording) {
        console.log('[EventHandlers] Starting recording (hold mode)');
        isRecording = true;
        mainWindow.webContents.send('start-recording');
        if (getOverlay) getOverlay().updateState(true);
      }
    }
  };

  hotkeysManager.onStopRecording = () => {
    if (isRecording) {
      console.log('[EventHandlers] Stopping recording (hold mode - key released)');
      isRecording = false;
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
