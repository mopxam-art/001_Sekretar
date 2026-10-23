/**
 * Overlay IPC Handlers
 *
 * All IPC event handlers for the Recording Overlay.
 * Handles communication between overlay window and main process.
 *
 * Events handled:
 * - overlay-mouse-enter/leave/move - Mouse tracking for auto-hide
 * - overlay-clicked - Show main window
 * - overlay-hide-requested - User clicked close button
 */

const { ipcMain, BrowserWindow } = require('electron');

/**
 * Setup all IPC handlers for overlay
 * @param {RecordingOverlay} overlay - Overlay instance
 */
function setupOverlayIPC(overlay) {
  // ============================================================
  // MOUSE TRACKING
  // ============================================================

  /**
   * Mouse entered overlay area
   * - Enable mouse events
   * - Clear inactivity timer
   * - Switch to full mode
   */
  ipcMain.on('overlay-mouse-enter', () => {
    if (overlay.window && !overlay.window.isDestroyed()) {
      overlay.window.setIgnoreMouseEvents(false);
    }
    overlay.clearInactivityTimer();
    overlay.switchToFullMode();
  });

  /**
   * Mouse left overlay area
   * - Enable click-through
   * - Start inactivity timer (if not recording)
   */
  ipcMain.on('overlay-mouse-leave', () => {
    if (overlay.window && !overlay.window.isDestroyed()) {
      overlay.window.setIgnoreMouseEvents(true, { forward: true });
    }

    if (!overlay.isRecording) {
      overlay.startInactivityTimer();
      console.log('[Overlay IPC] Inactivity timer started after mouse leave');
    }
  });

  /**
   * Mouse moved inside overlay
   * - Reset inactivity timer
   */
  ipcMain.on('overlay-mouse-move', () => {
    if (!overlay.fsm.isCompact()) {
      overlay.resetInactivityTimer();
    }
  });

  // ============================================================
  // USER ACTIONS
  // ============================================================

  /**
   * User clicked on overlay
   * - Show and focus main window
   */
  ipcMain.on('overlay-clicked', () => {
    const mainWindow = findMainWindow(overlay.window?.id);
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  /**
   * User clicked close (X) button
   * - Hide overlay and save preference
   */
  ipcMain.on('overlay-hide-requested', () => {
    console.log('[Overlay IPC] Hide requested by user');
    overlay.userHide();
  });

  console.log('[Overlay IPC] Handlers registered');
}

/**
 * Find main application window
 * @param {number} excludeWindowId - Window ID to exclude (overlay)
 * @returns {BrowserWindow|null}
 */
function findMainWindow(excludeWindowId) {
  return BrowserWindow.getAllWindows().find(w => {
    if (w.id === excludeWindowId) return false;
    // Main window is not always-on-top and is resizable
    const isOverlay = w.isAlwaysOnTop() && !w.isResizable();
    return !isOverlay;
  });
}

/**
 * Remove all IPC handlers
 * Call this when destroying overlay
 */
function removeOverlayIPC() {
  ipcMain.removeAllListeners('overlay-mouse-enter');
  ipcMain.removeAllListeners('overlay-mouse-leave');
  ipcMain.removeAllListeners('overlay-mouse-move');
  ipcMain.removeAllListeners('overlay-clicked');
  ipcMain.removeAllListeners('overlay-hide-requested');

  console.log('[Overlay IPC] Handlers removed');
}

module.exports = {
  setupOverlayIPC,
  removeOverlayIPC
};
