/**
 * Audio IPC Handlers
 * Управление громкостью, audio cache, сохранение аудио
 */

const { ipcMain, app } = require('electron');

function registerAudioHandlers(deps) {
  const { audioCacheManager } = deps;

  let originalVolume = null;
  let winAudio = null;

  // Инициализация win-audio только на Windows.
  // win-audio это N-API binding (audio-napi.cc) — ABI-stable, должен работать
  // в любой версии Electron без пересборки. Если в логах появится «Failed to
  // initialize» — это серьёзный сигнал, надо смотреть native module.
  if (process.platform === 'win32') {
    try {
      winAudio = require('win-audio');
      if (winAudio && winAudio.speaker) {
        winAudio.speaker.start(200);
        console.log('[IPC:Audio] win-audio initialized successfully (N-API)');
      } else {
        console.warn('[IPC:Audio] win-audio loaded but speaker is missing — module may be broken');
        winAudio = null;
      }
    } catch (error) {
      console.error('[IPC:Audio] Failed to initialize win-audio (audio ducking will be disabled):', error.message);
      winAudio = null;
    }
  }

  // ============ AUDIO CONTROL ============
  ipcMain.handle('mute-system-audio', async () => {
    console.log('[Audio Ducking] mute-system-audio called, platform:', process.platform, 'winAudio:', !!winAudio);
    try {
      if (process.platform !== 'win32' || !winAudio || !winAudio.speaker) {
        console.log('[Audio Ducking] Skipped - not Windows or no win-audio');
        return { success: true, method: 'not-windows' };
      }

      const currentVolume = winAudio.speaker.get();
      console.log('[Audio Ducking] Current volume:', currentVolume);
      if (currentVolume !== null && currentVolume !== undefined) {
        originalVolume = currentVolume;
        const duckedVolume = Math.floor(currentVolume * 0.3);
        winAudio.speaker.set(duckedVolume);
        console.log('[Audio Ducking] Volume ducked from', originalVolume, 'to', duckedVolume);
        return { success: true, method: 'ducking', originalVolume, duckedVolume };
      }

      console.log('[Audio Ducking] Could not get volume');
      return { success: false, error: 'Could not get volume' };
    } catch (error) {
      console.error('[Audio Ducking] Error ducking audio:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('unmute-system-audio', async () => {
    console.log('[Audio Ducking] unmute-system-audio called, originalVolume:', originalVolume);
    try {
      if (process.platform !== 'win32' || !winAudio || !winAudio.speaker) {
        console.log('[Audio Ducking] Skipped restore - not Windows or no win-audio');
        return { success: true, method: 'not-windows' };
      }

      if (originalVolume !== null && originalVolume !== undefined) {
        winAudio.speaker.set(originalVolume);
        const restoredVolume = originalVolume;
        originalVolume = null;
        console.log('[Audio Ducking] Volume restored to', restoredVolume);
        return { success: true, method: 'restored', volume: restoredVolume };
      }

      console.log('[Audio Ducking] No original volume saved');
      return { success: false, error: 'No original volume saved' };
    } catch (error) {
      console.error('[Audio Ducking] Error restoring audio:', error);
      return { success: false, error: error.message };
    }
  });

  // ============ AUDIO CACHE ============
  ipcMain.handle('audio-cache:save', async (event, audioBuffer, metadata) => {
    try {
      const buffer = Buffer.from(audioBuffer);
      const id = await audioCacheManager.saveAudio(buffer, metadata);
      return { success: true, id };
    } catch (error) {
      console.error('[IPC] Error saving audio to cache:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('audio-cache:get', async (event, id) => {
    try {
      console.log('[IPC] audio-cache:get called with id:', id);
      const audioBuffer = await audioCacheManager.getAudio(id);
      if (!audioBuffer) {
        console.log('[IPC] Audio not found for id:', id);
        return { success: false, error: 'Audio not found' };
      }
      console.log('[IPC] Audio found, buffer size:', audioBuffer.length);
      return { success: true, buffer: audioBuffer };
    } catch (error) {
      console.error('[IPC] Error getting audio from cache:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('audio-cache:mark-success', async (event, id, transcriptionId) => {
    try {
      audioCacheManager.markAsSuccess(id, transcriptionId);
      return { success: true };
    } catch (error) {
      console.error('[IPC] Error marking audio as success:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('audio-cache:mark-failed', async (event, id, errorMessage = null) => {
    try {
      audioCacheManager.markAsFailed(id, errorMessage);
      return { success: true };
    } catch (error) {
      console.error('[IPC] Error marking audio as failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('audio-cache:reset-retries', async (event, id) => {
    try {
      audioCacheManager.resetRetries(id);
      return { success: true };
    } catch (error) {
      console.error('[IPC] Error resetting retries:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('audio-cache:get-failed', async () => {
    try {
      const failed = audioCacheManager.getFailedRecordings();
      return { success: true, recordings: failed };
    } catch (error) {
      console.error('[IPC] Error getting failed recordings:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('audio-cache:get-all', async () => {
    try {
      const all = audioCacheManager.getAllRecordings();
      return { success: true, recordings: all };
    } catch (error) {
      console.error('[IPC] Error getting all recordings:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('audio-cache:get-metadata', async (event, id) => {
    try {
      const metadata = audioCacheManager.getMetadata(id);
      return { success: true, metadata };
    } catch (error) {
      console.error('[IPC] Error getting metadata:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('audio-cache:delete', async (event, id) => {
    try {
      await audioCacheManager.deleteFile(id);
      return { success: true };
    } catch (error) {
      console.error('[IPC] Error deleting audio file:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('audio-cache:get-stats', async () => {
    try {
      const stats = audioCacheManager.getStats();
      return { success: true, stats };
    } catch (error) {
      console.error('[IPC] Error getting stats:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('audio-cache:cleanup', async () => {
    try {
      await audioCacheManager.cleanup();
      return { success: true };
    } catch (error) {
      console.error('[IPC] Error cleaning up audio cache:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('audio-cache:find-by-transcription-id', async (event, transcriptionId) => {
    try {
      const cacheId = audioCacheManager.findByTranscriptionId(transcriptionId);
      return { success: true, cacheId };
    } catch (error) {
      console.error('[IPC] Error finding audio by transcription ID:', error);
      return { success: false, error: error.message };
    }
  });

  // ============ SAVE AUDIO FILE ============
  ipcMain.handle('save-audio-file', async (event, { fileName, buffer }) => {
    const fs = require('fs');
    const path = require('path');

    try {
      const userDataPath = app.getPath('userData');
      const recordingsDir = path.join(userDataPath, 'recordings');

      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true });
      }

      const filePath = path.join(recordingsDir, fileName);
      const audioBuffer = Buffer.from(buffer);
      fs.writeFileSync(filePath, audioBuffer);

      console.log(`[IPC] Audio file saved: ${filePath} (${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

      return filePath;
    } catch (error) {
      console.error('[IPC] Failed to save audio file:', error);
      throw error;
    }
  });

  console.log('[IPC:Audio] Handlers registered');
}

module.exports = { registerAudioHandlers };
