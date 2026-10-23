/**
 * Auto Update IPC Handlers
 * electron-updater, проверка и установка обновлений
 */

const { ipcMain, app } = require('electron');

function registerUpdateHandlers(deps) {
  const getUpdater = () => (deps.getAutoUpdater ? deps.getAutoUpdater() : deps.autoUpdater);

  // ============ AUTO UPDATER ============
  ipcMain.handle('check-for-updates', async (_e, customUrl) => {
    try {
      const updater = getUpdater();
      if (updater) {
        return await updater.checkForUpdates(customUrl);
      }
      return { success: false, error: 'Модуль обновлений ещё инициализируется, повторите через пару секунд' };
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
      return { success: false, error: 'Модуль обновлений не инициализирован' };
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
      return { success: false, error: 'Модуль обновлений не инициализирован' };
    } catch (error) {
      console.error('[IPC] Install update error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-app-version', async () => {
    try {
      return app.getVersion();
    } catch (error) {
      return '1.0.2';
    }
  });

  ipcMain.handle('get-update-status', async () => {
    try {
      const updater = getUpdater();
      if (updater) {
        return { success: true, ...updater.getStatus() };
      }
      return { success: false, error: 'Модуль обновлений не инициализирован', currentVersion: app.getVersion() };
    } catch (error) {
      console.error('[IPC] Get update status error:', error);
      return { success: false, error: error.message, currentVersion: app.getVersion() };
    }
  });

  console.log('[IPC:Update] Handlers registered');
}

module.exports = { registerUpdateHandlers };
