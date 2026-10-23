/**
 * Overlay IPC Handlers
 * События overlay, управление окнами, настройки
 */

const { ipcMain } = require('electron');
const sharedState = require('../sharedState');

function registerOverlayHandlers(deps) {
  const { windowManager, getOverlay, persistentStore, secureStore, API_URL } = deps;

  // ============ OVERLAY API ============
  ipcMain.handle('overlay-get-access-token', async () => {
    try {
      const tokens = secureStore.getTokens();
      return tokens.accessToken || null;
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('overlay-get-api-url', async () => {
    return API_URL;
  });

  // ============ OVERLAY EVENTS ============
  ipcMain.on('overlay-start-recording', () => {
    console.log('[IPC] overlay-start-recording - triggering recording in main window');
    sharedState.setIsRecording(true);
    const overlay = getOverlay ? getOverlay() : null;
    if (overlay) {
      overlay.updateState(true);
    }
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('start-recording');
    }
  });

  ipcMain.on('overlay-stop-recording', () => {
    console.log('[IPC] overlay-stop-recording - triggering stop in main window');
    sharedState.setIsRecording(false);
    const overlay = getOverlay ? getOverlay() : null;
    if (overlay) {
      overlay.updateState(false);
    }
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stop-recording');
    }
  });

  ipcMain.on('recording-started', () => {
    console.log('[IPC] recording-started event received');
    sharedState.setIsRecording(true);
    const overlay = getOverlay ? getOverlay() : null;
    if (overlay) {
      overlay.updateState(true);
    } else {
      console.log('[IPC] WARNING: overlay is null/undefined');
    }
  });

  // П-23: одноразовое скрытие главного окна при старте streaming-сессии,
  // если оно сфокусировано.
  ipcMain.handle('hide-main-window-if-focused', () => {
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
      windowManager.hideWindow();
      console.log('[IPC] hide-main-window-if-focused: hidden (was focused)');
      return { hidden: true };
    }
    return { hidden: false };
  });

  ipcMain.on('recording-stopped', () => {
    console.log('[IPC] recording-stopped event received');
    sharedState.setIsRecording(false);
    const overlay = getOverlay ? getOverlay() : null;
    if (overlay) {
      overlay.updateState(false);
    }
  });

  ipcMain.on('processing-started', () => {
    const overlay = getOverlay ? getOverlay() : null;
    if (overlay && overlay.window && !overlay.window.isDestroyed()) {
      overlay.window.webContents.send('processing-state-changed', true);
    }
  });

  ipcMain.on('processing-stopped', () => {
    const overlay = getOverlay ? getOverlay() : null;
    if (overlay && overlay.window && !overlay.window.isDestroyed()) {
      overlay.window.webContents.send('processing-state-changed', false);
    }
  });

  // ============ TAB-COMPLETE STATE ============
  ipcMain.on('tab-complete-started', () => {
    const overlay = getOverlay ? getOverlay() : null;
    if (overlay && overlay.window && !overlay.window.isDestroyed()) {
      overlay.window.webContents.send('tab-complete-state-changed', true);
    }
  });

  ipcMain.on('tab-complete-finished', () => {
    const overlay = getOverlay ? getOverlay() : null;
    if (overlay && overlay.window && !overlay.window.isDestroyed()) {
      overlay.window.webContents.send('tab-complete-state-changed', false);
    }
  });

  ipcMain.on('translation-recording-started', () => {
    const overlay = getOverlay ? getOverlay() : null;
    if (overlay) overlay.updateState(true);
  });

  ipcMain.on('translation-recording-stopped', () => {
    const overlay = getOverlay ? getOverlay() : null;
    if (overlay && !overlay.isRecording) {
      overlay.updateState(false);
    }
  });

  // ============ MEETING RECORDING ============
  ipcMain.on('meeting-recording-state-changed', (event, isRecording, duration) => {
    const overlay = getOverlay ? getOverlay() : null;
    if (overlay && overlay.window && !overlay.window.isDestroyed()) {
      overlay.window.webContents.send('meeting-recording-state-changed', isRecording, duration);
    }
  });

  // ============ WINDOW CONTROL ============
  ipcMain.handle('focus-window', async () => {
    windowManager.showWindow();
  });

  // ============ OVERLAY SETTINGS ============
  ipcMain.handle('set-overlay-visibility', async (event, visible) => {
    persistentStore.set('overlay_visible', visible);
    const overlay = getOverlay ? getOverlay() : null;
    if (overlay) {
      overlay.setVisibility(visible);
    }
    return { success: true };
  });

  ipcMain.handle('set-overlay-auto-hide', async (event, enabled) => {
    persistentStore.set('overlay_auto_hide', enabled);
    const overlay = getOverlay ? getOverlay() : null;
    if (overlay) {
      overlay.setAutoHide(enabled);
    }
    return { success: true };
  });

  ipcMain.handle('set-meeting-auto-start', async (event, enabled) => {
    persistentStore.set('meeting_auto_start', enabled);
    return { success: true };
  });

  console.log('[IPC:Overlay] Handlers registered');
}

module.exports = { registerOverlayHandlers };
