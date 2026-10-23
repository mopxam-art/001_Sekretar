const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

/**
 * MeetingNotification - кастомное окно уведомления о встрече
 * Появляется сверху справа в стиле приложения
 */
class MeetingNotification {
  constructor() {
    this.window = null;
  }

  /**
   * Показать уведомление о встрече
   * @param {Object} meetingInfo - информация о встрече
   * @param {Function} onStart - callback при нажатии "Начать запись"
   * @param {Function} onCancel - callback при нажатии "Отмена"
   */
  show(meetingInfo, onStart, onCancel) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }

    // Get screen dimensions for positioning
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // Create notification window (top-right corner)
    this.window = new BrowserWindow({
      width: 340,
      height: 80,
      x: screenWidth - 340 - 20, // 20px from right edge
      y: 20, // 20px from top
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: true,
      hasShadow: true,
      vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
      backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'meetingNotificationPreload.js')
      }
    });

    // Load notification HTML
    this.window.loadFile(path.join(__dirname, 'meeting-notification.html'));

    // Send meeting info when ready
    this.window.webContents.on('did-finish-load', () => {
      this.window.webContents.send('meeting-info', {
        platform: meetingInfo.platform,
        title: meetingInfo.title
      });
    });

    // Show window
    this.window.once('ready-to-show', () => {
      this.window.show();
    });

    // Handle user actions
    ipcMain.once('meeting-notification-start', () => {
      console.log('✅ User clicked START on meeting notification');
      this.close();
      if (onStart) onStart();
    });

    ipcMain.once('meeting-notification-cancel', () => {
      console.log('❌ User clicked CANCEL on meeting notification');
      this.close();
      if (onCancel) onCancel();
    });

    // Auto-close after 15 seconds
    setTimeout(() => {
      if (this.window && !this.window.isDestroyed()) {
        console.log('⏱️ Meeting notification auto-closed after 15 seconds');
        this.close();
        if (onCancel) onCancel();
      }
    }, 15000);

    return this.window;
  }

  /**
   * Закрыть уведомление
   */
  close() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
      this.window = null;
    }
  }

  /**
   * Уничтожить уведомление
   */
  destroy() {
    this.close();
  }
}

module.exports = MeetingNotification;
