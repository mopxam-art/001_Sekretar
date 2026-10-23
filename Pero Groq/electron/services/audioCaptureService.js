/**
 * Audio Capture Service
 * Захват аудио из микрофона и конференции
 * - Захватывает системный аудио через переданный AudioContext
 * - Определяет источник (микрофон vs конференция) по характеристикам сигнала
 * - Отправляет буферы в TranslatorService
 *
 * ВАЖНО: Этот сервис может работать как в main процессе (Electron),
 * так и в renderer процессе (Web Audio API). Логика одинакова.
 */

const { EventEmitter } = require('events');

class AudioCaptureService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.isCapturing = false;
    this.audioContext = null;
    this.mediaStream = null;
    this.analyser = null;
    this.scriptProcessor = null;
    this.source = null;

    this.config = {
      sampleRate: config.sampleRate || 16000,
      channelCount: config.channelCount || 1,
      bufferSize: config.bufferSize || 4096,
      deviceId: config.deviceId || null, // ID устройства для захвата
      ...config
    };

    // Состояние для определения источника
    this.sourceDetector = {
      micThreshold: 0.02,      // Порог энергии для микрофона (сильный голос)
      confThreshold: 0.005,    // Порог энергии для конференции (фоновый звук)
      silenceDuration: 0,      // Длительность тишины
      lastDetectedSource: null, // Последний определённый источник
      framesSinceSwitched: 0   // Кадры с момента смены источника
    };
  }

  /**
   * Начать захват аудио
   */
  async startCapturing() {
    if (this.isCapturing) {
      console.warn('[AudioCapture] Already capturing');
      return false;
    }

    try {
      console.log('[AudioCapture] Starting audio capture...');

      // Получаем доступ к микрофону
      const constraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: this.config.sampleRate,
          ...(this.config.deviceId && { deviceId: this.config.deviceId })
        }
      };

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Создаём AudioContext
      const audioContextClass = (typeof window !== 'undefined')
        ? (window.AudioContext || window.webkitAudioContext)
        : null;

      if (!audioContextClass) {
        throw new Error('AudioContext not available');
      }

      this.audioContext = new audioContextClass({ sampleRate: this.config.sampleRate });

      // Создаём source из микрофона
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Создаём analyser для определения источника
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;

      // Создаём ScriptProcessor для обработки аудио
      this.scriptProcessor = this.audioContext.createScriptProcessor(
        this.config.bufferSize,
        1, // inputChannels
        1  // outputChannels
      );

      // Подключаем график
      this.source.connect(this.analyser);
      this.analyser.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      // Обработка аудио данных
      this.scriptProcessor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        const audioBuffer = Buffer.from(inputData);

        // Определяем источник
        const detectedSource = this.detectAudioSource(inputData);

        // Отправляем буфер с информацией об источнике
        if (detectedSource === 'microphone') {
          this.emit('mic_audio', audioBuffer);
        } else if (detectedSource === 'conference') {
          this.emit('conference_audio', audioBuffer);
        }
        // 'silence' и 'unknown' мы не отправляем
      };

      this.isCapturing = true;
      this.emit('capturing_started');
      console.log('[AudioCapture] Audio capture started successfully');
      return true;

    } catch (error) {
      console.error('[AudioCapture] Error starting capture:', error);
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Остановить захват аудио
   */
  stopCapturing() {
    if (!this.isCapturing) {
      console.warn('[AudioCapture] Not capturing');
      return false;
    }

    try {
      // Останавливаем все дорожки
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }

      // Очищаем Web Audio API ресурсы
      if (this.scriptProcessor) {
        this.scriptProcessor.disconnect();
        this.scriptProcessor = null;
      }

      if (this.analyser) {
        this.analyser.disconnect();
        this.analyser = null;
      }

      if (this.source) {
        this.source.disconnect();
        this.source = null;
      }

      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }

      this.isCapturing = false;
      this.emit('capturing_stopped');
      console.log('[AudioCapture] Audio capture stopped');
      return true;

    } catch (error) {
      console.error('[AudioCapture] Error stopping capture:', error);
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Определить источник аудио (микрофон vs конференция)
   * Улучшенная версия с анализом спектра и пиков
   */
  detectAudioSource(audioData) {
    // 1. Вычисляем RMS (корень из среднего квадрата)
    let sum = 0;
    let maxPeak = 0;
    for (let i = 0; i < audioData.length; i++) {
      const val = audioData[i] * audioData[i];
      sum += val;
      if (Math.abs(audioData[i]) > maxPeak) {
        maxPeak = Math.abs(audioData[i]);
      }
    }
    const rms = Math.sqrt(sum / audioData.length);

    // 2. Анализируем спектр для определения характеристик
    const spectrum = this.analyzeSpectrum(audioData);

    // 3. Вычисляем ZCR (Zero Crossing Rate) - важно для речи vs фона
    const zcr = this.calculateZCR(audioData);

    // 4. Логика определения источника
    let detectedSource = 'unknown';

    // Энергия слишком низкая - тишина
    if (rms < 0.0005) {
      this.sourceDetector.silenceDuration++;
      if (this.sourceDetector.silenceDuration > 15) {
        detectedSource = 'silence';
      } else {
        detectedSource = this.sourceDetector.lastDetectedSource || 'unknown';
      }
    }
    // Высокий пик + выраженный ZCR = речь (микрофон пользователя)
    else if (maxPeak > this.sourceDetector.micThreshold && zcr > 0.1) {
      detectedSource = 'microphone';
      this.sourceDetector.silenceDuration = 0;
      this.sourceDetector.framesSinceSwitched = 0;
      this.sourceDetector.lastDetectedSource = 'microphone';
    }
    // Средняя энергия + низкий ZCR = фон/музыка (конференция)
    else if (rms > this.sourceDetector.confThreshold && rms < this.sourceDetector.micThreshold) {
      detectedSource = 'conference';
      this.sourceDetector.silenceDuration = 0;
      this.sourceDetector.framesSinceSwitched = 0;
      this.sourceDetector.lastDetectedSource = 'conference';
    }
    // Очень высокая энергия = скорее всего микрофон (громкий голос)
    else if (rms > this.sourceDetector.micThreshold * 2) {
      detectedSource = 'microphone';
      this.sourceDetector.silenceDuration = 0;
      this.sourceDetector.framesSinceSwitched = 0;
      this.sourceDetector.lastDetectedSource = 'microphone';
    }
    // Средняя энергия без явных признаков речи
    else if (rms > this.sourceDetector.confThreshold) {
      detectedSource = 'conference';
      this.sourceDetector.silenceDuration = 0;
      this.sourceDetector.framesSinceSwitched = 0;
      this.sourceDetector.lastDetectedSource = 'conference';
    }

    this.sourceDetector.framesSinceSwitched++;

    // DEBUG: Логируем для отладки (можно отключить в production)
    if (this.sourceDetector.framesSinceSwitched % 20 === 0) {
      console.debug('[AudioCapture] Source detection:', {
        source: detectedSource,
        rms: rms.toFixed(4),
        maxPeak: maxPeak.toFixed(4),
        zcr: zcr.toFixed(3),
        spectrum: `L:${spectrum.lowEnergy.toFixed(3)} M:${spectrum.midEnergy.toFixed(3)} H:${spectrum.highEnergy.toFixed(3)}`
      });
    }

    return detectedSource;
  }

  /**
   * Анализировать спектр частот
   */
  analyzeSpectrum(audioData) {
    // Разделяем на низкие, средние и высокие частоты
    // (простой анализ без FFT)
    let lowEnergy = 0;     // 0-4000 Hz
    let midEnergy = 0;     // 4000-8000 Hz
    let highEnergy = 0;    // 8000+ Hz

    // Каждый сэмпл примерно соответствует определённой частоте
    // На 16kHz sample rate: каждый сэмпл ≈ 16000/bufferSize Hz
    const third = Math.floor(audioData.length / 3);

    for (let i = 0; i < audioData.length; i++) {
      const energy = Math.abs(audioData[i]);
      if (i < third) {
        lowEnergy += energy;
      } else if (i < third * 2) {
        midEnergy += energy;
      } else {
        highEnergy += energy;
      }
    }

    return {
      lowEnergy: lowEnergy / audioData.length,
      midEnergy: midEnergy / audioData.length,
      highEnergy: highEnergy / audioData.length
    };
  }

  /**
   * Вычислить Zero Crossing Rate
   * Высокий ZCR = речь, низкий ZCR = фоновый звук/музыка
   */
  calculateZCR(audioData) {
    let zeroCrossings = 0;
    for (let i = 1; i < audioData.length; i++) {
      if ((audioData[i - 1] < 0 && audioData[i] >= 0) ||
          (audioData[i - 1] >= 0 && audioData[i] < 0)) {
        zeroCrossings++;
      }
    }
    return zeroCrossings / audioData.length;
  }

  /**
   * Установить пороги определения источника
   * Позволяет настроить чувствительность для разных окружений
   */
  setSourceThresholds(micThreshold, confThreshold) {
    this.sourceDetector.micThreshold = micThreshold;
    this.sourceDetector.confThreshold = confThreshold;
    console.log(`[AudioCapture] Thresholds updated: mic=${micThreshold}, conf=${confThreshold}`);
  }

  /**
   * Получить текущее состояние
   */
  getState() {
    return {
      isCapturing: this.isCapturing,
      sampleRate: this.config.sampleRate,
      bufferSize: this.config.bufferSize,
      lastDetectedSource: this.sourceDetector.lastDetectedSource,
      silenceDuration: this.sourceDetector.silenceDuration
    };
  }
}

// Экспортируем для использования в Node.js (main process)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioCaptureService;
}
