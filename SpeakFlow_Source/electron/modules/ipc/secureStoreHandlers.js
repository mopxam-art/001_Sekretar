/**
 * Secure Store IPC Handlers
 * Безопасное хранение токенов и данных пользователя
 */

const { ipcMain } = require('electron');

function registerSecureStoreHandlers(deps) {
  const { secureStore, API_URL } = deps;

  // ============ SECURE STORE ============
  ipcMain.handle('secure-store:save-tokens', async (event, accessToken, refreshToken) => {
    try {
      secureStore.saveTokens(accessToken, refreshToken);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('secure-store:get-tokens', async () => {
    try {
      const tokens = secureStore.getTokens();
      return { success: true, ...tokens };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('secure-store:save-user', async (event, userData) => {
    try {
      // v1.3.86 (Phase C): фикс типа `setUser` → `saveUser`. Метод в
      // secureStore.js называется `saveUser` (см. строку 191), `setUser`
      // никогда не существовал. До v1.3.86 этот IPC всегда падал с
      // "setUser is not a function" — secureStore.getUser() возвращал
      // null, поэтому main process не имел доступа к user info для Sentry.
      secureStore.saveUser(userData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('secure-store:get-user', async () => {
    try {
      const user = secureStore.getUser();
      return { success: true, user };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('secure-store:is-authenticated', async () => {
    try {
      const isAuth = secureStore.isAuthenticated();
      return { success: true, isAuthenticated: isAuth };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('secure-store:clear', async () => {
    try {
      secureStore.clearAll();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  console.log('[IPC:SecureStore] Handlers registered');
}

module.exports = { registerSecureStoreHandlers };
