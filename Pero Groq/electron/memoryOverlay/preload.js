const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memoryAPI', {
  // Close overlay
  close: () => ipcRenderer.invoke('memory-overlay-close'),

  // Get auth config (token + apiUrl)
  getConfig: () => ipcRenderer.invoke('memory-overlay-get-config'),

  // Search memory
  search: (query) => ipcRenderer.invoke('memory-overlay-search', query),

  // Insert text result
  insertText: (text) => ipcRenderer.invoke('memory-overlay-insert', text),

  // Listen for reset event
  onReset: (callback) => {
    ipcRenderer.removeAllListeners('memory-overlay-reset');
    ipcRenderer.on('memory-overlay-reset', callback);
  }
});
