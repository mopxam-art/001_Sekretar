const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('translationAPI', {
  // Receive translation data
  onTranslationData: (callback) => {
    ipcRenderer.on('translation-data', (event, data) => {
      callback(data);
    });
  },

  // Receive history updates
  onHistoryUpdate: (callback) => {
    ipcRenderer.on('history-update', (event, history) => {
      callback(history);
    });
  },

  // Close overlay
  close: () => {
    ipcRenderer.send('translation-overlay-close');
  },

  // Mouse events for auto-hide control
  notifyMouseEnter: () => {
    ipcRenderer.send('translation-overlay-mouse-enter');
  },

  notifyMouseLeave: () => {
    ipcRenderer.send('translation-overlay-mouse-leave');
  },

  // Copy text to clipboard
  copyText: (text) => {
    ipcRenderer.send('translation-overlay-copy', text);
  },

  // Clear session history
  clearHistory: () => {
    ipcRenderer.send('translation-overlay-clear-history');
  }
});
