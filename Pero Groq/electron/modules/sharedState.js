/**
 * Shared state между модулями main-процесса.
 *
 * Хранит флаги, которые читаются из нескольких мест (appEventHandlers,
 * textInsertionHandlers, overlayHandlers и т.п.).
 */

let isNotesScreenActive = false;
let isRecording = false;

module.exports = {
  /**
   * Установить флаг "юзер на NotesScreen".
   */
  setNotesScreenActive: (value) => {
    isNotesScreenActive = !!value;
  },

  /**
   * Проверить — юзер сейчас на NotesScreen?
   */
  getNotesScreenActive: () => isNotesScreenActive,

  /**
   * Установить единый флаг активности аудиозаписи
   */
  setIsRecording: (value) => {
    isRecording = !!value;
  },

  /**
   * Получить текущее состояние аудиозаписи (true если идёт запись)
   */
  getIsRecording: () => isRecording,
};
