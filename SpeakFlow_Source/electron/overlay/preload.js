/**
 * Overlay Preload Script
 *
 * Exposes IPC communication to the overlay renderer process.
 * Uses contextBridge for secure context isolation.
 *
 * Available methods in window.electronAPI:
 * - Recording state: onRecordingStateChanged, onRecordingTimeUpdate
 * - Processing state: onProcessingStateChanged
 * - Meeting: onMeetingRecordingStateChanged, onMeetingRecordingTimeUpdate
 * - UI actions: showMainWindow, hideOverlay
 * - Mode: onOverlayModeChanged, onOverlayFadedIn/Out
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ============================================================
  // RECORDING STATE
  // ============================================================

  /**
   * Listen for recording state changes
   * @param {Function} callback - Called with (isRecording: boolean)
   */
  onRecordingStateChanged: (callback) => {
    ipcRenderer.on('recording-state-changed', (event, isRecording) => {
      callback(isRecording);
    });
  },

  /**
   * Listen for recording time updates
   * @param {Function} callback - Called with (seconds: number)
   */
  onRecordingTimeUpdate: (callback) => {
    ipcRenderer.on('recording-time-update', (event, seconds) => {
      callback(seconds);
    });
  },

  // ============================================================
  // PROCESSING STATE
  // ============================================================

  /**
   * Listen for processing state changes
   * @param {Function} callback - Called with (isProcessing: boolean)
   */
  onProcessingStateChanged: (callback) => {
    ipcRenderer.on('processing-state-changed', (event, isProcessing) => {
      callback(isProcessing);
    });
  },

  // ============================================================
  // TAB-COMPLETE STATE
  // ============================================================

  /**
   * Listen for tab-complete state changes
   * @param {Function} callback - Called with (isProcessing: boolean)
   */
  onTabCompleteStateChanged: (callback) => {
    ipcRenderer.on('tab-complete-state-changed', (event, isProcessing) => {
      callback(isProcessing);
    });
  },

  // ============================================================
  // STREAMING TEXT
  // ============================================================

  /**
   * Listen for streaming text updates
   * @param {Function} callback - Called with (text: string)
   */
  onStreamingTextUpdate: (callback) => {
    ipcRenderer.on('streaming-text-update', (event, text) => {
      callback(text);
    });
  },

  // ============================================================
  // MEETING RECORDING
  // ============================================================

  /**
   * Listen for meeting recording state changes
   * @param {Function} callback - Called with (isRecording: boolean, duration: number)
   */
  onMeetingRecordingStateChanged: (callback) => {
    ipcRenderer.on('meeting-recording-state-changed', (event, isRecording, duration) => {
      callback(isRecording, duration);
    });
  },

  /**
   * Listen for meeting recording time updates
   * @param {Function} callback - Called with (duration: number)
   */
  onMeetingRecordingTimeUpdate: (callback) => {
    ipcRenderer.on('meeting-recording-time-update', (event, duration) => {
      callback(duration);
    });
  },

  // ============================================================
  // OVERLAY MODE (legacy)
  // ============================================================

  /**
   * Listen for overlay mode changes (compact/full)
   * @param {Function} callback - Called with (mode: string)
   */
  onOverlayModeChanged: (callback) => {
    ipcRenderer.on('overlay-mode-changed', (event, mode) => {
      callback(mode);
    });
  },

  /**
   * Listen for overlay fade out event
   * @param {Function} callback
   */
  onOverlayFadedOut: (callback) => {
    ipcRenderer.on('overlay-faded-out', callback);
  },

  /**
   * Listen for overlay fade in event
   * @param {Function} callback
   */
  onOverlayFadedIn: (callback) => {
    ipcRenderer.on('overlay-faded-in', callback);
  },

  // ============================================================
  // USER ACTIONS
  // ============================================================

  /**
   * Request to show main application window
   */
  showMainWindow: () => {
    ipcRenderer.send('overlay-clicked');
  },

  /**
   * Request to hide overlay
   */
  hideOverlay: () => {
    ipcRenderer.send('overlay-hide-requested');
  },

  /**
   * Request to start recording (when clicking minimized overlay)
   */
  startRecording: () => {
    ipcRenderer.send('overlay-start-recording');
  },

  /**
   * Request to stop recording (when clicking stop button)
   */
  stopRecording: () => {
    ipcRenderer.send('overlay-stop-recording');
  },

  // ============================================================
  // MOUSE EVENTS
  // ============================================================

  /**
   * Notify mouse entered overlay
   */
  notifyMouseEnter: () => {
    ipcRenderer.send('overlay-mouse-enter');
  },

  /**
   * Notify mouse left overlay
   */
  notifyMouseLeave: () => {
    ipcRenderer.send('overlay-mouse-leave');
  },

  /**
   * Notify mouse moved in overlay
   */
  notifyMouseMove: () => {
    ipcRenderer.send('overlay-mouse-move');
  },

  // ============================================================
  // LIVE ASSISTANT (shared preload)
  // ============================================================

  finishLiveAssistant: (fullTranscript) => {
    ipcRenderer.send('live-assistant-finish', fullTranscript);
  },

  onTranscriptUpdate: (callback) => {
    ipcRenderer.on('live-assistant-transcript', (event, data) => {
      callback(data);
    });
  },

  onAIInsightsUpdate: (callback) => {
    ipcRenderer.on('live-assistant-ai-insights', (event, data) => {
      callback(data);
    });
  },

  getAccessToken: () => {
    return ipcRenderer.invoke('overlay-get-access-token');
  },

  getApiUrl: () => {
    return ipcRenderer.invoke('overlay-get-api-url');
  },

  saveAsNote: (transcript) => {
    return ipcRenderer.invoke('live-assistant-save-note', transcript);
  },

  // ============================================================
  // AUDIO CONTROL
  // ============================================================

  enableLoopbackAudio: () => {
    return ipcRenderer.invoke('enable-loopback-audio');
  },

  disableLoopbackAudio: () => {
    return ipcRenderer.invoke('disable-loopback-audio');
  },

  onEnableSystemAudio: (callback) => {
    ipcRenderer.on('enable-system-audio', callback);
  }
});
