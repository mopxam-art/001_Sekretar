/**
 * Hotkey IPC Handlers
 * Все горячие клавиши: запись, перевод, undo, tab-complete
 */

const { ipcMain } = require('electron');

function registerHotkeyHandlers(deps) {
  const { hotkeysManager, persistentStore } = deps;

  // ============ RECORDING HOTKEYS ============
  ipcMain.handle('set-hotkey', async (event, newHotkey, mode) => {
    try {
      console.log('[IPC] set-hotkey called with:', newHotkey, mode);
      // Шаг 5.5: не биндим неразрешимый триггер (только модификаторы / пусто) —
      // иначе перезапишем рабочий хоткей мёртвым.
      if (!require('../../utils/hotkeyMatch').hasRecordingTrigger(newHotkey)) {
        return { success: false, error: 'Хоткей должен содержать клавишу помимо модификаторов' };
      }
      hotkeysManager.setRecordingHotkey(newHotkey);
      if (mode) {
        hotkeysManager.setRecordingMode(mode);
      }
      console.log('[IPC] set-hotkey success');
      return { success: true, hotkey: newHotkey, mode };
    } catch (error) {
      console.error('[IPC] set-hotkey error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-hotkey', async () => {
    const settings = hotkeysManager.getSettings();
    return settings.recordingHotkey;
  });

  ipcMain.handle('get-recording-mode', async () => {
    const settings = hotkeysManager.getSettings();
    return settings.recordingMode;
  });

  ipcMain.handle('set-recording-mode', async (event, mode) => {
    try {
      hotkeysManager.setRecordingMode(mode);
      return { success: true, mode };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============ TRANSLATION HOTKEYS ============
  ipcMain.handle('set-translation-hotkey', async (event, newHotkey) => {
    try {
      hotkeysManager.setTranslationHotkey(newHotkey);
      return { success: true, hotkey: newHotkey };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-translation-hotkey', async () => {
    const settings = hotkeysManager.getSettings();
    return settings.translationHotkey;
  });

  // ============ HOTKEY MANAGEMENT ============
  ipcMain.handle('reinitialize-hotkeys', async () => {
    try {
      hotkeysManager.setupKeyboardListener();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-hotkeys-status', async () => {
    try {
      return hotkeysManager.getStatus();
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('force-restart-hotkeys', async () => {
    try {
      return hotkeysManager.forceRestart();
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('pause-hotkeys', async () => {
    try {
      return hotkeysManager.pause();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('resume-hotkeys', async () => {
    try {
      return hotkeysManager.resume();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============ UNDO HOTKEY ============
  ipcMain.handle('get-undo-hotkey', async () => {
    const settings = hotkeysManager.getSettings();
    return settings.undoHotkey;
  });

  ipcMain.handle('set-undo-hotkey', async (event, newHotkey) => {
    try {
      hotkeysManager.setUndoHotkey(newHotkey);
      return { success: true, hotkey: newHotkey };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============ TAB-COMPLETE HOTKEY ============
  ipcMain.handle('get-tab-complete-hotkey', async () => {
    const settings = hotkeysManager.getSettings();
    return settings.tabCompleteHotkey;
  });

  ipcMain.handle('set-tab-complete-hotkey', async (event, newHotkey) => {
    try {
      hotkeysManager.setTabCompleteHotkey(newHotkey);
      return { success: true, hotkey: newHotkey };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('set-tab-complete-enabled', async (event, enabled) => {
    try {
      hotkeysManager.setTabCompleteEnabled(enabled);
      persistentStore.set('tab_complete_enabled', enabled);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============ UNIFIED MEMORY HOTKEY ============
  ipcMain.handle('get-unified-memory-hotkey', async () => {
    const settings = hotkeysManager.getSettings();
    return settings.unifiedMemoryHotkey;
  });

  ipcMain.handle('set-unified-memory-hotkey', async (event, newHotkey) => {
    try {
      hotkeysManager.setUnifiedMemoryHotkey(newHotkey);
      return { success: true, hotkey: newHotkey };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  console.log('[IPC:Hotkey] Handlers registered');
}

module.exports = { registerHotkeyHandlers };
