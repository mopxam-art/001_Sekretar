/**
 * App Event Handlers
 * Настройка всех event handlers для hotkeys и других событий
 */

const { ipcMain } = require('electron');
const sharedState = require('./sharedState');

/**
 * Настроить обработчики событий для hotkeys manager
 */
function setupHotkeysCallbacks(hotkeysManager, windowManager, overlay, getLiveAssistantSidebar, memoryOverlay) {
  // Состояние записи (локальное для этого модуля)
  let isRecording = false;
  let isTranslationRecording = false;
  let isMeetingRecording = false; // Добавили флаг для записи встреч

  // П-40: renderer (NotesScreen) сообщает когда юзер на экране заметок,
  // чтобы main процесс НЕ прятал окно при старте записи и текст вставлялся
  // прямо в редактор/чат заметок, а не в "предыдущее активное окно".
  ipcMain.on('notes-screen-active', (_event, active) => {
    sharedState.setNotesScreenActive(!!active);
    console.log(`[EventHandlers] NotesScreen active: ${!!active}`);
  });

  // Helper: mute/unmute sidebar when dictation is active
  const muteSidebar = () => {
    if (getLiveAssistantSidebar) {
      const sidebar = getLiveAssistantSidebar();
      if (sidebar && sidebar.isWindowActive()) {
        sidebar.mute();
      }
    }
  };

  const unmuteSidebar = () => {
    if (getLiveAssistantSidebar) {
      const sidebar = getLiveAssistantSidebar();
      if (sidebar && sidebar.isWindowActive()) {
        sidebar.unmute();
      }
    }
  };

  // ============ RECORDING CALLBACKS ============
  hotkeysManager.onStartRecording = (mode) => {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow) return;

    // П-25 UX: если SpeakFlow окно сейчас сфокусировано (юзер был в Settings
    // или main view) — скрыть его СРАЗУ перед стартом recording, чтобы
    // текст вставлялся в ПРЕДЫДУЩЕЕ активное окно (Notepad/Cursor/Telegram),
    // а не в input fields самого SpeakFlow. Раньше hide вызывался только
    // в insert-text handler (через 1-2 сек), но в streaming это поздно —
    // первые чанки могут уже улететь в SpeakFlow.
    //
    // П-40 (27.04.2026): ИСКЛЮЧЕНИЕ — если юзер на NotesScreen, окно НЕ прячем,
    // юзер хочет диктовать прямо В заметку или AI-чат, текст должен пойти туда
    // куда стоит курсор внутри SpeakFlow, а не в "предыдущее активное окно".
    if (
      !mainWindow.isDestroyed() &&
      mainWindow.isFocused() &&
      !sharedState.getNotesScreenActive()
    ) {
      mainWindow.hide();
      console.log('[EventHandlers] Hidden focused mainWindow before recording start');
    } else if (mainWindow.isFocused() && sharedState.getNotesScreenActive()) {
      console.log('[EventHandlers] NotesScreen active — окно НЕ скрываем (П-40)');
    }

    if (mode === 'toggle') {
      // Toggle mode: переключаем состояние
      isRecording = !isRecording;
      if (isRecording) {
        console.log('[EventHandlers] Starting recording (toggle mode)');
        mainWindow.webContents.send('start-recording');
        overlay.updateState(true);
        muteSidebar(); // Mute sidebar when dictation starts
      } else {
        console.log('[EventHandlers] Stopping recording (toggle mode)');
        mainWindow.webContents.send('stop-recording');
        overlay.updateState(false);
        unmuteSidebar(); // Unmute sidebar when dictation stops
      }
    } else if (mode === 'streaming') {
      // Streaming mode: работает как toggle, но с мгновенной вставкой текста
      isRecording = !isRecording;
      if (isRecording) {
        console.log('[EventHandlers] Starting recording (streaming mode)');
        mainWindow.webContents.send('start-streaming-recording');
        overlay.updateState(true);
        muteSidebar();
      } else {
        console.log('[EventHandlers] Stopping recording (streaming mode)');
        mainWindow.webContents.send('stop-recording');
        overlay.updateState(false);
        unmuteSidebar();
      }
    } else {
      // Hold mode: начинаем запись только если еще не записываем
      if (!isRecording) {
        console.log('[EventHandlers] Starting recording (hold mode)');
        isRecording = true;
        mainWindow.webContents.send('start-recording');
        overlay.updateState(true);
        muteSidebar(); // Mute sidebar when dictation starts
      }
    }
  };

  hotkeysManager.onStopRecording = () => {
    if (isRecording) {
      console.log('[EventHandlers] Stopping recording (hold mode - key released)');
      isRecording = false;
      const mainWindow = windowManager.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stop-recording');
        overlay.updateState(false);
        unmuteSidebar(); // Unmute sidebar when dictation stops
      }
    }
  };

  // ============ TRANSLATION CALLBACKS ============
  hotkeysManager.onStartTranslation = () => {
    if (!isTranslationRecording) {
      console.log('[EventHandlers] Starting translation recording');
      isTranslationRecording = true;
      const mainWindow = windowManager.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('start-translation-recording');
        overlay.updateState(true);
      }
    }
  };

  hotkeysManager.onStopTranslation = () => {
    if (isTranslationRecording) {
      console.log('[EventHandlers] Stopping translation recording');
      isTranslationRecording = false;
      const mainWindow = windowManager.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stop-translation-recording');
        overlay.updateState(false);
      }
    }
  };

  // ============ UNDO CALLBACK ============
  hotkeysManager.onUndo = () => {
    console.log('[EventHandlers] Undo triggered');
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('trigger-undo');
    }
  };

  // ============ MEETING CALLBACK ============
  hotkeysManager.onToggleMeeting = () => {
    console.log('[EventHandlers] Meeting hotkey triggered (toggle)');
    isMeetingRecording = !isMeetingRecording;

    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (isMeetingRecording) {
        console.log('[EventHandlers] Starting meeting recording');
        mainWindow.webContents.send('toggle-meeting-recording', true);
      } else {
        console.log('[EventHandlers] Stopping meeting recording');
        mainWindow.webContents.send('toggle-meeting-recording', false);
      }
    }
  };

  // ============ TAB-COMPLETE CALLBACK ============
  hotkeysManager.onTabComplete = () => {
    console.log('[EventHandlers] Tab-Complete triggered');
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tab-complete');
    }
  };

  // ============ UNIFIED MEMORY CALLBACK ============
  // 🟡 Memory Overlay (Ctrl+Shift+U) — временно отключён 27.04.2026.
  // Причина: auth через secureStore возвращал 401 «Не авторизован», endpoint
  // /api/memory/generate-prompt возвращает не ответ AI а промпт-заготовку.
  // Полный статус и план возврата: docs/electron/MEMORY_OVERLAY_FEATURE.md
  hotkeysManager.onUnifiedMemorySearch = () => {
    console.log('[MemoryOverlay] Feature temporarily disabled — see docs/electron/MEMORY_OVERLAY_FEATURE.md');
  };

  console.log('[EventHandlers] Hotkeys callbacks configured');
}

/**
 * Настроить обработчики событий для Meeting Detector
 */
function setupMeetingDetectorCallbacks(meetingDetector, persistentStore, getLiveAssistantOverlay, getLiveAssistantSidebar) {
  meetingDetector.on('meeting-detected', (meetingInfo) => {
    console.log('[EventHandlers] Meeting detected:', meetingInfo.platform);

    const autoStartEnabled = persistentStore.get('meeting_auto_start', true);

    if (autoStartEnabled) {
      const MeetingNotification = require('../MeetingNotification');
      const meetingNotification = new MeetingNotification();

      meetingNotification.show(
        meetingInfo,
        () => {
          console.log('[EventHandlers] User started Live Assistant Sidebar');
          // Use new sidebar instead of overlay
          if (getLiveAssistantSidebar) {
            const sidebar = getLiveAssistantSidebar();
            sidebar.create({ meetingInfo });
          } else {
            // Fallback to old overlay
            const liveAssistantOverlay = getLiveAssistantOverlay();
            liveAssistantOverlay.create({ autoStartFromMeeting: true });
          }
        },
        () => {
          console.log('[EventHandlers] User cancelled meeting recording');
        }
      );
    }
  });

  meetingDetector.on('meeting-ended', (meetingInfo) => {
    console.log('[EventHandlers] Meeting ended:', meetingInfo.platform);
  });

  console.log('[EventHandlers] Meeting detector callbacks configured');
}

/**
 * Настроить обработчики системных событий (resume/suspend)
 */
function setupSystemEventHandlers(powerMonitor, hotkeysManager) {
  const { powerMonitor: pm } = require('electron');

  pm.on('resume', () => {
    console.log('[EventHandlers] System resumed - reinitializing hotkeys');
    if (hotkeysManager) {
      hotkeysManager.setupKeyboardListener();
    }
  });

  console.log('[EventHandlers] System event handlers configured');
}

module.exports = {
  setupHotkeysCallbacks,
  setupMeetingDetectorCallbacks,
  setupSystemEventHandlers
};
