/**
 * Auto Update IPC Handlers
 * electron-updater, проверка и установка обновлений
 *
 * ВАЖНО: используем deps.getAutoUpdater() (а не deps.autoUpdater),
 * потому что autoUpdater создаётся через setTimeout 15 сек ПОСЛЕ
 * регистрации IPC handlers — на момент регистрации deps.autoUpdater
 * всегда null. Геттер достаёт актуальный instance во время вызова.
 */

const { ipcMain } = require('electron');

function registerUpdateHandlers(deps) {
  const getUpdater = () => (deps.getAutoUpdater ? deps.getAutoUpdater() : deps.autoUpdater);

  // ============ AUTO UPDATER ============
  ipcMain.handle('check-for-updates', async () => {
    try {
      const updater = getUpdater();
      if (updater) {
        return await updater.checkForUpdates();
      }
      return { success: false, error: 'Auto updater not initialized' };
    } catch (error) {
      console.error('[IPC] Check for updates error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('download-update', async () => {
    try {
      const updater = getUpdater();
      if (updater) {
        return await updater.downloadUpdate();
      }
      return { success: false, error: 'Auto updater not initialized' };
    } catch (error) {
      console.error('[IPC] Download update error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('install-update', async () => {
    try {
      const updater = getUpdater();
      if (updater) {
        return updater.quitAndInstall();
      }
      return { success: false, error: 'Auto updater not initialized' };
    } catch (error) {
      console.error('[IPC] Install update error:', error);
      return { success: false, error: error.message };
    }
  });

  // DEV-only: симулировать update-downloaded для тестирования UI
  ipcMain.handle('simulate-update-downloaded', async () => {
    try {
      const updater = getUpdater();
      if (updater) {
        return updater.simulateDownloaded();
      }
      return { success: false, error: 'Auto updater not initialized (wait 15s after start)' };
    } catch (error) {
      console.error('[IPC] Simulate update-downloaded error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-update-status', async () => {
    try {
      const updater = getUpdater();
      if (updater) {
        return { success: true, ...updater.getStatus() };
      }
      return { success: false, error: 'Auto updater not initialized' };
    } catch (error) {
      console.error('[IPC] Get update status error:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[IPC:Update] Handlers registered');
}

module.exports = { registerUpdateHandlers };
