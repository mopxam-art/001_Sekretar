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
 * Настроить обработчики системных событий (resume/suspend/lock/unlock)
 */
function setupSystemEventHandlers(app, powerMonitor, windowManager, hotkeysManager) {
  const resetAppOnSuspend = (reason) => {
    console.log(`[EventHandlers] System power event: ${reason} - resetting active recording and keys`);
    sharedState.setIsRecording(false);
    
    if (windowManager) {
      const mw = windowManager.getMainWindow();
      if (mw && !mw.isDestroyed()) {
        mw.webContents.send('reset-recording-state');
        mw.webContents.send('stop-recording');
      }
    }

    if (hotkeysManager) {
      try {
        hotkeysManager.keysPressed.clear();
        hotkeysManager.recordingHotkeyPressed = false;
        hotkeysManager.translationHotkeyPressed = false;
        hotkeysManager.undoHotkeyPressed = false;
        hotkeysManager._hotkeyKeysHeld = false;
        hotkeysManager.killWinKeyServerProcesses();
      } catch (err) {
        console.warn('[EventHandlers] Error cleaning hotkeys on suspend:', err.message);
      }
    }
  };

  const reinitOnWake = (reason) => {
    console.log(`[EventHandlers] System wake event: ${reason} - scheduling staggered reinitialization`);
    sharedState.setIsRecording(false);

    if (hotkeysManager) {
      hotkeysManager.listenerRestartCount = 0;
      hotkeysManager.lastEventTime = Date.now();
    }

    // Первый шаг через 1000мс (ждем перехода Windows из Winlogon в интерактивный рабочий стол)
    setTimeout(() => {
      console.log(`[EventHandlers] Wake reinitialization step 1 (+1000ms for ${reason})`);
      if (hotkeysManager) {
        hotkeysManager.killWinKeyServerProcesses();
        hotkeysManager.setupKeyboardListener();
      }

      if (windowManager) {
        const mw = windowManager.getMainWindow();
        if (mw && !mw.isDestroyed()) {
          mw.webContents.send('reset-recording-state');
          if (mw.isVisible()) {
            mw.hide();
            setTimeout(() => {
              if (!mw.isDestroyed()) mw.showInactive();
            }, 100);
          }
        }
      }
    }, 1000);

    // Второй контрольный шаг через 2500мс для гарантированного захвата хука
    setTimeout(() => {
      console.log(`[EventHandlers] Wake reinitialization step 2 (+2500ms for ${reason})`);
      if (hotkeysManager && !hotkeysManager.isListenerAlive()) {
        console.warn('[EventHandlers] Hotkeys listener not alive after wake, forcing restart');
        hotkeysManager.setupKeyboardListener();
      }
    }, 2500);
  };

  powerMonitor.on('suspend', () => resetAppOnSuspend('suspend'));
  powerMonitor.on('lock-screen', () => resetAppOnSuspend('lock-screen'));
  powerMonitor.on('resume', () => reinitOnWake('resume'));
  powerMonitor.on('unlock-screen', () => reinitOnWake('unlock-screen'));

  console.log('[EventHandlers] Advanced powerMonitor event handlers configured (suspend, lock, resume, unlock)');
}

module.exports = {
  setupHotkeysCallbacks,
  setupSystemEventHandlers
};
