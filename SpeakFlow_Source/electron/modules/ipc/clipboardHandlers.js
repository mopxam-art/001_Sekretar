/**
 * Clipboard IPC Handlers
 * Управление буфером обмена, автоперевод
 */

const { ipcMain } = require('electron');

function registerClipboardHandlers(deps) {
  const { windowManager, clipboardTranslation, persistentStore, getClipboardManager } = deps;

  // Helper to get clipboard manager (lazy initialization)
  const getManager = () => {
    if (getClipboardManager) {
      return getClipboardManager();
    }
    return null;
  };

  // ============ CLIPBOARD MANAGER ============
  ipcMain.handle('clipboard:read-text', async () => {
    const clipboardManager = getManager();
    if (!clipboardManager) {
      return { success: false, error: 'Clipboard manager not initialized' };
    }
    return clipboardManager.readText();
  });

  ipcMain.handle('clipboard:write-text', async (event, text) => {
    const clipboardManager = getManager();
    if (!clipboardManager) {
      return { success: false, error: 'Clipboard manager not initialized' };
    }
    return clipboardManager.writeText(text);
  });

  ipcMain.handle('clipboard:has-image', async () => {
    const clipboardManager = getManager();
    if (!clipboardManager) {
      return { success: false, hasImage: false, error: 'Clipboard manager not initialized' };
    }
    return clipboardManager.hasImage();
  });

  ipcMain.handle('clipboard:read-image', async () => {
    const clipboardManager = getManager();
    if (!clipboardManager) {
      return { success: false, error: 'Clipboard manager not initialized' };
    }
    return clipboardManager.readImage();
  });

  ipcMain.handle('clipboard:write-image', async (event, imagePath) => {
    const clipboardManager = getManager();
    if (!clipboardManager) {
      return { success: false, error: 'Clipboard manager not initialized' };
    }
    return clipboardManager.writeImage(imagePath);
  });

  ipcMain.handle('clipboard:get-formats', async () => {
    const clipboardManager = getManager();
    if (!clipboardManager) {
      return { success: false, error: 'Clipboard manager not initialized' };
    }
    return clipboardManager.getFormats();
  });

  ipcMain.handle('clipboard:read-image-base64', async () => {
    const clipboardManager = getManager();
    if (!clipboardManager) {
      return { success: false, error: 'Clipboard manager not initialized' };
    }
    return clipboardManager.readImageAsBase64();
  });

  ipcMain.handle('clipboard:start-monitoring', async (event, watchDelayMs = 500) => {
    const clipboardManager = getManager();
    if (!clipboardManager) {
      return { success: false, error: 'Clipboard manager not initialized' };
    }
    try {
      const callback = (type, data) => {
        if (windowManager && windowManager.mainWindow) {
          windowManager.mainWindow.webContents.send('clipboard-change', { type, data });
        }
      };

      return clipboardManager.startMonitoring(callback, watchDelayMs);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clipboard:stop-monitoring', async () => {
    const clipboardManager = getManager();
    if (!clipboardManager) {
      return { success: false, error: 'Clipboard manager not initialized' };
    }
    return clipboardManager.stopMonitoring();
  });

  ipcMain.handle('clipboard:is-monitoring', async () => {
    const clipboardManager = getManager();
    if (!clipboardManager) {
      return { success: false, isMonitoring: false };
    }
    return clipboardManager.isMonitoring();
  });

  ipcMain.handle('clipboard:load-image', async (event, imagePath) => {
    const fs = require('fs');
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const base64 = imageBuffer.toString('base64');
      const ext = imagePath.split('.').pop().toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      return { success: true, dataUri: `data:${mimeType};base64,${base64}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============ CLIPBOARD AUTO-TRANSLATE ============
  ipcMain.handle('toggle-clipboard-auto-translate', async (event, enabled) => {
    try {
      persistentStore.set('clipboard_auto_translate', enabled);

      if (enabled) {
        if (clipboardTranslation) {
          const autoHideDelay = parseInt(persistentStore.get('clipboard_auto_hide_delay') || '5');
          clipboardTranslation.setAutoHideDelay(autoHideDelay);
          clipboardTranslation.start();
        }
      } else {
        if (clipboardTranslation) {
          clipboardTranslation.stop();
        }
      }

      return { success: true, enabled };
    } catch (error) {
      console.error('[IPC] Error toggling clipboard auto-translate:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-clipboard-auto-translate-settings', async () => {
    try {
      const enabled = persistentStore.get('clipboard_auto_translate', false);
      const autoHideDelay = parseInt(persistentStore.get('clipboard_auto_hide_delay') || '5');

      return {
        success: true,
        enabled: enabled === 'true' || enabled === true,
        autoHideDelay
      };
    } catch (error) {
      console.error('[IPC] Error getting clipboard settings:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('set-clipboard-auto-hide-delay', async (event, delay) => {
    try {
      persistentStore.set('clipboard_auto_hide_delay', delay);

      if (clipboardTranslation) {
        clipboardTranslation.setAutoHideDelay(delay);
      }

      return { success: true, delay };
    } catch (error) {
      console.error('[IPC] Error setting auto-hide delay:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[IPC:Clipboard] Handlers registered');
}

module.exports = { registerClipboardHandlers };
