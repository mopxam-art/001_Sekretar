/**
 * Translator IPC Handlers
 * Обработчики IPC событий для управления real-time переводчиком
 */

const { ipcMain } = require('electron');
const TranslatorService = require('../services/translatorService');

let translatorService = null;

/**
 * Регистрация всех translator handlers
 */
function registerTranslatorHandlers(deps) {
  const {
    windowManager,
    secureStore,
    persistentStore,
    API_URL
  } = deps;

  // ============ TRANSLATOR SESSION ============

  /**
   * Инициализировать translator сессию
   */
  ipcMain.handle('translator:init-session', async (event, config) => {
    try {
      console.log('[TranslatorHandlers] Initializing translator session:', config);

      // Получаем access token
      console.log('[TranslatorHandlers] Calling secureStore.getTokens()...');
      const tokens = secureStore.getTokens();
      console.log('[TranslatorHandlers] Tokens result:', tokens ? 'FOUND' : 'NULL');

      if (!tokens || !tokens.accessToken) {
        console.error('[TranslatorHandlers] Authentication failed - no tokens available');
        return { success: false, error: 'Not authenticated' };
      }

      console.log('[TranslatorHandlers] Access token OK, proceeding...');

      // Конвертируем HTTP URL в WebSocket
      const wsUrl = API_URL.replace('http', 'ws') + '/ws/translator/session';

      // Инициализируем сервисы если это первый раз
      if (!translatorService) {
        translatorService = new TranslatorService({
          apiUrl: wsUrl,
          sourceLang: config.sourceLang || 'ru',
          targetLang: config.targetLang || 'en',
          autoReconnect: false  // Отключаем автореконнект
        });

        // Слушаем события от TranslatorService
        translatorService.on('session_ready', (data) => {
          if (windowManager && windowManager.mainWindow) {
            windowManager.mainWindow.webContents.send('translator:session-ready', data);
          }
        });

        translatorService.on('audio_to_conference', (data) => {
          if (windowManager && windowManager.mainWindow) {
            windowManager.mainWindow.webContents.send('translator:audio-to-conference', data);
          }
          // Воспроизводим аудио локально
          if (audioPlaybackService && audioPlaybackService.isPlaying === false) {
            audioPlaybackService.playAudio(data.audio, 'conference');
          }
        });

        translatorService.on('audio_to_user', (data) => {
          if (windowManager && windowManager.mainWindow) {
            windowManager.mainWindow.webContents.send('translator:audio-to-user', data);
          }
          // Воспроизводим аудио локально
          if (audioPlaybackService && audioPlaybackService.isPlaying === false) {
            audioPlaybackService.playAudio(data.audio, 'user');
          }
        });

        translatorService.on('error', (error) => {
          if (windowManager && windowManager.mainWindow) {
            windowManager.mainWindow.webContents.send('translator:error', {
              error: error.message || error.toString()
            });
          }
        });

        translatorService.on('disconnected', () => {
          if (windowManager && windowManager.mainWindow) {
            windowManager.mainWindow.webContents.send('translator:disconnected');
          }
        });
      }

      // Подключаемся к backend
      await translatorService.connect(tokens.accessToken);

      // NOTE: Audio capture и playback будут происходить в renderer процессе
      // так как в main процессе нет Web Audio API

      // Сохраняем конфигурацию в electron-store
      persistentStore.set('translatorConfig', {
        sourceLang: config.sourceLang || 'ru',
        targetLang: config.targetLang || 'en',
        volume: config.volume || 0.8
      });

      return {
        success: true,
        message: 'Translator session initialized',
        sessionId: translatorService.sessionId
      };

    } catch (error) {
      console.error('[TranslatorHandlers] Session init error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**\
   * Начать запись и перевод
   */
  ipcMain.handle('translator:start', async () => {
    try {
      if (!translatorService) {
        return { success: false, error: 'Translator not initialized' };
      }

      // NOTE: Audio capture будет происходить в renderer процессе
      // используя Web Audio API, так как в main процессе нет доступа к navigator.mediaDevices

      // Отмечаем что идёт запись
      translatorService.startRecording();

      console.log('[TranslatorHandlers] Translator started (audio capture handled in renderer)');
      return { success: true, message: 'Translator started' };

    } catch (error) {
      console.error('[TranslatorHandlers] Start error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Остановить запись и перевод
   */
  ipcMain.handle('translator:stop', async () => {
    try {
      if (!translatorService) {
        return { success: false, error: 'Translator not initialized' };
      }

      translatorService.stopRecording();
      // audioCaptureService handled in renderer

      console.log('[TranslatorHandlers] Translator stopped');
      return { success: true, message: 'Translator stopped' };

    } catch (error) {
      console.error('[TranslatorHandlers] Stop error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Закрыть переводчик сессию
   */
  ipcMain.handle('translator:close-session', async () => {
    try {
      // audioCaptureService handled in renderer now
      // Commented out to avoid ReferenceError
      // if (audioCaptureService && audioCaptureService.isCapturing) {
      //   audioCaptureService.stopCapturing();
      // }

      if (translatorService) {
        await translatorService.disconnect();
      }

      translatorService = null;

      console.log('[TranslatorHandlers] Session closed');
      return { success: true, message: 'Session closed' };

    } catch (error) {
      console.error('[TranslatorHandlers] Session close error:', error);
      return { success: false, error: error.message };
    }
  });

  // ============ TRANSLATOR SETTINGS ============

  /**
   * Изменить языки перевода
   */
  ipcMain.handle('translator:set-languages', async (event, { sourceLang, targetLang }) => {
    try {
      if (!translatorService) {
        return { success: false, error: 'Translator not initialized' };
      }

      translatorService.setLanguages(sourceLang, targetLang);

      // Сохраняем в store
      const config = persistentStore.get('translatorConfig', {});
      persistentStore.set('translatorConfig', {
        ...config,
        sourceLang,
        targetLang
      });

      return { success: true, message: 'Languages updated' };

    } catch (error) {
      console.error('[TranslatorHandlers] Set languages error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Установить громкость
   */
  ipcMain.handle('translator:set-volume', async (event, volume) => {
    try {
      // Сохраняем в store (playback handled in renderer)
      const config = persistentStore.get('translatorConfig', {});
      persistentStore.set('translatorConfig', {
        ...config,
        volume
      });

      return { success: true, volume };

    } catch (error) {
      console.error('[TranslatorHandlers] Set volume error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Получить конфигурацию
   */
  ipcMain.handle('translator:get-config', async () => {
    try {
      const config = persistentStore.get('translatorConfig', {
        sourceLang: 'ru',
        targetLang: 'en',
        volume: 0.8
      });

      const translatorState = translatorService ? translatorService.getState() : null;

      return {
        success: true,
        config,
        translator: translatorState,
        capture: null, // Handled in renderer
        playback: null // Handled in renderer
      };

    } catch (error) {
      console.error('[TranslatorHandlers] Get config error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Установить пороги определения источника (микрофон vs конференция)
   */
  ipcMain.handle('translator:set-source-thresholds', async (event, { micThreshold, confThreshold }) => {
    try {
      if (!audioCaptureService) {
        return { success: false, error: 'Audio capture not initialized' };
      }

      audioCaptureService.setSourceThresholds(micThreshold, confThreshold);

      return { success: true, message: 'Thresholds updated' };

    } catch (error) {
      console.error('[TranslatorHandlers] Set thresholds error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Получить состояние переводчика
   */
  ipcMain.handle('translator:get-state', async () => {
    try {
      return {
        success: true,
        translator: translatorService ? translatorService.getState() : null,
        capture: null, // Handled in renderer
        playback: audioPlaybackService ? audioPlaybackService.getState() : null
      };

    } catch (error) {
      console.error('[TranslatorHandlers] Get state error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Отправить аудио с микрофона (из renderer процесса)
   */
  let audioPacketCount = 0;
  ipcMain.handle('translator:send-mic-audio', async (event, audioBuffer) => {
    try {
      if (!translatorService || !translatorService.isRecording) {
        return { success: false, error: 'Not recording' };
      }

      const buffer = Buffer.from(audioBuffer);

      // Логируем каждые 50 пакетов
      audioPacketCount++;
      if (audioPacketCount % 50 === 0) {
        console.log(`[TranslatorHandlers] Sent audio packet #${audioPacketCount}, size: ${buffer.length} bytes`);
      }

      translatorService.sendMicAudio(buffer);
      return { success: true };

    } catch (error) {
      console.error('[TranslatorHandlers] Send mic audio error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Отправить аудио из конференции (из renderer процесса)
   */
  ipcMain.handle('translator:send-conference-audio', async (event, audioBuffer) => {
    try {
      if (!translatorService || !translatorService.isRecording) {
        return { success: false, error: 'Not recording' };
      }

      const buffer = Buffer.from(audioBuffer);
      translatorService.sendConferenceAudio(buffer);
      return { success: true };

    } catch (error) {
      console.error('[TranslatorHandlers] Send conference audio error:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerTranslatorHandlers
};
