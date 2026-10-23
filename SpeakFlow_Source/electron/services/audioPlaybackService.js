/**
 * Audio Playback Service
 * Воспроизведение синтезированного аудио через системные динамики
 * - Декодирует Base64 аудио буферы
 * - Воспроизводит через Web Audio API
 * - Поддерживает паузу, resume, stop
 */

const { EventEmitter } = require('events');

class AudioPlaybackService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.audioContext = null;
    this.audioSource = null;
    this.gainNode = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.currentAudioBuffer = null;

    this.config = {
      sampleRate: config.sampleRate || 16000,
      volume: config.volume || 0.8, // 0 - 1
      ...config
    };
  }

  /**
   * Инициализировать AudioContext
   */
  async initialize() {
    try {
      const audioContextClass = (typeof window !== 'undefined')
        ? (window.AudioContext || window.webkitAudioContext)
        : null;

      if (!audioContextClass) {
        throw new Error('AudioContext not available');
      }

      this.audioContext = new audioContextClass({ sampleRate: this.config.sampleRate });

      // Создаём gain node для контроля громкости
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.config.volume;
      this.gainNode.connect(this.audioContext.destination);

      console.log('[AudioPlayback] Initialized');
      this.emit('initialized');
      return true;

    } catch (error) {
      console.error('[AudioPlayback] Initialization error:', error);
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Декодировать Base64 аудио в Float32Array
   */
  decodeBase64Audio(base64String) {
    try {
      // Декодируем Base64
      const binaryString = atob(base64String);
      const bytes = new Uint8Array(binaryString.length);

      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Интерпретируем как 16-bit PCM audio
      const audioData = new Int16Array(bytes.buffer);

      // Конвертируем в Float32Array (Web Audio работает с float)
      const floatData = new Float32Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        floatData[i] = audioData[i] / 32768; // Нормализуем в диапазон -1..1
      }

      return floatData;

    } catch (error) {
      console.error('[AudioPlayback] Error decoding audio:', error);
      throw error;
    }
  }

  /**
   * Воспроизвести аудио (Base64 encoded)
   */
  async playAudio(base64Audio, sourceType = 'unknown') {
    try {
      if (!this.audioContext) {
        await this.initialize();
      }

      // Декодируем аудио
      const audioData = this.decodeBase64Audio(base64Audio);

      // Создаём AudioBuffer
      const audioBuffer = this.audioContext.createBuffer(
        1, // mono
        audioData.length,
        this.config.sampleRate
      );

      audioBuffer.getChannelData(0).set(audioData);

      // Сохраняем текущий буфер
      this.currentAudioBuffer = audioBuffer;

      // Создаём BufferSource
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;

      // Подключаем к выходу
      source.connect(this.gainNode);

      // Шаг 4 (v1.3.89): сохраняем ссылку на источник, чтобы stop() мог его
      // реально остановить (раньше ссылка терялась → звук доигрывал до конца).
      this.currentSource = source;

      // Обработка события окончания
      source.onended = () => {
        this.isPlaying = false;
        this.currentSource = null;
        this.emit('playback_ended', { sourceType });
      };

      // Запускаем воспроизведение
      source.start(0);
      this.isPlaying = true;
      this.isPaused = false;

      console.log(`[AudioPlayback] Playing audio (${sourceType})`);
      this.emit('playback_started', { sourceType, duration: audioBuffer.duration });

      return true;

    } catch (error) {
      console.error('[AudioPlayback] Error playing audio:', error);
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Остановить воспроизведение
   */
  stop() {
    if (!this.isPlaying) {
      return false;
    }

    try {
      // Шаг 4 (v1.3.89): реально останавливаем источник (раньше был TODO —
      // звук доигрывал до конца). stop(0) на уже завершённом источнике
      // безопасен внутри try.
      try { this.currentSource?.stop(0); } catch (_) { /* уже остановлен/завершён */ }
      this.currentSource = null;
      this.isPlaying = false;
      this.isPaused = false;

      console.log('[AudioPlayback] Playback stopped');
      this.emit('playback_stopped');
      return true;

    } catch (error) {
      console.error('[AudioPlayback] Error stopping playback:', error);
      return false;
    }
  }

  /**
   * Установить громкость (0 - 1)
   */
  setVolume(volume) {
    if (volume < 0 || volume > 1) {
      console.warn('[AudioPlayback] Volume must be between 0 and 1');
      return false;
    }

    try {
      this.config.volume = volume;
      if (this.gainNode) {
        this.gainNode.gain.value = volume;
      }
      console.log(`[AudioPlayback] Volume set to ${(volume * 100).toFixed(0)}%`);
      return true;

    } catch (error) {
      console.error('[AudioPlayback] Error setting volume:', error);
      return false;
    }
  }

  /**
   * Получить текущий уровень громкости
   */
  getVolume() {
    return this.config.volume;
  }

  /**
   * Получить состояние
   */
  getState() {
    return {
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      volume: this.config.volume,
      sampleRate: this.config.sampleRate
    };
  }
}

// Экспортируем для использования в Node.js (main process)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioPlaybackService;
}
