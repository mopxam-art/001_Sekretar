const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  onMeetingInfo: (callback) => {
    ipcRenderer.on('meeting-info', (event, meetingInfo) => {
      callback(meetingInfo);
    });
  },
  startRecording: () => {
    ipcRenderer.send('meeting-notification-start');
  },
  cancelNotification: () => {
    ipcRenderer.send('meeting-notification-cancel');
  }
});
