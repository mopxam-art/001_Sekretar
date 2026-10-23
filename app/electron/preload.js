const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File logging — renderer пишет в файл через main process (renderer не
  // имеет прямого fs-доступа). См. src/utils/fileLogger.ts
  logToFile: (level, message, context) => {
    try {
      ipcRenderer.invoke('log-from-renderer', level, message, context);
    } catch {
      // ignore — fallback на console уже в src/utils/fileLogger.ts
    }
  },
  // Шаг 7: открыть папку с логами в Проводнике (Win) / Finder (Mac)
  openLogsFolder: async () => {
    return ipcRenderer.invoke('open-logs-folder');
  },
  // Privacy opt-out для Sentry в main-процессе.
  // Renderer (Settings → Конфиденциальность) дёргает это для синхронизации
  // файла-flag в userData. Применится при следующем запуске SpeakFlow
  // (Sentry.init читает enabled один раз при старте).
  setSentryOptOut: async (optOut) => {
    return ipcRenderer.invoke('set-sentry-opt-out', optOut);
  },

  // v1.3.86 (Phase C): bridge для проброса user info из renderer в main
  // process Sentry SDK. Без него Sentry events из main (краши main / IPC /
  // autoUpdater) идут анонимно. Renderer вызывает после login и при init
  // если есть cached user в localStorage.
  // email опционален (null если юзер выбрал privacy opt-out для email).
  setSentryUser: async (userId, email) => {
    try {
      return await ipcRenderer.invoke('sentry-set-user', { userId, email });
    } catch (err) {
      // тихо — не критично, renderer всё равно делает свой setUser
      return { success: false, error: err && err.message };
    }
  },
  onStartRecording: (callback) => {
    // Remove all previous listeners before adding new one
    ipcRenderer.removeAllListeners('start-recording');
    ipcRenderer.on('start-recording', callback);
  },
  onStartRecordingFromOverlay: (callback) => {
    // Start recording triggered by clicking minimized overlay
    ipcRenderer.removeAllListeners('start-recording-from-overlay');
    ipcRenderer.on('start-recording-from-overlay', callback);
  },
  onStopRecordingFromOverlay: (callback) => {
    // Stop recording triggered by clicking stop button in overlay
    ipcRenderer.removeAllListeners('stop-recording-from-overlay');
    ipcRenderer.on('stop-recording-from-overlay', callback);
  },
  onStartStreamingRecording: (callback) => {
    // Start streaming recording (real-time text insertion)
    ipcRenderer.removeAllListeners('start-streaming-recording');
    ipcRenderer.on('start-streaming-recording', callback);
  },
  onStopRecording: (callback) => {
    // Remove all previous listeners before adding new one
    ipcRenderer.removeAllListeners('stop-recording');
    ipcRenderer.on('stop-recording', callback);
  },
  onStartTranslationRecording: (callback) => {
    // Remove all previous listeners before adding new one
    ipcRenderer.removeAllListeners('start-translation-recording');
    ipcRenderer.on('start-translation-recording', callback);
  },
  onStopTranslationRecording: (callback) => {
    // Remove all previous listeners before adding new one
    ipcRenderer.removeAllListeners('stop-translation-recording');
    ipcRenderer.on('stop-translation-recording', callback);
  },
  onToggleMeetingRecording: (callback) => {
    // Remove all previous listeners before adding new one
    ipcRenderer.removeAllListeners('toggle-meeting-recording');
    ipcRenderer.on('toggle-meeting-recording', callback);
  },
  insertText: (text, options) => {
    return ipcRenderer.invoke('insert-text', text, options);
  },
  typeTextRealtime: (text, options) => {
    return ipcRenderer.invoke('type-text-realtime', text, options);
  },
  notifyRecordingStarted: () => {
    ipcRenderer.send('recording-started');
  },
  // П-23: одноразовое скрытие главного окна при старте streaming-сессии
  hideMainWindowIfFocused: () => {
    return ipcRenderer.invoke('hide-main-window-if-focused');
  },
  notifyRecordingStopped: () => {
    ipcRenderer.send('recording-stopped');
  },
  notifyProcessingStarted: () => {
    ipcRenderer.send('processing-started');
  },
  notifyProcessingStopped: () => {
    ipcRenderer.send('processing-stopped');
  },
  notifyTabCompleteStarted: () => {
    ipcRenderer.send('tab-complete-started');
  },
  notifyTabCompleteFinished: () => {
    ipcRenderer.send('tab-complete-finished');
  },
  notifyTranslationRecordingStarted: () => {
    ipcRenderer.send('translation-recording-started');
  },
  notifyTranslationRecordingStopped: () => {
    ipcRenderer.send('translation-recording-stopped');
  },
  notifyMeetingRecordingStateChanged: (isRecording, duration) => {
    ipcRenderer.send('meeting-recording-state-changed', isRecording, duration);
  },
  setHotkey: (hotkey, mode) => {
    return ipcRenderer.invoke('set-hotkey', hotkey, mode);
  },
  setTranslationHotkey: (hotkey) => {
    return ipcRenderer.invoke('set-translation-hotkey', hotkey);
  },
  getTranslationHotkey: () => {
    return ipcRenderer.invoke('get-translation-hotkey');
  },
  getHotkey: () => {
    return ipcRenderer.invoke('get-hotkey');
  },
  getRecordingMode: () => {
    return ipcRenderer.invoke('get-recording-mode');
  },
  setRecordingMode: (mode) => {
    return ipcRenderer.invoke('set-recording-mode', mode);
  },
  muteSystemAudio: () => {
    return ipcRenderer.invoke('mute-system-audio');
  },
  unmuteSystemAudio: () => {
    return ipcRenderer.invoke('unmute-system-audio');
  },
  updateStreamingText: (text) => {
    ipcRenderer.send('update-streaming-text', text);
  },
  updateRecordingTime: (seconds) => {
    ipcRenderer.send('update-recording-time', seconds);
  },
  reinitializeHotkeys: () => {
    return ipcRenderer.invoke('reinitialize-hotkeys');
  },
  pauseHotkeys: () => {
    return ipcRenderer.invoke('pause-hotkeys');
  },
  resumeHotkeys: () => {
    return ipcRenderer.invoke('resume-hotkeys');
  },
  getMachineId: () => {
    return ipcRenderer.invoke('get-machine-id');
  },
  openExternal: (url) => {
    return ipcRenderer.invoke('open-external', url);
  },
  openMicSettings: () => {
    return ipcRenderer.invoke('open-mic-settings');
  },
  getMicAccessStatus: () => {
    return ipcRenderer.invoke('mic-access-status');
  },
  setOverlayVisibility: (visible) => {
    return ipcRenderer.invoke('set-overlay-visibility', visible);
  },
  setOverlayAutoHide: (enabled) => {
    return ipcRenderer.invoke('set-overlay-auto-hide', enabled);
  },
  setMeetingAutoStart: (enabled) => {
    return ipcRenderer.invoke('set-meeting-auto-start', enabled);
  },
  // Auto-launch (start with system)
  setAutoLaunch: (enabled) => {
    return ipcRenderer.invoke('set-auto-launch', enabled);
  },
  getAutoLaunch: () => {
    return ipcRenderer.invoke('get-auto-launch');
  },
  // Secure store API
  secureStore: {
    saveTokens: (accessToken, refreshToken) =>
      ipcRenderer.invoke('secure-store:save-tokens', accessToken, refreshToken),
    getTokens: () =>
      ipcRenderer.invoke('secure-store:get-tokens'),
    saveUser: (userData) =>
      ipcRenderer.invoke('secure-store:save-user', userData),
    getUser: () =>
      ipcRenderer.invoke('secure-store:get-user'),
    isAuthenticated: () =>
      ipcRenderer.invoke('secure-store:is-authenticated'),
    clear: () =>
      ipcRenderer.invoke('secure-store:clear')
  },
  // Clipboard API
  clipboard: {
    readText: () =>
      ipcRenderer.invoke('clipboard:read-text'),
    writeText: (text) =>
      ipcRenderer.invoke('clipboard:write-text', text),
    hasImage: () =>
      ipcRenderer.invoke('clipboard:has-image'),
    readImage: () =>
      ipcRenderer.invoke('clipboard:read-image'),
    readImageAsBase64: () =>
      ipcRenderer.invoke('clipboard:read-image-base64'),
    writeImage: (imagePath) =>
      ipcRenderer.invoke('clipboard:write-image', imagePath),
    getFormats: () =>
      ipcRenderer.invoke('clipboard:get-formats'),
    startMonitoring: (watchDelayMs = 500) =>
      ipcRenderer.invoke('clipboard:start-monitoring', watchDelayMs),
    stopMonitoring: () =>
      ipcRenderer.invoke('clipboard:stop-monitoring'),
    isMonitoring: () =>
      ipcRenderer.invoke('clipboard:is-monitoring'),
    loadImage: (imagePath) =>
      ipcRenderer.invoke('clipboard:load-image', imagePath),
    onClipboardChange: (callback) => {
      ipcRenderer.removeAllListeners('clipboard-change');
      ipcRenderer.on('clipboard-change', (event, data) => callback(data));
    }
  },
  // Deep link authentication
  onAuthFromDeepLink: (callback) => {
    ipcRenderer.removeAllListeners('auth-from-deeplink');
    ipcRenderer.on('auth-from-deeplink', (event, token) => callback(token));
  },
  // Квитанция установки из speakflow://attr (Electron-атрибуция, 26.08.2026).
  // Auth-токен и квитанция намеренно идут разными каналами и не смешиваются.
  onAttributionReceipt: (callback) => {
    ipcRenderer.removeAllListeners('attribution-receipt');
    ipcRenderer.on('attribution-receipt', (event, receipt) => callback(receipt));
  },
  // Renderer смонтировал слушатели deep-link — main может отдать буфер.
  // Заменяет слепой setTimeout(1000) на cold start.
  signalDeepLinkReady: () => ipcRenderer.send('renderer-ready-for-deeplinks'),
  // Window restored event (when window comes back from minimized state)
  onWindowRestored: (callback) => {
    ipcRenderer.removeAllListeners('window-restored');
    ipcRenderer.on('window-restored', callback);
  },
  // Overlay hidden by user event
  onOverlayHiddenByUser: (callback) => {
    ipcRenderer.removeAllListeners('overlay-hidden-by-user');
    ipcRenderer.on('overlay-hidden-by-user', callback);
  },
  // Undo last insert
  undoLastInsert: () => {
    return ipcRenderer.invoke('undo-last-insert');
  },
  getUndoHotkey: () => {
    return ipcRenderer.invoke('get-undo-hotkey');
  },
  setUndoHotkey: (hotkey) => {
    return ipcRenderer.invoke('set-undo-hotkey', hotkey);
  },
  // Tab-Complete methods (Vision AI autocomplete)
  getTabCompleteHotkey: () => {
    return ipcRenderer.invoke('get-tab-complete-hotkey');
  },
  setTabCompleteHotkey: (hotkey) => {
    return ipcRenderer.invoke('set-tab-complete-hotkey', hotkey);
  },
  setTabCompleteEnabled: (enabled) => {
    return ipcRenderer.invoke('set-tab-complete-enabled', enabled);
  },
  onTabComplete: (callback) => {
    ipcRenderer.removeAllListeners('tab-complete');
    ipcRenderer.on('tab-complete', callback);
  },
  // Unified Memory methods
  getUnifiedMemoryHotkey: () => {
    return ipcRenderer.invoke('get-unified-memory-hotkey');
  },
  setUnifiedMemoryHotkey: (hotkey) => {
    return ipcRenderer.invoke('set-unified-memory-hotkey', hotkey);
  },
  onUnifiedMemorySearch: (callback) => {
    ipcRenderer.removeAllListeners('unified-memory-search');
    ipcRenderer.on('unified-memory-search', callback);
  },
  // П-40: NotesScreen сообщает в main процесс «юзер сейчас на экране заметок»,
  // чтобы основной хоткей записи не прятал окно — текст должен попасть
  // в редактор/чат заметок, а не в "предыдущее активное окно".
  notifyNotesScreenActive: (active) => {
    ipcRenderer.send('notes-screen-active', !!active);
  },
  // App version methods
  getAppVersion: () => {
    return ipcRenderer.invoke('get-app-version');
  },
  getElectronVersion: () => {
    return ipcRenderer.invoke('get-electron-version');
  },
  // Window focus method
  focusWindow: () => {
    return ipcRenderer.invoke('focus-window');
  },

  // Live Assistant methods
  startLiveAssistant: () => {
    return ipcRenderer.invoke('start-live-assistant');
  },
  liveAssistantUpdateTranscript: (data) => {
    return ipcRenderer.invoke('live-assistant-update-transcript', data);
  },
  liveAssistantUpdateInsights: (insights) => {
    return ipcRenderer.invoke('live-assistant-update-insights', insights);
  },
  onLiveAssistantFinished: (callback) => {
    ipcRenderer.removeAllListeners('live-assistant-finished');
    ipcRenderer.on('live-assistant-finished', (event, data) => callback(data));
  },

  // Meeting note auto-save from sidebar
  onSaveMeetingNote: (callback) => {
    ipcRenderer.removeAllListeners('save-meeting-note');
    ipcRenderer.on('save-meeting-note', (event, transcript) => callback(transcript));
  },

  // Audio Cache methods
  audioCacheSave: (audioBuffer, metadata) => {
    return ipcRenderer.invoke('audio-cache:save', audioBuffer, metadata);
  },
  audioCacheGet: (id) => {
    return ipcRenderer.invoke('audio-cache:get', id);
  },
  audioCacheMarkSuccess: (id, transcriptionId) => {
    return ipcRenderer.invoke('audio-cache:mark-success', id, transcriptionId);
  },
  audioCacheMarkFailed: (id, errorMessage) => {
    return ipcRenderer.invoke('audio-cache:mark-failed', id, errorMessage);
  },
  audioCacheResetRetries: (id) => {
    return ipcRenderer.invoke('audio-cache:reset-retries', id);
  },
  audioCacheGetFailed: () => {
    return ipcRenderer.invoke('audio-cache:get-failed');
  },
  audioCacheGetAll: () => {
    return ipcRenderer.invoke('audio-cache:get-all');
  },
  audioCacheGetMetadata: (id) => {
    return ipcRenderer.invoke('audio-cache:get-metadata', id);
  },
  audioCacheDelete: (id) => {
    return ipcRenderer.invoke('audio-cache:delete', id);
  },
  audioCacheGetStats: () => {
    return ipcRenderer.invoke('audio-cache:get-stats');
  },
  audioCacheCleanup: () => {
    return ipcRenderer.invoke('audio-cache:cleanup');
  },
  audioCacheFindByTranscriptionId: (transcriptionId) => {
    return ipcRenderer.invoke('audio-cache:find-by-transcription-id', transcriptionId);
  },

  // Meeting Cache (v1.3.75 батч 2 / B1) — защита длинных встреч от потери
  // при оффлайне. State machine: upload_pending → upload_done → analyze_pending →
  // analyze_done → note_pending → note_done. См. electron/meetingCacheManager.js
  meetingCacheSaveInitial: (data) => ipcRenderer.invoke('meeting-cache:save-initial', data),
  meetingCacheMarkUploadSuccess: (id, transcript) => ipcRenderer.invoke('meeting-cache:mark-upload-success', id, transcript),
  meetingCacheMarkAnalysisSuccess: (id, report) => ipcRenderer.invoke('meeting-cache:mark-analysis-success', id, report),
  meetingCacheMarkNoteCreated: (id, noteId) => ipcRenderer.invoke('meeting-cache:mark-note-created', id, noteId),
  meetingCacheMarkFailed: (id, step, errorMessage) => ipcRenderer.invoke('meeting-cache:mark-failed', id, step, errorMessage),
  meetingCacheGetPending: (userId) => ipcRenderer.invoke('meeting-cache:get-pending', userId),
  meetingCacheGetAll: (userId) => ipcRenderer.invoke('meeting-cache:get-all', userId),
  meetingCacheGet: (id) => ipcRenderer.invoke('meeting-cache:get', id),
  meetingCacheDelete: (id, alsoDeleteFile) => ipcRenderer.invoke('meeting-cache:delete', id, alsoDeleteFile),
  meetingCacheCleanup: () => ipcRenderer.invoke('meeting-cache:cleanup'),
  meetingCacheCleanupForeignUsers: (currentUserId) => ipcRenderer.invoke('meeting-cache:cleanup-foreign-users', currentUserId),
  meetingCacheGetStats: () => ipcRenderer.invoke('meeting-cache:get-stats'),

  // v1.3.84: Native OS notification для длинной встречи (свёрнутое окно)
  showMeetingNotification: (data) => ipcRenderer.invoke('meeting:show-notification', data),

  // Clipboard Auto-Translation
  toggleClipboardAutoTranslate: (enabled) => {
    return ipcRenderer.invoke('toggle-clipboard-auto-translate', enabled);
  },

  // Get/Set clipboard auto-translate settings
  getClipboardAutoTranslateSettings: () => {
    return ipcRenderer.invoke('get-clipboard-auto-translate-settings');
  },

  setClipboardAutoHideDelay: (delay) => {
    return ipcRenderer.invoke('set-clipboard-auto-hide-delay', delay);
  },

  // Desktop Capturer for system audio (old method - not used)
  getDesktopSources: (options) => {
    return ipcRenderer.invoke('get-desktop-sources', options);
  },

  // Audio Loopback - modern method for system audio
  enableLoopbackAudio: () => {
    return ipcRenderer.invoke('enable-loopback-audio');
  },
  disableLoopbackAudio: () => {
    return ipcRenderer.invoke('disable-loopback-audio');
  },

  // Meeting Recordings - save audio locally
  saveAudioFile: (data) => {
    return ipcRenderer.invoke('save-audio-file', data);
  },

  // Translator API (Real-time translation)
  invoke: (channel, ...args) => {
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, callback) => {
    ipcRenderer.on(channel, callback);
  },
  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },
  translator: {
    initSession: (config) =>
      ipcRenderer.invoke('translator:init-session', config),
    start: () =>
      ipcRenderer.invoke('translator:start'),
    stop: () =>
      ipcRenderer.invoke('translator:stop'),
    closeSession: () =>
      ipcRenderer.invoke('translator:close-session'),
    setLanguages: (sourceLang, targetLang) =>
      ipcRenderer.invoke('translator:set-languages', { sourceLang, targetLang }),
    setVolume: (volume) =>
      ipcRenderer.invoke('translator:set-volume', volume),
    getConfig: () =>
      ipcRenderer.invoke('translator:get-config'),
    getState: () =>
      ipcRenderer.invoke('translator:get-state'),
    setSourceThresholds: (micThreshold, confThreshold) =>
      ipcRenderer.invoke('translator:set-source-thresholds', { micThreshold, confThreshold }),
    sendMicAudio: (audioBuffer) =>
      ipcRenderer.invoke('translator:send-mic-audio', audioBuffer),
    sendConferenceAudio: (audioBuffer) =>
      ipcRenderer.invoke('translator:send-conference-audio', audioBuffer),
    onSessionReady: (callback) => {
      ipcRenderer.removeAllListeners('translator:session-ready');
      ipcRenderer.on('translator:session-ready', (event, data) => callback(data));
    },
    onAudioToConference: (callback) => {
      ipcRenderer.removeAllListeners('translator:audio-to-conference');
      ipcRenderer.on('translator:audio-to-conference', (event, data) => callback(data));
    },
    onAudioToUser: (callback) => {
      ipcRenderer.removeAllListeners('translator:audio-to-user');
      ipcRenderer.on('translator:audio-to-user', (event, data) => callback(data));
    },
    onError: (callback) => {
      ipcRenderer.removeAllListeners('translator:error');
      ipcRenderer.on('translator:error', (event, data) => callback(data));
    },
    onDisconnected: (callback) => {
      ipcRenderer.removeAllListeners('translator:disconnected');
      ipcRenderer.on('translator:disconnected', callback);
    }
  },

  // Screen capture for Vision AI
  captureScreen: (mode, options) => ipcRenderer.invoke('capture-screen', mode, options),

  // Auto-update methods
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  simulateUpdateDownloaded: () => ipcRenderer.invoke('simulate-update-downloaded'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  onUpdateChecking: (callback) => {
    ipcRenderer.removeAllListeners('update-checking');
    ipcRenderer.on('update-checking', callback);
  },
  onUpdateAvailable: (callback) => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.on('update-available', (event, data) => callback(data));
  },
  onUpdateNotAvailable: (callback) => {
    ipcRenderer.removeAllListeners('update-not-available');
    ipcRenderer.on('update-not-available', (event, data) => callback(data));
  },
  onUpdateDownloadProgress: (callback) => {
    ipcRenderer.removeAllListeners('update-download-progress');
    ipcRenderer.on('update-download-progress', (event, data) => callback(data));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.removeAllListeners('update-downloaded');
    ipcRenderer.on('update-downloaded', (event, data) => callback(data));
  },
  onUpdateError: (callback) => {
    ipcRenderer.removeAllListeners('update-error');
    ipcRenderer.on('update-error', (event, data) => callback(data));
  },
  // N4 (29.04.2026): retry автообновления при сетевых ошибках. Шлётся из
  // autoUpdater.js когда planируется новая попытка через 5 мин.
  onUpdateRetryScheduled: (callback) => {
    ipcRenderer.removeAllListeners('update-retry-scheduled');
    ipcRenderer.on('update-retry-scheduled', (event, data) => callback(data));
  }
});

// Expose standard ipcRenderer for the React app components
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, func) => {
      const subscription = (event, ...args) => func(event, ...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    },
    removeListener: (channel, func) => ipcRenderer.removeListener(channel, func),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
  }
});