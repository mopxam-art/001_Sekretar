/**
 * Shared state между модулями main-процесса.
 *
 * Хранит флаги, которые читаются из нескольких мест (appEventHandlers,
 * textInsertionHandlers и т.п.). Используется чтобы избежать передачи
 * флагов через цепочки параметров или дублирования IPC-слушателей в
 * каждом модуле.
 *
 * Создан 27.04.2026 для П-40 (диктовка прямо в заметку — окно SpeakFlow
 * не должно прятаться когда юзер на NotesScreen, иначе текст уходит
 * в "предыдущее активное окно", а не в редактор/чат заметок).
 */

let isNotesScreenActive = false;

module.exports = {
  /**
   * Установить флаг "юзер на NotesScreen". Вызывается из IPC-слушателя
   * 'notes-screen-active' в appEventHandlers.js.
   */
  setNotesScreenActive: (value) => {
    isNotesScreenActive = !!value;
  },

  /**
   * Проверить — юзер сейчас на NotesScreen?
   * Используется в appEventHandlers.js (onStartRecording) и
   * textInsertionHandlers.js (3 места с mainWindow.hide()).
   */
  getNotesScreenActive: () => isNotesScreenActive,
};
