/**
 * Meeting Cache IPC Handlers (v1.3.75 батч 2 / B1)
 *
 * IPC handlers для meeting-cache:* каналов. Renderer общается через
 * services/meetingCache.ts → window.electronAPI.meetingCache* → эти handlers
 * → meetingCacheManager singleton.
 *
 * Все методы возвращают { success: boolean, ... } pattern (как audioHandlers).
 */

const { ipcMain, Notification } = require('electron');
const meetingCacheManager = require('../../meetingCacheManager');

function registerMeetingHandlers(_deps) {
  ipcMain.handle('meeting-cache:save-initial', async (_e, data) => {
    try {
      const id = meetingCacheManager.saveInitialMetadata(data);
      return { success: true, id };
    } catch (error) {
      console.error('[IPC] meeting-cache:save-initial error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('meeting-cache:mark-upload-success', async (_e, id, transcript) => {
    try {
      const ok = meetingCacheManager.markUploadSuccess(id, transcript);
      return { success: ok };
    } catch (error) {
      console.error('[IPC] meeting-cache:mark-upload-success error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('meeting-cache:mark-analysis-success', async (_e, id, report) => {
    try {
      const ok = meetingCacheManager.markAnalysisSuccess(id, report);
      return { success: ok };
    } catch (error) {
      console.error('[IPC] meeting-cache:mark-analysis-success error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('meeting-cache:mark-note-created', async (_e, id, noteId) => {
    try {
      const ok = meetingCacheManager.markNoteCreated(id, noteId);
      return { success: ok };
    } catch (error) {
      console.error('[IPC] meeting-cache:mark-note-created error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('meeting-cache:mark-failed', async (_e, id, step, errorMessage) => {
    try {
      const ok = meetingCacheManager.markAsFailed(id, step, errorMessage);
      return { success: ok };
    } catch (error) {
      console.error('[IPC] meeting-cache:mark-failed error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('meeting-cache:get-pending', async (_e, userId) => {
    try {
      const meetings = meetingCacheManager.getPendingMeetings(userId || null);
      return { success: true, meetings };
    } catch (error) {
      console.error('[IPC] meeting-cache:get-pending error:', error);
      return { success: false, error: error.message, meetings: [] };
    }
  });

  ipcMain.handle('meeting-cache:get-all', async (_e, userId) => {
    try {
      const meetings = meetingCacheManager.getAllMeetings(userId || null);
      return { success: true, meetings };
    } catch (error) {
      console.error('[IPC] meeting-cache:get-all error:', error);
      return { success: false, error: error.message, meetings: [] };
    }
  });

  ipcMain.handle('meeting-cache:get', async (_e, id) => {
    try {
      const metadata = meetingCacheManager.getMetadata(id);
      return { success: true, metadata };
    } catch (error) {
      console.error('[IPC] meeting-cache:get error:', error);
      return { success: false, error: error.message, metadata: null };
    }
  });

  ipcMain.handle('meeting-cache:delete', async (_e, id, alsoDeleteFile) => {
    try {
      const ok = await meetingCacheManager.deleteMetadata(id, alsoDeleteFile === true);
      return { success: ok };
    } catch (error) {
      console.error('[IPC] meeting-cache:delete error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('meeting-cache:cleanup', async () => {
    try {
      const cleaned = await meetingCacheManager.cleanup();
      return { success: true, cleaned };
    } catch (error) {
      console.error('[IPC] meeting-cache:cleanup error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('meeting-cache:cleanup-foreign-users', async (_e, currentUserId) => {
    try {
      const removed = meetingCacheManager.cleanupForeignUsers(currentUserId);
      return { success: true, removed };
    } catch (error) {
      console.error('[IPC] meeting-cache:cleanup-foreign-users error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('meeting-cache:get-stats', async () => {
    try {
      return { success: true, stats: meetingCacheManager.getStats() };
    } catch (error) {
      console.error('[IPC] meeting-cache:get-stats error:', error);
      return { success: false, error: error.message };
    }
  });

  // v1.3.84 (23.05.2026): Native OS notification для длинной записи.
  // Юзер обычно ведёт встречу в свёрнутом приложении (Zoom/Teams в фокусе) —
  // in-app нудж А.7 не виден. Native notification всплывает в правом нижнем углу
  // Windows + звук. Один pus на каждый порог (dedup в renderer через Set).
  ipcMain.handle('meeting:show-notification', async (_e, { threshold, sizeMB }) => {
    try {
      const messages = {
        '60min': {
          title: 'SpeakFlow — длинная запись',
          body: 'Запись больше 1 часа. Можно остановить и начать новую — обработается быстрее.',
        },
        '90min': {
          title: 'SpeakFlow — рекомендуем остановить',
          body: `Длинная запись (~${sizeMB || '?'} МБ). Лучше остановить и начать новую — надёжнее обработка.`,
        },
        '120min': {
          title: 'SpeakFlow — очень длинная запись',
          body: `Запись ~${sizeMB || '?'} МБ. Загрузка займёт 3-10 минут. Файл сохранён локально, не потеряется.`,
        },
      };
      const config = messages[threshold];
      if (!config) {
        return { success: false, error: 'Unknown threshold' };
      }
      if (!Notification.isSupported()) {
        console.warn('[IPC:Meeting] Notification not supported on this OS');
        return { success: false, error: 'Not supported' };
      }
      new Notification({
        title: config.title,
        body: config.body,
        silent: false,  // со звуком — юзер должен заметить
      }).show();
      return { success: true };
    } catch (error) {
      console.error('[IPC:Meeting] show-notification error:', error);
      return { success: false, error: error.message };
    }
  });

  // Запускаем backup interval при регистрации handlers (один раз)
  meetingCacheManager.startBackupInterval();

  console.log('[IPC:Meeting] Handlers registered');
}

module.exports = { registerMeetingHandlers };
