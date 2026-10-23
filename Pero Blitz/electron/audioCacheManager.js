const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const electronStoreModule = require('electron-store');
const Store = electronStoreModule.default || electronStoreModule;

/**
 * Audio Cache Manager
 * Локальное хранилище аудио файлов для истории транскрипций
 *
 * Optimized 2026 settings:
 * - Максимальный размер: 500 MB (экономия диска)
 * - Очистка файлов старше 30 дней
 * - Автоочистка при запуске и каждые 24 часа
 */
class AudioCacheManager {
  constructor() {
    this.cacheDir = path.join(app.getPath('userData'), 'audio-cache');
    this.store = new Store({ name: 'audio-cache-metadata', clearInvalidConfig: true });
    this.maxCacheSizeMB = 500; // 500 MB - оптимальный размер
    this.maxCacheDays = 30; // 30 дней - затем удаляем
    this.maxRetries = 5; // После 5 неудач - статус 'permanently_failed'

    this.initialized = false;
    this.cleanupInterval = null;
  }

  /**
   * Инициализация - создание директории и очистка старых файлов
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Создаём директорию если не существует
      await fs.mkdir(this.cacheDir, { recursive: true });

      // Очищаем старые файлы при старте
      await this.cleanup();

      // Периодическая очистка каждые 24 часа
      this.cleanupInterval = setInterval(() => {
        this.cleanup().catch(err => console.error('[AudioCache] Periodic cleanup error:', err));
      }, 24 * 60 * 60 * 1000);

      this.initialized = true;
      console.log('[AudioCache] Initialized at:', this.cacheDir, `(max ${this.maxCacheSizeMB}MB, ${this.maxCacheDays} days)`);
    } catch (error) {
      console.error('[AudioCache] Initialization error:', error);
    }
  }

  /**
   * Сохранить аудио файл в кэш
   * @param {Buffer} audioBuffer - Аудио данные
   * @param {Object} metadata - Метаданные (timestamp, originalFilename)
   * @returns {Promise<string>} ID файла в кэше
   */
  async saveAudio(audioBuffer, metadata = {}) {
    await this.initialize();

    try {
      // Генерируем уникальное имя файла
      const timestamp = Date.now();
      const id = `audio_${timestamp}`;
      const filename = `${id}.webm`;
      const filepath = path.join(this.cacheDir, filename);

      // Сохраняем файл
      await fs.writeFile(filepath, audioBuffer);

      // Сохраняем метаданные
      const allMetadata = this.store.get('files', {});
      allMetadata[id] = {
        id,
        filename,
        filepath,
        timestamp,
        size: audioBuffer.length,
        status: 'pending', // pending | success | failed
        transcriptionId: null,
        retryCount: 0,
        ...metadata
      };
      this.store.set('files', allMetadata);

      console.log('[AudioCache] Saved:', filename, `(${(audioBuffer.length / 1024).toFixed(2)} KB)`);

      // Проверяем лимит размера кэша
      await this.checkCacheSize();

      return id;
    } catch (error) {
      console.error('[AudioCache] Save error:', error);
      throw error;
    }
  }

  /**
   * Получить аудио файл из кэша
   * @param {string} id - ID файла
   * @returns {Promise<Buffer|null>}
   */
  async getAudio(id) {
    await this.initialize();

    try {
      const metadata = this.getMetadata(id);
      if (!metadata) {
        return null;
      }

      const audioBuffer = await fs.readFile(metadata.filepath);
      return audioBuffer;
    } catch (error) {
      console.error('[AudioCache] Read error:', error);
      return null;
    }
  }

  /**
   * Пометить файл как успешно транскрибированный
   * @param {string} id - ID файла
   * @param {string} transcriptionId - ID транскрипции в БД
   */
  markAsSuccess(id, transcriptionId) {
    const allMetadata = this.store.get('files', {});
    if (allMetadata[id]) {
      allMetadata[id].status = 'success';
      allMetadata[id].transcriptionId = transcriptionId;
      this.store.set('files', allMetadata);
      console.log('[AudioCache] Marked as success:', id);
    }
  }

  /**
   * Пометить файл как неудачный (для повторной отправки)
   * @param {string} id - ID файла
   * @param {string|null} errorMessage - Сообщение об ошибке (будет обрезано до 200 символов)
   */
  markAsFailed(id, errorMessage = null) {
    const allMetadata = this.store.get('files', {});
    if (allMetadata[id]) {
      const newRetryCount = (allMetadata[id].retryCount || 0) + 1;
      allMetadata[id].retryCount = newRetryCount;
      allMetadata[id].lastFailedAt = Date.now();

      // Сохраняем ошибку, обрезая до 200 символов чтобы не раздувать стор
      if (errorMessage !== null && errorMessage !== undefined) {
        allMetadata[id].lastError = String(errorMessage).substring(0, 200);
      }
      // Если errorMessage не передан, lastError сохраняется прежний (не сбрасываем)

      // После maxRetries - статус permanently_failed (UI покажет другую кнопку)
      if (newRetryCount >= this.maxRetries) {
        allMetadata[id].status = 'permanently_failed';
      } else {
        allMetadata[id].status = 'failed';
      }

      this.store.set('files', allMetadata);
      console.log('[AudioCache] Marked as', allMetadata[id].status, ':', id,
        `(retry: ${newRetryCount}, error: ${allMetadata[id].lastError || 'none'})`);
    }
  }

  /**
   * Сбросить счётчик попыток для записи (возвращает из permanently_failed в failed)
   * @param {string} id - ID файла
   */
  resetRetries(id) {
    const allMetadata = this.store.get('files', {});
    if (allMetadata[id]) {
      allMetadata[id].retryCount = 0;
      allMetadata[id].status = 'failed';
      // lastError сохраняется для информирования пользователя почему упало раньше
      this.store.set('files', allMetadata);
      console.log('[AudioCache] Retry count reset for:', id);
    }
  }

  /**
   * Получить метаданные файла
   * @param {string} id - ID файла
   * @returns {Object|null}
   */
  getMetadata(id) {
    const allMetadata = this.store.get('files', {});
    return allMetadata[id] || null;
  }

  /**
   * Найти ID аудио в кэше по transcriptionId
   * Используется для связи серверной истории с локальным аудио
   * @param {string} transcriptionId - ID транскрипции из БД
   * @returns {string|null} ID аудио в кэше
   */
  findByTranscriptionId(transcriptionId) {
    const allMetadata = this.store.get('files', {});
    for (const [id, metadata] of Object.entries(allMetadata)) {
      if (metadata.transcriptionId === transcriptionId) {
        return id;
      }
    }
    return null;
  }

  /**
   * Получить все неудачные ИЛИ оффлайн-сохранённые файлы (для UI отображения).
   *
   * F6 (29.04.2026): включаем сюда offlineQueued+pending записи (которые ещё
   * не пытались отправиться). Раньше юзер записывал оффлайн → видел баннер
   * «Сохранено локально» → но запись нигде в UI не появлялась пока auto-replay
   * не попытается и не упадёт. Теперь юзер сразу видит свою запись со
   * статусом «Сохранено офлайн, ждём интернет».
   *
   * Логика фильтра:
   * - status='success' → НЕ включаем (уже расшифрована, в основной истории)
   * - status='permanently_failed' → НЕ включаем (как и раньше — отдельный UI)
   * - status='failed' → включаем (классический путь — сервер ответил ошибкой)
   * - offlineQueued=true → включаем (N2 — запись сохранена при оффлайне)
   *
   * @returns {Array}
   */
  getFailedRecordings() {
    const allMetadata = this.store.get('files', {});
    return Object.values(allMetadata)
      .filter(file => {
        if (file.status === 'success' || file.status === 'permanently_failed') return false;
        return file.status === 'failed' || file.offlineQueued === true;
      })
      .sort((a, b) => b.timestamp - a.timestamp); // Новые первыми
  }

  /**
   * Получить все файлы (для истории)
   * @returns {Array}
   */
  getAllRecordings() {
    const allMetadata = this.store.get('files', {});
    return Object.values(allMetadata)
      .sort((a, b) => b.timestamp - a.timestamp); // Новые первыми
  }

  /**
   * Удалить файл из кэша
   * @param {string} id - ID файла
   */
  async deleteFile(id) {
    try {
      const metadata = this.getMetadata(id);
      if (!metadata) return;

      // Удаляем физический файл
      await fs.unlink(metadata.filepath).catch(() => {
        // Игнорируем если файл уже удалён
      });

      // Удаляем метаданные
      const allMetadata = this.store.get('files', {});
      delete allMetadata[id];
      this.store.set('files', allMetadata);

      console.log('[AudioCache] Deleted:', id);
    } catch (error) {
      console.error('[AudioCache] Delete error:', error);
    }
  }

  /**
   * Очистка старых файлов по времени и размеру
   */
  async cleanup() {
    try {
      const now = Date.now();
      const allMetadata = this.store.get('files', {});
      let deletedByTime = 0;

      // 1. Удаляем файлы старше maxCacheDays
      if (this.maxCacheDays > 0) {
        const maxAge = this.maxCacheDays * 24 * 60 * 60 * 1000;

        for (const [id, metadata] of Object.entries(allMetadata)) {
          const age = now - metadata.timestamp;
          if (age > maxAge) {
            await this.deleteFile(id);
            deletedByTime++;
          }
        }
      }

      // 2. Проверяем размер кэша
      await this.checkCacheSize();

      if (deletedByTime > 0) {
        console.log(`[AudioCache] Cleanup: deleted ${deletedByTime} files older than ${this.maxCacheDays} days`);
      }
    } catch (error) {
      console.error('[AudioCache] Cleanup error:', error);
    }
  }

  /**
   * Остановить периодическую очистку
   */
  stopCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Проверка размера кэша и удаление старых файлов при превышении лимита
   */
  async checkCacheSize() {
    try {
      const allMetadata = this.store.get('files', {});
      const totalSize = Object.values(allMetadata).reduce((sum, file) => sum + (file.size || 0), 0);
      const totalSizeMB = totalSize / (1024 * 1024);

      if (totalSizeMB > this.maxCacheSizeMB) {
        console.log(`[AudioCache] Cache size exceeded: ${totalSizeMB.toFixed(2)} MB / ${this.maxCacheSizeMB} MB`);

        // Сортируем файлы по дате (старые первые)
        const sortedFiles = Object.values(allMetadata)
          .sort((a, b) => a.timestamp - b.timestamp);

        // Удаляем старые файлы пока не достигнем лимита
        let currentSize = totalSize;
        for (const file of sortedFiles) {
          if (currentSize / (1024 * 1024) <= this.maxCacheSizeMB) {
            break;
          }
          await this.deleteFile(file.id);
          currentSize -= file.size;
        }

        console.log(`[AudioCache] Cleanup complete, new size: ${(currentSize / (1024 * 1024)).toFixed(2)} MB`);
      }
    } catch (error) {
      console.error('[AudioCache] Check cache size error:', error);
    }
  }

  /**
   * Получить статистику кэша
   * @returns {Object}
   */
  getStats() {
    const allMetadata = this.store.get('files', {});
    const files = Object.values(allMetadata);

    const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
    const pending = files.filter(f => f.status === 'pending').length;
    const success = files.filter(f => f.status === 'success').length;
    const failed = files.filter(f => f.status === 'failed').length;

    return {
      totalFiles: files.length,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      pending,
      success,
      failed,
      maxSizeMB: this.maxCacheSizeMB,
      maxDays: this.maxCacheDays
    };
  }
}

// Singleton instance
const audioCacheManager = new AudioCacheManager();

module.exports = audioCacheManager;
