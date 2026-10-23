/**
 * IPC Handlers - Main Entry Point
 * Все обработчики IPC событий от renderer process
 *
 * Модульная структура:
 * - appHandlers - App info, external links, auto-launch
 * - secureStoreHandlers - Secure store operations
 * - hotkeyHandlers - All hotkey handlers
 * - textInsertionHandlers - Text insertion via clipboard + Ctrl+V
 * - audioHandlers - Audio control, cache, save
 * - overlayHandlers - Overlay events, settings
 * - clipboardHandlers - Clipboard manager, auto-translate
 * - screenCaptureHandlers - Screen capture for Vision AI
 * - liveAssistantHandlers - Live assistant handlers
 * - updateHandlers - Auto-update handlers
 */

const { registerAppHandlers } = require('./appHandlers');
const { registerSecureStoreHandlers } = require('./secureStoreHandlers');
const { registerHotkeyHandlers } = require('./hotkeyHandlers');
const { registerTextInsertionHandlers } = require('./textInsertionHandlers');
const { registerAudioHandlers } = require('./audioHandlers');
const { registerOverlayHandlers } = require('./overlayHandlers');
const { registerClipboardHandlers } = require('./clipboardHandlers');
const { registerScreenCaptureHandlers } = require('./screenCaptureHandlers');
const { registerLiveAssistantHandlers } = require('./liveAssistantHandlers');
const { registerUpdateHandlers } = require('./updateHandlers');
const { registerMeetingHandlers } = require('./meetingHandlers');

/**
 * Регистрация всех IPC handlers
 * @param {Object} deps - Зависимости
 */
function registerIpcHandlers(deps) {
  // Регистрируем все модули с защитой от ошибок
  const modules = [
    ['App', registerAppHandlers],
    ['SecureStore', registerSecureStoreHandlers],
    ['Hotkey', registerHotkeyHandlers],
    ['TextInsertion', registerTextInsertionHandlers],
    ['Audio', registerAudioHandlers],
    ['Overlay', registerOverlayHandlers],
    ['Clipboard', registerClipboardHandlers],
    ['ScreenCapture', registerScreenCaptureHandlers],
    ['LiveAssistant', registerLiveAssistantHandlers],
    ['Update', registerUpdateHandlers],
    ['Meeting', registerMeetingHandlers],
  ];

  for (const [name, registerFn] of modules) {
    try {
      registerFn(deps);
    } catch (e) {
      console.error(`[IPC] Error registering ${name} handlers:`, e);
    }
  }

  console.log('[IPC] All handlers registered (modular)');
}

module.exports = { registerIpcHandlers };
