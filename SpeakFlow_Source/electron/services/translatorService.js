/**
 * Real-time Translator Service
 * Управление WebSocket сессией с backend translator'ом
 * - Захват аудио с микрофона и конференции
 * - Отправка на перевод
 * - Воспроизведение синтезированного звука
 */

const WebSocket = require('ws');
const { EventEmitter } = require('events');

class TranslatorService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.ws = null;
    this.sessionId = null;
    this.isConnected = false;
    this.isRecording = false;
    this.initSent = false;

    // Конфигурация
    this.config = {
      apiUrl: config.apiUrl || 'ws://localhost:4000/ws/translator/session',
      sourceLang: config.sourceLang || 'ru',  // Язык пользователя
      targetLang: config.targetLang || 'en',  // Язык конференции
      autoReconnect: config.autoReconnect !== false,
      reconnectInterval: config.reconnectInterval || 5000,
      ...config
    };

    // Состояние
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimeout = null;
  }

  /**
   * Подключиться к translator backend
   */
  async connect(accessToken) {
    return new Promise((resolve, reject) => {
      try {
        // Сбрасываем флаг при новом подключении
        this.initSent = false;

        console.log('[TranslatorService] Connecting to:', this.config.apiUrl);

        // Подготовим URL с параметрами
        const url = new URL(this.config.apiUrl);
        url.searchParams.set('token', accessToken);
        url.searchParams.set('sourceLang', this.config.sourceLang);
        url.searchParams.set('targetLang', this.config.targetLang);

        this.ws = new WebSocket(url.toString());

        // Флаг для отправки init только после получения status
        let initSent = false;

        // Обработка открытия подключения
        this.ws.on('open', () => {
          console.log('[TranslatorService] ✅ WebSocket OPEN event');
          console.log('[TranslatorService] Connected to translator backend');
          this.isConnected = true;
          this.reconnectAttempts = 0;

          // НЕ отправляем init сразу - ждём status от backend
          console.log('[TranslatorService] Waiting for status message before sending init...');

          this.emit('connected');
          resolve();
        });

        // Обработка сообщений от сервера
        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data);
            this.handleMessage(message);
          } catch (error) {
            console.error('[TranslatorService] Error parsing message:', error);
          }
        });

        // Обработка ошибок
        this.ws.on('error', (error) => {
          console.error('[TranslatorService] WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        });

        // Обработка закрытия соединения
        this.ws.on('close', (code, reason) => {
          console.log(`[TranslatorService] ❌ WebSocket CLOSE event: code=${code}, reason=${reason}`);
          console.log('[TranslatorService] Disconnected from translator backend');
          this.isConnected = false;
          this.emit('disconnected');

          // Попытка переподключения
          if (this.config.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`[TranslatorService] Reconnecting... (attempt ${this.reconnectAttempts})`);
            this.reconnectTimeout = setTimeout(() => {
              this.connect(accessToken).catch(err => console.error('[TranslatorService] Reconnect failed:', err));
            }, this.config.reconnectInterval);
          }
        });

      } catch (error) {
        console.error('[TranslatorService] Connection error:', error);
        reject(error);
      }
    });
  }

  /**
   * Обработка входящих сообщений от backend
   */
  handleMessage(message) {
    switch (message.type) {
      case 'status':
        console.log('[TranslatorService] Status:', message.message);

        // Отправляем init после получения status (чтобы backend успел зарегистрировать обработчик)
        if (this.ws && this.ws.readyState === 1 && !this.initSent) {
          const initMessage = {
            type: 'init',
            sourceLang: this.config.sourceLang,
            targetLang: this.config.targetLang
          };
          console.log('[TranslatorService] 📤 Sending init message (after status):', JSON.stringify(initMessage));
          this.ws.send(JSON.stringify(initMessage));
          this.initSent = true;
          console.log('[TranslatorService] ✅ Init message sent');
        }

        this.emit('status', message);
        break;

      case 'session_ready':
        this.sessionId = message.sessionId;
        console.log('[TranslatorService] Session ready:', this.sessionId);
        this.emit('session_ready', { sessionId: this.sessionId });
        break;

      case 'audio_to_conference':
        // Переведённый голос пользователя для конференции
        console.log('[TranslatorService] Audio for conference received');
        this.emit('audio_to_conference', {
          audio: message.audio,  // Base64 encoded
          text: message.text     // Translated text for subtitles
        });
        break;

      case 'audio_to_user':
        // Переведённый голос конференции для пользователя
        console.log('[TranslatorService] Audio for user received');
        this.emit('audio_to_user', {
          audio: message.audio,
          text: message.text
        });
        break;

      case 'status':
        console.log('[TranslatorService] Status:', message.message);
        this.emit('status', message);
        break;

      case 'error':
        console.error('[TranslatorService] Backend error:', message.error);
        this.emit('backend_error', message);
        break;

      default:
        console.warn('[TranslatorService] Unknown message type:', message.type);
    }
  }

  /**
   * Отправить аудио с микрофона пользователя
   */
  sendMicAudio(audioBuffer) {
    if (!this.isConnected || !this.ws) {
      console.warn('[TranslatorService] Not connected, cannot send mic audio');
      return false;
    }

    try {
      const base64Audio = audioBuffer.toString('base64');
      this.ws.send(JSON.stringify({
        type: 'audio_mic',
        sessionId: this.sessionId,
        audio: base64Audio
      }));
      return true;
    } catch (error) {
      console.error('[TranslatorService] Error sending mic audio:', error);
      return false;
    }
  }

  /**
   * Отправить аудио из конференции
   */
  sendConferenceAudio(audioBuffer) {
    if (!this.isConnected || !this.ws) {
      console.warn('[TranslatorService] Not connected, cannot send conference audio');
      return false;
    }

    try {
      const base64Audio = audioBuffer.toString('base64');
      this.ws.send(JSON.stringify({
        type: 'audio_conference',
        sessionId: this.sessionId,
        audio: base64Audio
      }));
      return true;
    } catch (error) {
      console.error('[TranslatorService] Error sending conference audio:', error);
      return false;
    }
  }

  /**
   * Начать запись и трансляцию
   */
  startRecording() {
    if (this.isRecording) {
      console.warn('[TranslatorService] Already recording');
      return false;
    }
    this.isRecording = true;
    this.emit('recording_started');
    return true;
  }

  /**
   * Остановить запись
   */
  stopRecording() {
    if (!this.isRecording) {
      console.warn('[TranslatorService] Not recording');
      return false;
    }
    this.isRecording = false;
    this.emit('recording_stopped');
    return true;
  }

  /**
   * Изменить языки
   */
  setLanguages(sourceLang, targetLang) {
    this.config.sourceLang = sourceLang;
    this.config.targetLang = targetLang;
    console.log(`[TranslatorService] Languages changed: ${sourceLang} → ${targetLang}`);
    this.emit('languages_changed', { sourceLang, targetLang });
  }

  /**
   * Отключиться от backend
   */
  disconnect() {
    return new Promise((resolve) => {
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      if (!this.ws) {
        resolve();
        return;
      }

      // Отправляем close сообщение перед закрытием
      try {
        this.ws.send(JSON.stringify({
          type: 'close',
          sessionId: this.sessionId
        }));
      } catch (error) {
        console.error('[TranslatorService] Error sending close message:', error);
      }

      // Закрываем соединение
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.isRecording = false;

      // Даём время на graceful shutdown
      setTimeout(resolve, 500);
    });
  }

  /**
   * Получить текущее состояние
   */
  getState() {
    return {
      isConnected: this.isConnected,
      isRecording: this.isRecording,
      sessionId: this.sessionId,
      sourceLang: this.config.sourceLang,
      targetLang: this.config.targetLang,
      apiUrl: this.config.apiUrl
    };
  }
}

module.exports = TranslatorService;
