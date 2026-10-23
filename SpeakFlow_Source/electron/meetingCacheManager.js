/**
 * Meeting Cache Manager (v1.3.75 батч 2 / B1)
 *
 * По образцу audioCacheManager — но для встреч. Хранит metadata о состоянии
 * каждой встречи на каждом из 3 этапов pipeline:
 *   upload_pending → upload_done → analyze_pending → analyze_done →
 *   note_pending → note_done (success)
 *
 * При краше на любом этапе — meeting остаётся в metadata со статусом
 * соответствующего failed. Auto-replay (B3) поднимает с того места.
 *
 * НЕ дублирует физический файл — указывает на тот же путь что
 * useMeetingRecorder.saveAudioLocally сохранил (/userData/recordings/...).
 *
 * Безопасность (см. roadmap §17.9):
 * - Path traversal защита через валидацию audioFilePath (должен быть
 *   внутри userData/recordings)
 * - ID injection защита через regex ^meeting_\d+$
 * - Privacy: фильтруем по userId при getPendingMeetings (юзер B не видит
 *   pending юзера A)
 * - Backup metadata раз в 24 часа (защита от corrupted store)
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const electronStoreModule = require('electron-store');
const Store = electronStoreModule.default || electronStoreModule;

const VALID_STEPS = ['upload', 'analyze', 'note'];
const ID_PATTERN = /^meeting_\d+$/;

class MeetingCacheManager {
  constructor() {
    this.store = new Store({
      name: 'meeting-cache-metadata',
      clearInvalidConfig: true,
    });
    this.maxRetries = 5;
    this.maxAgeDays = 30;
    this.backupInterval = null;
    this._allowedDir = null; // ленивая инициализация после app.whenReady
  }

  /**
   * Получить разрешённую директорию для audioFilePath. Ленивая инициализация
   * потому что app.getPath('userData') доступен только после app.whenReady.
   */
  _getAllowedDir() {
    if (!this._allowedDir) {
      this._allowedDir = path.join(app.getPath('userData'), 'recordings');
    }
    return this._allowedDir;
  }

  /**
   * Validate audioFilePath — должен быть внутри userData/recordings.
   * Защита от path traversal: renderer мог бы передать `/etc/passwd` через IPC.
   */
  _validatePath(audioFilePath) {
    if (typeof audioFilePath !== 'string' || !audioFilePath) {
      throw new Error('audioFilePath must be a non-empty string');
    }
    const resolved = path.resolve(audioFilePath);
    const allowed = this._getAllowedDir();
    if (!resolved.startsWith(allowed)) {
      throw new Error(`audioFilePath outside allowed directory: ${resolved}`);
    }
    return resolved;
  }

  /**
   * Validate meeting ID. Защита от injection ключей в electron-store.
   */
  _validateId(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw new Error(`Invalid meeting ID format: ${id}`);
    }
  }

  /**
   * Сохранить начальную metadata встречи. Вызывается после saveAudioLocally
   * в globalMeetingRecorder.stopMeeting() — ДО любого upload.
   * @param {Object} data { id, audioFilePath, duration, startedAt, userId? }
   */
  saveInitialMetadata(data) {
    this._validateId(data.id);
    this._validatePath(data.audioFilePath);

    const all = this.store.get('meetings', {});
    all[data.id] = {
      id: data.id,
      audioFilePath: data.audioFilePath,
      duration: typeof data.duration === 'number' ? data.duration : 0,
      startedAt: typeof data.startedAt === 'number' ? data.startedAt : Date.now(),
      userId: typeof data.userId === 'string' ? data.userId : null,
      status: 'upload_pending',
      transcript: null,
      report: null,
      noteId: null,
      retryCount: { upload: 0, analyze: 0, note: 0 },
      lastError: null,
      lastFailedAt: null,
      createdAt: Date.now(),
    };
    this.store.set('meetings', all);
    console.log('[MeetingCache] Initial metadata saved:', data.id);
    return data.id;
  }

  markUploadSuccess(id, transcript) {
    this._validateId(id);
    const all = this.store.get('meetings', {});
    if (!all[id]) {
      console.warn('[MeetingCache] markUploadSuccess: id not found:', id);
      return false;
    }
    all[id].status = 'analyze_pending';
    all[id].transcript = typeof transcript === 'string' ? transcript : '';
    this.store.set('meetings', all);
    return true;
  }

  markAnalysisSuccess(id, report) {
    this._validateId(id);
    const all = this.store.get('meetings', {});
    if (!all[id]) {
      console.warn('[MeetingCache] markAnalysisSuccess: id not found:', id);
      return false;
    }
    all[id].status = 'note_pending';
    all[id].report = report; // объект — Prisma JSON
    this.store.set('meetings', all);
    return true;
  }

  markNoteCreated(id, noteId) {
    this._validateId(id);
    const all = this.store.get('meetings', {});
    if (!all[id]) {
      console.warn('[MeetingCache] markNoteCreated: id not found:', id);
      return false;
    }
    all[id].status = 'note_done';
    all[id].noteId = typeof noteId === 'string' ? noteId : null;
    this.store.set('meetings', all);
    console.log('[MeetingCache] Meeting fully processed:', id, '→ noteId:', noteId);
    return true;
  }

  markAsFailed(id, step, errorMessage) {
    this._validateId(id);
    if (!VALID_STEPS.includes(step)) {
      throw new Error(`Invalid step: ${step}. Must be one of ${VALID_STEPS.join(', ')}`);
    }
    const all = this.store.get('meetings', {});
    if (!all[id]) {
      console.warn('[MeetingCache] markAsFailed: id not found:', id);
      return false;
    }
    all[id].retryCount[step] = (all[id].retryCount[step] || 0) + 1;
    all[id].lastError = errorMessage ? String(errorMessage).substring(0, 200) : null;
    all[id].lastFailedAt = Date.now();
    if (all[id].retryCount[step] >= this.maxRetries) {
      all[id].status = 'permanently_failed';
      console.warn('[MeetingCache] Meeting permanently_failed after 5 retries:', id, step);
    } else {
      all[id].status = `${step}_failed`;
    }
    this.store.set('meetings', all);
    return true;
  }

  /**
   * Получить встречи требующие обработки (auto-replay подбирает их).
   * @param {string|null} userId — если передан, фильтруем по userId (privacy).
   *   Если null — возвращаем все (для admin / тестов).
   */
  getPendingMeetings(userId = null) {
    const all = this.store.get('meetings', {});
    return Object.values(all)
      .filter(m => {
        if (m.status === 'note_done' || m.status === 'permanently_failed') return false;
        if (userId !== null && m.userId !== null && m.userId !== userId) return false;
        return true;
      })
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  getAllMeetings(userId = null) {
    const all = this.store.get('meetings', {});
    return Object.values(all)
      .filter(m => {
        if (userId !== null && m.userId !== null && m.userId !== userId) return false;
        return true;
      })
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  getMetadata(id) {
    this._validateId(id);
    const all = this.store.get('meetings', {});
    return all[id] || null;
  }

  async deleteMetadata(id, alsoDeleteFile = false) {
    this._validateId(id);
    const all = this.store.get('meetings', {});
    if (!all[id]) return false;
    if (alsoDeleteFile && all[id].audioFilePath) {
      try {
        await fs.unlink(all[id].audioFilePath);
        console.log('[MeetingCache] Deleted audio file:', all[id].audioFilePath);
      } catch (err) {
        console.warn('[MeetingCache] Failed to delete audio file:', err.message);
      }
    }
    delete all[id];
    this.store.set('meetings', all);
    return true;
  }

  /**
   * Очистить чужие встречи (вызывается при logout).
   * @param {string} currentUserId — оставляем только встречи этого юзера
   */
  cleanupForeignUsers(currentUserId) {
    if (typeof currentUserId !== 'string') {
      console.warn('[MeetingCache] cleanupForeignUsers: invalid userId');
      return 0;
    }
    const all = this.store.get('meetings', {});
    let removed = 0;
    for (const [id, meta] of Object.entries(all)) {
      if (meta.userId !== null && meta.userId !== currentUserId) {
        delete all[id];
        removed++;
      }
    }
    if (removed > 0) {
      this.store.set('meetings', all);
      console.log(`[MeetingCache] Cleaned up ${removed} foreign user meetings`);
    }
    return removed;
  }

  async cleanup() {
    const all = this.store.get('meetings', {});
    const now = Date.now();
    const maxAge = this.maxAgeDays * 24 * 60 * 60 * 1000;
    let cleaned = 0;
    for (const [id, meta] of Object.entries(all)) {
      if (now - meta.createdAt > maxAge && meta.status === 'note_done') {
        await this.deleteMetadata(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[MeetingCache] Cleaned ${cleaned} old meetings`);
    }
    return cleaned;
  }

  /**
   * Backup metadata в отдельный файл. Защита от corrupted store —
   * если main файл повредится (clearInvalidConfig сбросит в empty),
   * можно восстановить из backup. Вызывается раз в 24 часа.
   */
  backupMetadata() {
    try {
      const userDataPath = app.getPath('userData');
      const mainPath = path.join(userDataPath, 'meeting-cache-metadata.json');
      const backupPath = path.join(userDataPath, 'meeting-cache-metadata.backup.json');
      if (fsSync.existsSync(mainPath)) {
        fsSync.copyFileSync(mainPath, backupPath);
      }
    } catch (err) {
      console.warn('[MeetingCache] Backup failed:', err.message);
    }
  }

  startBackupInterval() {
    if (this.backupInterval) return;
    // Раз в 24 часа
    this.backupInterval = setInterval(() => this.backupMetadata(), 24 * 60 * 60 * 1000);
    // Сразу один раз — на случай если store уже наполнен
    this.backupMetadata();
  }

  stopBackupInterval() {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
    }
  }

  getStats() {
    const all = this.store.get('meetings', {});
    const meetings = Object.values(all);
    const byStatus = {};
    for (const m of meetings) {
      byStatus[m.status] = (byStatus[m.status] || 0) + 1;
    }
    return {
      total: meetings.length,
      byStatus,
    };
  }
}

const meetingCacheManager = new MeetingCacheManager();
module.exports = meetingCacheManager;
