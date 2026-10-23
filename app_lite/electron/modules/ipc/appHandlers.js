/**
 * App Info & System IPC Handlers
 * Информация о приложении, внешние ссылки, автозапуск
 */

const { ipcMain, shell, app } = require('electron');
const { machineIdSync } = require('node-machine-id');

function registerAppHandlers(deps) {
  const { persistentStore } = deps;

  // ============ APP INFO ============
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('get-electron-version', () => {
    return process.versions.electron;
  });

  ipcMain.handle('get-machine-id', async () => {
    // Шаг 0/1 (E2E-only seam): тот же id, что main-init anon (getMainAnonId),
    // чтобы renderer-anon == main-anon в тестах (детерминизм + fallback-UUID).
    if (process.env.SF_E2E === '1' && globalThis.__sfGetAnonId) {
      return globalThis.__sfGetAnonId();
    }
    return machineIdSync(true);
  });

  // ============ EXTERNAL LINKS ============
  ipcMain.handle('open-external', async (event, url) => {
    await shell.openExternal(url);
  });

  // ============ MICROPHONE (Шаг 2) ============
  // Диплинк в настройки конфиденциальности микрофона Windows 10/11 (фиксированная
  // константа — не из инпута, без open-redirect).
  ipcMain.handle('open-mic-settings', async () => {
    try {
      await shell.openExternal('ms-settings:privacy-microphone');
      return { success: true };
    } catch (err) {
      return { success: false, error: err && err.message };
    }
  });
  // Шаг 2.6: статус доступа к микрофону. ⚠️ На старых Windows всегда 'granted' →
  // не-'denied' трактуем как «неопределённо» (probe решает), НИКОГДА как «ок».
  ipcMain.handle('mic-access-status', async () => {
    try {
      const { systemPreferences } = require('electron');
      if (systemPreferences && systemPreferences.getMediaAccessStatus) {
        return systemPreferences.getMediaAccessStatus('microphone');
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  });

  // ============ AUTO-LAUNCH (Start with System) ============
  ipcMain.handle('set-auto-launch', async (event, enabled) => {
    try {
      console.log('[IPC] set-auto-launch called with:', enabled);

      persistentStore.set('auto_launch', enabled);

      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: false,
        args: []
      });

      console.log('[IPC] Auto-launch set to:', enabled);
      return { success: true, enabled };
    } catch (error) {
      console.error('[IPC] Failed to set auto-launch:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-auto-launch', async () => {
    try {
      const storedValue = persistentStore.get('auto_launch', false);
      const loginSettings = app.getLoginItemSettings();

      console.log('[IPC] get-auto-launch - stored:', storedValue, ', system:', loginSettings.openAtLogin);

      return {
        success: true,
        enabled: loginSettings.openAtLogin,
        storedValue: storedValue
      };
    } catch (error) {
      console.error('[IPC] Failed to get auto-launch:', error);
      return { success: false, error: error.message, enabled: false };
    }
  });


  console.log('[IPC:App] Handlers registered');
}

module.exports = { registerAppHandlers };
