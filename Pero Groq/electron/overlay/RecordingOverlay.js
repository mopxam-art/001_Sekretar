/**
 * Recording Overlay
 *
 * Main class for the recording indicator overlay window.
 * Shows recording status, timer, and meeting indicator.
 *
 * Features:
 * - Recording state visualization (idle/recording/processing)
 * - Real-time timer display
 * - Meeting recording indicator
 * - Auto-hide on inactivity
 * - Draggable window
 *
 * Usage:
 *   const overlay = new RecordingOverlay();
 *   overlay.create();
 *   overlay.updateState(true);  // Start recording
 *   overlay.updateState(false); // Stop recording
 */

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

const { MODES, WINDOW, POSITION, INACTIVITY_TIMEOUT } = require('./config');
const OverlayFSM = require('./fsm');
const TimerManager = require('./timerManager');
const { setupOverlayIPC, removeOverlayIPC } = require('./ipcHandlers');

class RecordingOverlay {
  constructor() {
    /** @type {BrowserWindow|null} Overlay window instance */
    this.window = null;

    /** @type {boolean} Current recording state */
    this.isRecording = false;

    /** @type {boolean} Is app quitting (allow window close) */
    this.isQuitting = false;

    /** @type {OverlayFSM} State machine for overlay modes */
    this.fsm = new OverlayFSM(MODES.COMPACT);

    /** @type {TimerManager} Recording timer */
    this.timer = new TimerManager();

    /** @type {NodeJS.Timeout|null} Inactivity timer */
    this.inactivityTimer = null;

    /**
     * @type {NodeJS.Timeout|null} Watchdog timer (П-24).
     * Срабатывает если recording начат, но stop-сигнал не пришёл за 310 сек
     * (хард-лимит записи 300с + 10с буфер). Защита от случая когда renderer
     * упал с exception и не вызвал updateState(false).
     */
    this.watchdogTimer = null;

    /** @type {NodeJS.Timeout|null} Always-on-top refresh interval */
    this.alwaysOnTopInterval = null;

    /** @type {Object} Electron store for settings */
    this.store = null;
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  /**
   * Create overlay window
   * @returns {BrowserWindow} Created window
   */
  create() {
    // M1 (29.04.2026): multi-monitor support. Юзер с 2+ мониторами перетаскивал
    // overlay на второй монитор → координаты выходили за пределы primary
    // display.workAreaSize → валидация false → fallback на default. Теперь
    // проверяем что точка попадает в workArea ХОТЯ БЫ ОДНОГО display'я
    // (см. screen.getAllDisplays()).
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    // B13 (28.04.2026): дефолтная позиция bottom-center на primary мониторе
    const defaultX = Math.floor(screenWidth / 2 - WINDOW.WIDTH_EXPANDED / 2);
    const defaultY = Math.floor(screenHeight - POSITION.BOTTOM_OFFSET - WINDOW.HEIGHT_EXPANDED);

    // B13: читаем сохранённую позицию из предыдущей сессии. Атомарный объект
    // {x, y} — нет неконсистентного состояния даже после краша между set'ами.
    const savedPosition = this.getStore().get('overlay.position', null);

    // Валидация bounds. Точка валидна если попадает в workArea ХОТЯ БЫ ОДНОГО
    // дисплея (workArea учитывает taskbar/dock — окно не окажется под ним).
    // Также защита от corrupted store: NaN, Infinity, не-число.
    const isPositionValid = (() => {
      if (!savedPosition || typeof savedPosition.x !== 'number' || typeof savedPosition.y !== 'number') {
        return false;
      }
      if (!Number.isFinite(savedPosition.x) || !Number.isFinite(savedPosition.y)) {
        return false;
      }
      const allDisplays = screen.getAllDisplays();
      return allDisplays.some(display => {
        const { x, y, width, height } = display.workArea;
        return (
          savedPosition.x >= x &&
          savedPosition.x <= x + width - WINDOW.WIDTH_EXPANDED &&
          savedPosition.y >= y &&
          savedPosition.y <= y + height - WINDOW.HEIGHT_EXPANDED
        );
      });
    })();

    // Шаг 2.5 (v1.3.89): если позиция вне всех дисплеев (отключили/сменили
    // монитор), но координаты валидны — притягиваем к БЛИЖАЙШЕМУ видимому
    // дисплею (clamp), а не сбрасываем на дефолт bottom-center. Дружелюбнее
    // при смене мониторов: полоска появляется у края, а не «улетает» вниз.
    const hasFiniteCoords = !!savedPosition &&
      Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.y);

    let windowX;
    let windowY;
    if (isPositionValid) {
      windowX = savedPosition.x;
      windowY = savedPosition.y;
    } else if (hasFiniteCoords) {
      const nearest = screen.getDisplayNearestPoint({ x: savedPosition.x, y: savedPosition.y });
      const wa = nearest.workArea;
      windowX = Math.min(Math.max(savedPosition.x, wa.x), wa.x + wa.width - WINDOW.WIDTH_EXPANDED);
      windowY = Math.min(Math.max(savedPosition.y, wa.y), wa.y + wa.height - WINDOW.HEIGHT_EXPANDED);
    } else {
      windowX = defaultX;
      windowY = defaultY;
    }

    // Check auto-hide setting
    const autoHideEnabled = this.checkIfAutoHideEnabled();

    // Create window
    this.window = new BrowserWindow({
      width: WINDOW.WIDTH_EXPANDED,
      height: WINDOW.HEIGHT_EXPANDED,
      x: windowX,
      y: windowY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      type: 'toolbar',
      resizable: false,
      movable: true,
      focusable: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    // Set initial FSM mode
    this.fsm.forceMode(autoHideEnabled ? MODES.COMPACT : MODES.FULL);

    // Устанавливаем уровень поверх всех окон (включая полноэкранные приложения)
    this.window.setAlwaysOnTop(true, 'screen-saver');

    // Дополнительные настройки для работы поверх fullscreen игр
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setFullScreenable(false);

    // Load UI
    this.window.loadFile(path.join(__dirname, 'ui', 'overlay.html'));

    // Enable mouse events
    this.window.setIgnoreMouseEvents(false);

    // Show when ready
    this.window.once('ready-to-show', () => {
      if (this.checkIfShouldShow()) {
        this.window.show();

        // Send initial mode after DOM ready.
        //
        // 🔴 Проверка на уничтоженное окно обязательна (14.08.2026). За эти
        // 100 мс окно может исчезнуть — при закрытии приложения сразу после
        // старта или при запуске второго экземпляра поверх работающего.
        // Тогда `this.window.webContents` бросает `Object has been destroyed`
        // ИЗ ТАЙМЕРА, то есть вне всякого try/catch, и Electron показывает
        // человеку модальное окно «A JavaScript error occurred in the main
        // process». Пугающее, непонятное и ничем не помогающее.
        //
        // Остальные таймеры этого файла (`ensureAlwaysOnTop`, watchdog,
        // таймер бездействия) такую проверку имеют — этот был единственным без.
        setTimeout(() => {
          if (!this.window || this.window.isDestroyed()) return;
          const initialMode = autoHideEnabled ? 'compact' : 'full';
          this.window.webContents.send('overlay-mode-changed', initialMode);
        }, 100);

        // Don't steal focus
        if (this.window.isFocused()) {
          this.window.blur();
        }
      }
    });

    // Prevent close, just hide
    this.window.on('close', (e) => {
      if (!this.isQuitting) {
        e.preventDefault();
        this.timer.stop();
        this.clearInactivityTimer();
        this.window.hide();
      }
    });

    // Restore always-on-top on window events (Windows can lose this state)
    this.window.on('show', () => {
      this.ensureAlwaysOnTop();
    });

    this.window.on('move', () => {
      // B13 (28.04.2026): сохраняем позицию ЕДИНЫМ объектом (R5: атомарность —
      // если краш между двумя set'ами, координаты не остаются неконсистентными).
      // Юзер тащит overlay в удобное место → на следующем запуске оно там же.
      try {
        const [x, y] = this.window.getPosition();
        this.getStore().set('overlay.position', { x, y });
      } catch (err) {
        console.warn('[Overlay] Failed to save position:', err.message);
      }
      // Slight delay to ensure window position is finalized
      setTimeout(() => this.ensureAlwaysOnTop(), 100);
    });

    this.window.on('restore', () => {
      this.ensureAlwaysOnTop();
    });

    // Start periodic always-on-top refresh (every 30 seconds)
    // This ensures overlay stays on top even after long periods
    this.startAlwaysOnTopRefresh();

    // Setup IPC handlers
    setupOverlayIPC(this);

    return this.window;
  }

  // ============================================================
  // ALWAYS-ON-TOP MANAGEMENT
  // ============================================================

  /**
   * Ensure window stays always on top
   * Called periodically and on window events to prevent Windows from losing this state
   */
  ensureAlwaysOnTop() {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      // Re-apply always-on-top with screen-saver level (highest priority)
      this.window.setAlwaysOnTop(true, 'screen-saver');
      // Re-apply fullscreen visibility settings (for games)
      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
  }

  /**
   * Start periodic always-on-top refresh
   * Windows can lose always-on-top state after sleep/hibernate or fullscreen games
   */
  startAlwaysOnTopRefresh() {
    this.stopAlwaysOnTopRefresh();

    // Refresh every 5 seconds (more aggressive for fullscreen games)
    this.alwaysOnTopInterval = setInterval(() => {
      this.ensureAlwaysOnTop();
    }, 5000);
  }

  /**
   * Stop the always-on-top refresh interval
   */
  stopAlwaysOnTopRefresh() {
    if (this.alwaysOnTopInterval) {
      clearInterval(this.alwaysOnTopInterval);
      this.alwaysOnTopInterval = null;
    }
  }

  // ============================================================
  // STATE MANAGEMENT
  // ============================================================

  /**
   * Update recording state
   * @param {boolean} isRecording - Is recording active
   */
  updateState(isRecording) {
    console.log('[Overlay] updateState:', isRecording);
    this.isRecording = isRecording;

    if (isRecording) {
      // Start recording
      this.clearInactivityTimer();
      this.switchToFullMode();

      // Start timer
      this.timer.start((seconds) => {
        this.updateRecordingTime(seconds);
      });

      // П-24: запускаем watchdog — на случай если renderer упадёт
      // и не пришлёт updateState(false). Хард-лимит записи 300с
      // (см. useRecordingV2.ts:435), + 10с буфер.
      this.startWatchdog();
    } else {
      // Stop recording
      this.timer.stop();
      // П-24: чистим watchdog при нормальной остановке
      this.clearWatchdog();
    }

    // Notify UI
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('recording-state-changed', isRecording);
    }
  }

  /**
   * П-24: Watchdog — принудительно остановит запись если за 310 сек
   * не пришёл updateState(false). Защита от зависшего overlay.
   */
  startWatchdog() {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      console.warn('[Overlay] Watchdog: stop-сигнал не пришёл за 310 сек, '
                 + 'принудительная остановка (renderer возможно упал)');
      this.updateState(false);
    }, 310000); // 5 мин 10 сек
  }

  clearWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /**
   * Update recording time display
   * @param {number} seconds - Elapsed seconds
   */
  updateRecordingTime(seconds) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('recording-time-update', seconds);
    }
  }

  // ============================================================
  // MODE SWITCHING (FSM)
  // ============================================================

  /**
   * Switch to full (expanded) mode
   */
  switchToFullMode() {
    if (!this.fsm.transitionTo(MODES.FULL)) {
      return; // Invalid transition
    }

    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('overlay-mode-changed', MODES.FULL);

      // Start inactivity timer if not recording
      if (!this.isRecording) {
        this.startInactivityTimer();
      }
    }
  }

  /**
   * Switch to compact (minimized) mode
   */
  switchToCompactMode() {
    // Don't switch if auto-hide disabled
    if (!this.checkIfAutoHideEnabled()) {
      return;
    }

    if (!this.fsm.transitionTo(MODES.COMPACT)) {
      return; // Invalid transition
    }

    if (this.window && !this.window.isDestroyed() && !this.isRecording) {
      this.window.webContents.send('overlay-mode-changed', MODES.COMPACT);
    }
  }

  // ============================================================
  // INACTIVITY TIMER
  // ============================================================

  /**
   * Start inactivity timer
   * Switches to compact mode after timeout
   */
  startInactivityTimer() {
    this.clearInactivityTimer();

    if (!this.isRecording && this.checkIfAutoHideEnabled()) {
      this.inactivityTimer = setTimeout(() => {
        this.switchToCompactMode();
      }, INACTIVITY_TIMEOUT);
    }
  }

  /**
   * Clear inactivity timer
   */
  clearInactivityTimer() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  /**
   * Reset inactivity timer
   */
  resetInactivityTimer() {
    this.startInactivityTimer();
  }

  // ============================================================
  // VISIBILITY
  // ============================================================

  /**
   * Set overlay visibility
   * @param {boolean} visible - Show or hide
   */
  setVisibility(visible) {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    console.log('[Overlay] setVisibility:', visible);

    if (visible) {
      this.getStore().set('overlay.hidden', false);
      this.window.show();
      this.ensureAlwaysOnTop();
      this.switchToFullMode();

      if (this.window.isFocused()) {
        this.window.blur();
      }
    } else {
      this.getStore().set('overlay.hidden', true);
      this.window.hide();
      this.clearInactivityTimer();
    }
  }

  /**
   * Hide overlay (user action)
   * Saves preference to not show again
   */
  userHide() {
    this.getStore().set('overlay.hidden', true);
    this.hide();

    // Notify main window
    const { BrowserWindow } = require('electron');
    const mainWindow = BrowserWindow.getAllWindows().find(w => {
      if (w.id === this.window?.id) return false;
      const isOverlay = w.isAlwaysOnTop() && !w.isResizable();
      return !isOverlay;
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('overlay-hidden-by-user');
    }
  }

  /**
   * Hide overlay window
   */
  hide() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  /**
   * Check if overlay should be shown
   * @returns {boolean}
   */
  checkIfShouldShow() {
    return !this.getStore().get('overlay.hidden', false);
  }

  // ============================================================
  // AUTO-HIDE SETTINGS
  // ============================================================

  /**
   * Set auto-hide behavior
   * @param {boolean} enabled - Enable auto-hide
   */
  setAutoHide(enabled) {
    console.log('[Overlay] setAutoHide:', enabled);
    this.getStore().set('overlay.autoHide', enabled);

    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    if (enabled) {
      if (!this.isRecording) {
        this.startInactivityTimer();
      }
    } else {
      this.clearInactivityTimer();
      // Force to full mode
      if (this.fsm.isCompact()) {
        this.fsm.forceMode(MODES.FULL);
        this.window.webContents.send('overlay-mode-changed', MODES.FULL);
      }
    }
  }

  /**
   * Check if auto-hide is enabled
   * @returns {boolean}
   */
  checkIfAutoHideEnabled() {
    try {
      return this.getStore().get('overlay.autoHide', true);
    } catch (error) {
      console.error('[Overlay] Failed to check auto-hide:', error);
      return true;
    }
  }

  // ============================================================
  // STORE
  // ============================================================

  /**
   * Get electron store instance
   * @returns {Object} Store instance
   */
  getStore() {
    if (!this.store) {
      try {
        const electronStoreModule = require('electron-store');
        const Store = electronStoreModule.default || electronStoreModule;
        // Шаг 2 (v1.3.89): изолируем overlay-store в ОТДЕЛЬНУЮ под-папку
        // userData/overlay/config.json. Раньше дефолтный config.json делился с
        // hotkeys/main persistentStore (у каждого свой in-memory кэш → взаимное
        // затирание ключей: overlay.position перетиралась tab_complete_enabled
        // от hotkeys → позиция «слетала» при перезапуске). Отдельная папка/файл
        // = никто не затирает. cwd форсим явно (в dev-launch app иногда не
        // детектится самим store'ом → уходил в %APPDATA%/electron-store-nodejs).
        this.store = new Store({
          cwd: path.join(app.getPath('userData'), 'overlay'),
          clearInvalidConfig: true,
        });
      } catch (error) {
        console.error('[Overlay] Failed to init store:', error);
        // Fallback to memory store
        this.store = {
          _data: {},
          get: function(key, defaultValue) {
            return this._data[key] ?? defaultValue;
          },
          set: function(key, value) {
            this._data[key] = value;
          },
          delete: function(key) {
            delete this._data[key];
          }
        };
      }
    }
    return this.store;
  }

  // ============================================================
  // LIFECYCLE
  // ============================================================

  /**
   * Set quitting flag
   * @param {boolean} value
   */
  setQuitting(value) {
    this.isQuitting = value;
  }

  /**
   * Destroy overlay
   */
  destroy() {
    this.timer.stop();
    this.clearInactivityTimer();
    this.clearWatchdog(); // П-24: чистим watchdog при destroy
    this.stopAlwaysOnTopRefresh();
    removeOverlayIPC();

    if (this.window && !this.window.isDestroyed()) {
      this.window.removeAllListeners();
      this.window.destroy();
      this.window = null;
    }
  }

  // ============================================================
  // LEGACY METHODS (for compatibility)
  // ============================================================

  fadeOut() {
    if (!this.isRecording) {
      this.switchToCompactMode();
    }
  }

  fadeIn() {
    this.switchToFullMode();
    if (this.window?.isFocused()) {
      this.window.blur();
    }
  }
}

module.exports = RecordingOverlay;
