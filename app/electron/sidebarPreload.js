const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Meeting info
  onMeetingInfo: (callback) => {
    ipcRenderer.on('meeting-info', (event, info) => callback(info));
  },

  // Auto-start signal
  onAutoStart: (callback) => {
    ipcRenderer.on('auto-start', () => callback());
  },

  // Mute/unmute when dictation is active
  onMute: (callback) => {
    ipcRenderer.on('sidebar-mute', () => callback());
  },

  onUnmute: (callback) => {
    ipcRenderer.on('sidebar-unmute', () => callback());
  },

  // Transcript updates
  onTranscriptUpdate: (callback) => {
    ipcRenderer.on('transcript-update', (event, data) => callback(data));
  },

  // AI suggestions
  onAISuggestion: (callback) => {
    ipcRenderer.on('ai-suggestion', (event, suggestion) => callback(suggestion));
  },

  // Actions
  finish: (data) => ipcRenderer.send('sidebar-finish', data),
  minimize: () => ipcRenderer.send('sidebar-minimize'),
  expand: () => ipcRenderer.send('sidebar-expand'),

  // Get access token - use same handler as overlay
  getAccessToken: () => ipcRenderer.invoke('overlay-get-access-token'),

  // Get API URL - use same handler as overlay
  getApiUrl: () => ipcRenderer.invoke('overlay-get-api-url'),

  // Loopback audio
  enableLoopbackAudio: () => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopbackAudio: () => ipcRenderer.invoke('disable-loopback-audio'),

  // Save as note - use same handler as overlay
  saveAsNote: (transcript) => ipcRenderer.invoke('live-assistant-save-note', transcript)
});
