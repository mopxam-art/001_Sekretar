/**
 * Live Assistant IPC Handlers
 * Ассистент для встреч
 */

const { ipcMain } = require('electron');

function registerLiveAssistantHandlers(deps) {
  const { windowManager, liveAssistantOverlay } = deps;

  // ============ LIVE ASSISTANT ============
  ipcMain.handle('start-live-assistant', async () => {
    try {
      if (!deps.liveAssistantOverlay) {
        const LiveAssistantOverlay = require('../../liveAssistantOverlay');
        deps.liveAssistantOverlay = new LiveAssistantOverlay();
      }
      deps.liveAssistantOverlay.create();
      return { success: true };
    } catch (error) {
      console.error('[IPC] Error starting live assistant:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('live-assistant-update-transcript', async (event, data) => {
    if (deps.liveAssistantOverlay && deps.liveAssistantOverlay.window && !deps.liveAssistantOverlay.window.isDestroyed()) {
      deps.liveAssistantOverlay.window.webContents.send('update-transcript', data);
    }
    return { success: true };
  });

  ipcMain.handle('live-assistant-update-insights', async (event, insights) => {
    if (deps.liveAssistantOverlay && deps.liveAssistantOverlay.window && !deps.liveAssistantOverlay.window.isDestroyed()) {
      deps.liveAssistantOverlay.window.webContents.send('update-insights', insights);
    }
    return { success: true };
  });

  ipcMain.on('overlay-hide-requested', () => {
    if (deps.liveAssistantOverlay && deps.liveAssistantOverlay.window && !deps.liveAssistantOverlay.window.isDestroyed()) {
      deps.liveAssistantOverlay.window.hide();
    }
  });

  ipcMain.handle('live-assistant-save-note', async (event, transcript) => {
    try {
      const mainWindow = windowManager.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('save-meeting-note', transcript);
      }
      return { success: true };
    } catch (error) {
      console.error('[IPC] Error saving meeting note:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[IPC:LiveAssistant] Handlers registered');
}

module.exports = { registerLiveAssistantHandlers };
