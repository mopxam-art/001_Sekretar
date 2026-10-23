/**
 * Hotkeys Manager
 * Управление глобальными горячими клавишами для записи, перевода и отмены
 */

const { GlobalKeyboardListener } = require('node-global-key-listener');
const electronStoreModule = require('electron-store');
const Store = electronStoreModule.default || electronStoreModule;
const { execSync } = require('child_process');

// Пер-клавишный debug-лог раскладки. Печатается на КАЖДОЕ событие клавиши пока
// зажат Ctrl — при hold-записи (Ctrl+Space) авто-повтор Space сыплет ~30 строк/с
// и забивает терминал. По умолчанию ВЫКЛ. Включить при отладке RU-раскладки:
//   PowerShell:  $env:SF_DEBUG_HOTKEYS = '1'   (перед npm run electron-dev)
const DEBUG_HOTKEYS = process.env.SF_DEBUG_HOTKEYS === '1';

class HotkeysManager {
  constructor() {
    this.keyboardListener = null;
    // clearInvalidConfig: true — авто-восстановление при повреждённом config.json
    // (см. main.js для описания)
    this.persistentStore = new Store({ clearInvalidConfig: true });

    // Current hotkeys
    // Default: Ctrl+Space — старый продавец использовал, проблем не было.
    // Безопасно: Ctrl-prefix → Windows интерпретирует как команду, не печатает
    // символ в активное приложение даже при удержании. Конкуренты (Wispr Flow,
    // Talon) используют похожие подходы.
    // TabComplete на Ctrl+Space force-disabled (см. loadSettings) → конфликта нет.
    //
    // ВАЖНО: UI требует "минимум 2 клавиши" в hotkey (см. валидацию в
    // GeneralSettings.tsx, useHotkeyManager.ts). F8 одиночный не пройдёт
    // валидацию — поэтому используем Ctrl+Space (модификатор+клавиша).
    //
    // Что НЕ рекомендуется в качестве hotkey:
    // - Shift+letter (Shift+A → 'ффф' на RU при удержании из-за auto-repeat)
    // - Ctrl+C/V/X/Z (конфликт со стандартными командами)
    // - F1, F5, F11, F12 (конфликт с Help/Refresh/Fullscreen/DevTools)
    // B14 (28.04.2026): дефолт — Ctrl+Space hold. НОВЫЙ юзер сразу получает
    // привычную комбинацию без необходимости лезть в Settings. Существующее
    // значение из persistentStore перезаписывает этот дефолт в loadSettings().
    this.currentHotkey = 'CommandOrControl+Space';
    this.translationHotkey = 'CommandOrControl+Shift+T';
    this.undoHotkey = 'CommandOrControl+Shift+Z';
    this.meetingHotkey = 'CommandOrControl+Shift+M'; // Новый hotkey для встреч
    this.tabCompleteHotkey = 'CommandOrControl+Space'; // Tab-to-Complete (Vision AI)
    this.unifiedMemoryHotkey = 'CommandOrControl+Shift+U'; // Unified Memory Search

    // B14 (28.04.2026): дефолт — hold (удерживать). Юзер привычно зажал
    // Ctrl+Space → говорит → отпустил. Из Settings можно переключить на
    // toggle/streaming. Existing значение из storage перезаписывает.
    // Recording mode: 'hold' or 'toggle' or 'streaming'
    this.recordingMode = 'hold';

    // State tracking
    this.keysPressed = new Set();
    this.recordingHotkeyPressed = false;
    this.translationHotkeyPressed = false;
    this.undoHotkeyPressed = false;
    this.meetingHotkeyPressed = false; // Новый флаг для встреч
    this.tabCompleteHotkeyPressed = false; // Tab-to-Complete флаг
    this.tabCompleteEnabled = true; // Tab-to-Complete enabled flag
    this.unifiedMemoryHotkeyPressed = false; // Unified Memory флаг
    this.keysPressedCleanupInterval = null; // Интервал очистки застрявших клавиш
    this.healthCheckInterval = null; // Интервал проверки здоровья listener'а
    this.listenerRestartCount = 0; // Счётчик перезапусков
    this.lastEventTime = Date.now(); // Время последнего события от listener'а
    // B6 (28.04.2026): заменили throttle на debounce. Throttle делал silent
    // failure: setRecordingHotkey обновлял currentHotkey + storage, но если
    // setupKeyboardListener был throttled — listener оставался подписан на
    // старое значение. Юзер видел Shift+A в Settings, но физически работал
    // дефолт. Debounce копит вызовы за 500мс и выполняет ОДИН restart с
    // актуальным state — silent failure уходит, защита от leak WinKeyServer.exe
    // сохраняется (один restart за окно).
    this._restartTimeout = null;
    this._restartDebounceMs = 500;
    this.isPaused = false; // Флаг для временной паузы хоткеев (при настройке)
    this.pausedAt = 0; // Время когда hotkeys были паузированы
    this.autoPauseResumeInterval = null; // Интервал для автоматического resume
    this.maxPauseDuration = 30000; // Максимальное время паузы (30 секунд)
    this.hasAccessibilityPermission = true; // По умолчанию true для Windows/Linux

    // П-25: globalShortcut migration — OS-level блокировка хоткея записи
    // (Windows RegisterHotKey API). Закрывает корень утечки триггер-буквы:
    // OS не отдаёт зарегистрированную комбинацию активному приложению вообще,
    // независимо от latency JS callback. Fallback на node-global-key-listener
    // если globalShortcut не смог зарегистрировать (комбинация занята другой
    // программой).
    this.recordingShortcutRegistered = null; // accelerator string или null

    // Cooldown: Windows RegisterHotKey ВОЗВРАЩАЕТ повторные события при
    // удержании клавиш (auto-repeat). Без cooldown в toggle/streaming режиме
    // получается start→stop→start→stop 40 раз/сек пока юзер держит. Cooldown
    // сбрасывается только когда юзер физически отпустит клавиши
    // (детектируется через node-global-key-listener UP event).
    this._globalShortcutCooldown = false;

    // П-25 critical: трекинг "юзер физически держит recording-хоткей".
    // Установлен в true когда listener видит первый DOWN ВСЕХ recording keys.
    // Сброшен на UP любой recording key. Используется для блокировки auto-repeat
    // DOWN events на listener-уровне (без зависимости от globalShortcut callback,
    // у которого есть лаг на event delivery → утечка триггер-буквы).
    this._hotkeyKeysHeld = false;

    // П-25 final-resort: счётчик утечек триггер-буквы.
    // node-global-key-listener использует async stdin pipe → IPC lag может
    // превышать Windows hook timeout (300мс) → events проскакивают в активное
    // приложение несмотря на наш return true (мы не получаем confirmation что
    // блокировка реально сработала). Counter инкрементится на КАЖДОМ DOWN
    // recording-trigger key. После release делаем backspace × counter
    // (max 30) чтобы очистить любые утечки.
    this._leakedTriggerCount = 0;

    // П-25 ZOMBIE-KEY защита: track когда key добавлен в keysPressed.
    // Используется для очистки застрявших клавиш — Windows иногда пропускает
    // UP event под нагрузкой → keysPressed остаётся "грязным" и Ctrl/Shift
    // "залипают" → каждый DOWN другой клавиши триггерит наш hotkey → юзер
    // не может печатать (например пробел триггерит "Ctrl+Space" если ctrl
    // zombie в keysPressed).
    this._keyDownTime = {};
    this._zombieTimeoutMs = 15000; // 15 сек — modifier reasonably не держится дольше

    // Callbacks
    this.onStartRecording = null;
    this.onStopRecording = null;
    this.onStartTranslation = null;
    this.onStopTranslation = null;
    this.onUndo = null;
    this.onToggleMeeting = null; // Новый callback для toggle встречи
    this.onTabComplete = null; // Tab-to-Complete callback
    this.onUnifiedMemorySearch = null; // Unified Memory Search callback

    // Load saved settings
    this.loadSettings();
  }

  /**
   * Load saved hotkey settings from persistent storage
   */
  loadSettings() {
    const savedRecordingHotkey = this.persistentStore.get('voice_input_hotkey');
    const savedRecordingMode = this.persistentStore.get('voice_input_mode');
    const savedTranslationHotkey = this.persistentStore.get('translation_hotkey');
    const savedUndoHotkey = this.persistentStore.get('undo_hotkey');
    const savedMeetingHotkey = this.persistentStore.get('meeting_hotkey');
    const savedTabCompleteHotkey = this.persistentStore.get('tab_complete_hotkey');
    const savedTabCompleteEnabled = this.persistentStore.get('tab_complete_enabled');
    const savedUnifiedMemoryHotkey = this.persistentStore.get('unified_memory_hotkey');

    // FIX: Force disable Tab-Complete (Ctrl+Space) for ALL users (including upgrades)
    // This prevents conflicts with other applications (IntelliJ, VSCode, etc.)
    // Remove this block after 2026-02-15 when all users have migrated
    this.persistentStore.set('tab_complete_enabled', false);
    this.tabCompleteEnabled = false;

    if (savedRecordingHotkey) this.currentHotkey = savedRecordingHotkey;
    if (savedRecordingMode) this.recordingMode = savedRecordingMode;
    if (savedTranslationHotkey) this.translationHotkey = savedTranslationHotkey;
    if (savedUndoHotkey) this.undoHotkey = savedUndoHotkey;
    if (savedMeetingHotkey) this.meetingHotkey = savedMeetingHotkey;
    if (savedTabCompleteHotkey) this.tabCompleteHotkey = savedTabCompleteHotkey;
    if (savedTabCompleteEnabled !== undefined) this.tabCompleteEnabled = savedTabCompleteEnabled;
    if (savedUnifiedMemoryHotkey) this.unifiedMemoryHotkey = savedUnifiedMemoryHotkey;

    console.log('[Hotkeys] Settings loaded:', {
      recording: this.currentHotkey,
      mode: this.recordingMode,
      translation: this.translationHotkey,
      undo: this.undoHotkey,
      meeting: this.meetingHotkey,
      tabComplete: this.tabCompleteHotkey,
      unifiedMemory: this.unifiedMemoryHotkey
    });
  }

  /**
   * Initialize keyboard listener
   * @param {boolean} hasAccessibilityPermission - Whether accessibility permission is granted (macOS)
   */
  initialize(hasAccessibilityPermission = true) {
    this.hasAccessibilityPermission = hasAccessibilityPermission;

    if (!hasAccessibilityPermission && process.platform === 'darwin') {
      console.log('[Hotkeys] Skipping initialization - no accessibility permission on macOS');
      console.log('[Hotkeys] Call initializeWhenReady() after user grants permission');
      return;
    }

    this.setupKeyboardListener();
    this.startKeysPressedCleanup();
    this.startHealthCheck();
    console.log('[Hotkeys] Manager initialized');
  }

  /**
   * Initialize hotkeys after accessibility permission is granted
   * Call this when user grants accessibility permission later
   */
  initializeWhenReady() {
    if (this.keyboardListener) {
      console.log('[Hotkeys] Already initialized');
      return;
    }

    console.log('[Hotkeys] Initializing after permission granted');
    this.hasAccessibilityPermission = true;
    this.setupKeyboardListener();
    this.startKeysPressedCleanup();
    this.startHealthCheck();
    console.log('[Hotkeys] Manager initialized (delayed)');
  }

  /**
   * Start periodic cleanup of stuck keys
   * Fixes issue where keys get "stuck" when focus is lost during key press
   */
  startKeysPressedCleanup() {
    // Clear existing interval if any
    if (this.keysPressedCleanupInterval) {
      clearInterval(this.keysPressedCleanupInterval);
    }

    // Every 10 seconds, check if keysPressed has too many entries
    // If no keys are physically pressed, the Set should be empty
    // If it has entries for more than 10 sec without activity, clear it
    this.lastKeyActivity = Date.now();

    this.keysPressedCleanupInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActivity = now - this.lastKeyActivity;

      // If no key activity for 5 seconds and keysPressed is not empty, clear it
      if (timeSinceLastActivity > 5000 && this.keysPressed.size > 0) {
        console.log('[Hotkeys] Clearing stuck keys:', Array.from(this.keysPressed));
        this.keysPressed.clear();
        this.recordingHotkeyPressed = false;
        this.translationHotkeyPressed = false;
        this.undoHotkeyPressed = false;
        this.meetingHotkeyPressed = false;
        this.tabCompleteHotkeyPressed = false;
        this.unifiedMemoryHotkeyPressed = false;
      }
    }, 10000); // Check every 10 seconds

    console.log('[Hotkeys] Keys cleanup interval started');
  }

  /**
   * Start periodic health check of keyboard listener
   * Detects when the underlying key server process dies and restarts it
   */
  startHealthCheck() {
    // Clear existing interval if any
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Maximum restarts per hour to prevent runaway process creation
    const maxRestartsPerHour = 10;

    // Check listener health every 60 seconds (increased from 30)
    this.healthCheckInterval = setInterval(() => {
      // Prevent too many restarts
      if (this.listenerRestartCount >= maxRestartsPerHour) {
        console.error(`[Hotkeys] Too many restarts (${this.listenerRestartCount}), stopping health check`);
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
        return;
      }

      if (!this.isListenerAlive()) {
        this.listenerRestartCount++;
        console.warn(`[Hotkeys] Listener appears dead, restarting... (restart #${this.listenerRestartCount})`);
        this.setupKeyboardListener();
      }
    }, 60000); // Check every 60 seconds (increased from 30)

    console.log('[Hotkeys] Health check interval started');
  }

  /**
   * Check if the keyboard listener is still alive
   * Returns false if the listener or its underlying process is dead
   */
  isListenerAlive() {
    if (!this.keyboardListener) {
      console.log('[Hotkeys] Health check: listener is null');
      return false;
    }

    // Check if the underlying server process exists and is not killed
    // node-global-key-listener uses a child process internally
    try {
      const serverProcess = this.keyboardListener._serverProcess;
      if (serverProcess) {
        // Check if process is killed or has exited
        if (serverProcess.killed || serverProcess.exitCode !== null) {
          console.log('[Hotkeys] Health check: server process is dead', {
            killed: serverProcess.killed,
            exitCode: serverProcess.exitCode
          });
          return false;
        }
      }

      // Additional check: if no events for a very long time (5 minutes),
      // the listener might be stuck even if the process appears alive
      const timeSinceLastEvent = Date.now() - this.lastEventTime;
      if (timeSinceLastEvent > 5 * 60 * 1000) { // 5 minutes
        console.log('[Hotkeys] Health check: no events for 5+ minutes, assuming stuck');
        return false;
      }
    } catch (err) {
      console.error('[Hotkeys] Health check error:', err);
      return false;
    }

    return true;
  }

  /**
   * Parse hotkey string to Set of required keys
   */
  parseHotkeyToSet(hotkey) {
    // Шаг 5: делегируем чистой утилите — добавляет OEM-алиасы ('`'/'ё'/'~' →
    // 'section'), иначе backquote-хоткей никогда не матчился (#10).
    return require('../utils/hotkeyMatch').parseHotkeyToSet(hotkey);
  }

  /**
   * Kill WinKeyServer processes on Windows using taskkill
   * This is more reliable than proc.kill() which doesn't work well on Windows
   * @param {number} timeout - Timeout in ms (default 3000ms)
   */
  killWinKeyServerProcesses(timeout = 3000) {
    if (process.platform !== 'win32') return;

    try {
      // Kill all WinKeyServer.exe processes with timeout to prevent hang
      execSync('taskkill /F /IM WinKeyServer.exe /T', {
        stdio: 'ignore',
        windowsHide: true,
        timeout: timeout // Add timeout to prevent hang
      });
      console.log('[Hotkeys] Killed WinKeyServer processes via taskkill');
    } catch (err) {
      // Error is expected if no processes are running or timeout
      if (err.killed) {
        console.log('[Hotkeys] taskkill timed out after', timeout, 'ms');
      } else if (!err.message || !err.message.includes('not found')) {
        console.log('[Hotkeys] No WinKeyServer processes to kill (or already killed)');
      }
    }
  }

  /**
   * П-25: ранее использовали globalShortcut (RegisterHotKey API), но
   * тесты выявили что он блокирует только первый press, не auto-repeat
   * events. На русской раскладке это давало утечку 'ф' при удержании.
   *
   * Listener-only подход (node-global-key-listener с suppress=true)
   * блокирует ВСЕ DOWN events надёжно. Эта функция теперь только
   * чистит остатки старой регистрации (на случай горячей перезагрузки).
   */
  _tryRegisterRecordingShortcut() {
    const { globalShortcut } = require('electron');

    // Снять предыдущую регистрацию если осталась
    if (this.recordingShortcutRegistered) {
      try {
        globalShortcut.unregister(this.recordingShortcutRegistered);
        console.log('[Hotkeys] Unregistered previous globalShortcut:', this.recordingShortcutRegistered);
      } catch (err) {
        console.warn('[Hotkeys] Error unregistering previous globalShortcut:', err.message);
      }
      this.recordingShortcutRegistered = null;
    }

    console.log('[Hotkeys] Recording hotkey will use listener-only path (no globalShortcut)');
    return false; // recordingShortcutRegistered=null → listener fallback path активируется
  }

  /**
   * Setup keyboard listener with all hotkeys (DEBOUNCED).
   *
   * B6 (28.04.2026): debounce-обёртка. При череде быстрых вызовов делаем
   * restart ОДИН раз через 500мс с актуальным state. Это снимает silent
   * failure throttle-варианта (юзер менял хоткей в Settings → state и storage
   * обновлялись, но listener оставался на старом значении).
   *
   * R1: если recordingHotkeyPressed === true — defer restart до отпускания
   * клавиш. Listener kill во время активной записи прерывает её.
   */
  setupKeyboardListener() {
    if (this._restartTimeout) {
      clearTimeout(this._restartTimeout);
    }
    this._restartTimeout = setTimeout(() => {
      this._restartTimeout = null;

      // R1: не перезапускаем listener пока юзер держит recording-хоткей,
      // иначе текущая запись прервётся. Откладываем до отпускания клавиш.
      if (this.recordingHotkeyPressed) {
        console.log('[Hotkeys] Restart deferred — recording in progress, will retry after key release');
        // Через 500мс попробуем снова. Если запись всё ещё идёт — снова отложим.
        this.setupKeyboardListener();
        return;
      }

      this._actuallySetupKeyboardListener();
    }, this._restartDebounceMs);
  }

  /**
   * Actual listener setup. Не вызывать напрямую — используй setupKeyboardListener()
   * (он debounce'ит вызовы и проверяет recordingHotkeyPressed).
   */
  _actuallySetupKeyboardListener() {
    console.log('[Hotkeys] Setting up keyboard listener...');

    // Clean up previous listener.
    // ВАЖНО: node-global-key-listener НЕ имеет removeAllListeners — был баг
    // когда метод вызывался и падал TypeError, после чего kill() даже не
    // вызывался → старый listener висел в памяти, новый шорткат не работал
    // пока user не нажимал «Изменить» вручную второй раз.
    if (this.keyboardListener) {
      try {
        console.log('[Hotkeys] Killing previous listener...');
        this.keyboardListener.kill();
      } catch (err) {
        console.error('[Hotkeys] Error killing previous listener:', err);
      }
      this.keyboardListener = null;
    }

    // Force kill any orphaned WinKeyServer processes on Windows
    this.killWinKeyServerProcesses();

    // П-25: пробуем зарегистрировать recording hotkey через globalShortcut
    // (OS-level блокировка). Если не удалось — fallback на node-global-key-listener
    // (он создаётся ниже для всех остальных хоткеев в любом случае).
    this._tryRegisterRecordingShortcut();

    // Create new listener
    try {
      this.keyboardListener = new GlobalKeyboardListener();
      console.log('[Hotkeys] Keyboard listener created successfully');
    } catch (err) {
      console.error('[Hotkeys] Failed to create keyboard listener:', err);
      return;
    }

    // Clear global state
    this.keysPressed.clear();
    this.recordingHotkeyPressed = false;
    this.translationHotkeyPressed = false;
    this.undoHotkeyPressed = false;
    this.meetingHotkeyPressed = false;
    this.tabCompleteHotkeyPressed = false;
    this.unifiedMemoryHotkeyPressed = false;

    // Parse all hotkeys
    const recordingKeys = this.parseHotkeyToSet(this.currentHotkey);
    const translationKeys = this.parseHotkeyToSet(this.translationHotkey);
    const undoKeys = this.parseHotkeyToSet(this.undoHotkey);
    const meetingKeys = this.parseHotkeyToSet(this.meetingHotkey);
    const tabCompleteKeys = this.parseHotkeyToSet(this.tabCompleteHotkey);
    const unifiedMemoryKeys = this.parseHotkeyToSet(this.unifiedMemoryHotkey);

    // Add listener
    // IMPORTANT: Returning true from the callback suppresses the key event,
    // preventing it from being sent to other applications (fixes qqqqq bug)
    this.keyboardListener.addListener((e, down) => {
      if (!e || !e.name) return;

      // Update last activity timestamp for cleanup
      this.lastKeyActivity = Date.now();
      // Update last event time for health check
      this.lastEventTime = Date.now();

      // Skip hotkey processing if paused (during hotkey configuration)
      if (this.isPaused) {
        return; // Don't suppress, let keys pass through to the app
      }

      // Get key name, normalize it
      let keyName = e.name.toLowerCase().replace('left ', '').replace('right ', '');

      // Debug: log key events when Ctrl is pressed (to debug Russian layout issues).
      // Под флагом SF_DEBUG_HOTKEYS — иначе авто-повтор при hold-записи флудит терминал.
      if (DEBUG_HOTKEYS && (this.keysPressed.has('ctrl') || keyName === 'ctrl')) {
        console.log('[Hotkeys DEBUG] Key event:', { name: e.name, rawKey: e.rawKey, state: e.state, keyName });
      }

      // Track if we should suppress this key event
      let shouldSuppress = false;

      if (e.state === 'DOWN') {
        // П-25 АГРЕССИВНЫЙ zombie-key cleanup:
        // 1. Прямой опрос Windows через keysender.isButtonPressed для каждого
        //    модификатора в keysPressed. Если Windows говорит "не нажат" —
        //    это zombie (Windows пропустил UP event под нагрузкой). Удаляем.
        //    Это **deterministic** — узнаём правду от ОС.
        // 2. Fallback timeout 15 сек для случаев когда keysender недоступен
        //    или ключ не модификатор.
        const _now = Date.now();

        // Sanity-check модификаторов через прямой опрос Windows
        if (this.keysPressed.has('ctrl') || this.keysPressed.has('shift') || this.keysPressed.has('alt')) {
          try {
            const { isButtonPressed } = require('keysender');
            for (const mod of ['ctrl', 'shift', 'alt']) {
              if (this.keysPressed.has(mod) && !isButtonPressed('keyboard', mod)) {
                console.warn('[Hotkeys] Modifier zombie cleanup:', mod,
                             '— Windows says NOT pressed, removing from keysPressed');
                this.keysPressed.delete(mod);
                delete this._keyDownTime[mod];
              }
            }
          } catch (err) {
            // keysender недоступен — пропускаем, fallback на timeout cleanup ниже
          }
        }

        // Timeout-based zombie cleanup ТОЛЬКО для не-модификаторов.
        // КРИТИЧНО: модификаторы (ctrl/shift/alt) не генерируют auto-repeat
        // events → их _keyDownTime не обновляется → через 15 сек удалялись
        // зря (юзер реально держал). Это ломало long recording sessions
        // (>15 сек) — Ctrl "зомбифицировался" → recording внезапно останавливался.
        // Для модификаторов используем deterministic isButtonPressed (выше).
        const MODIFIER_KEYS = ['ctrl', 'shift', 'alt', 'meta'];
        for (const k of Array.from(this.keysPressed)) {
          if (MODIFIER_KEYS.includes(k)) continue; // skip — обрабатывается через isButtonPressed
          if (this._keyDownTime[k] && (_now - this._keyDownTime[k] > this._zombieTimeoutMs)) {
            console.warn('[Hotkeys] Zombie key cleanup (timeout):', k,
                         'was DOWN for', (_now - this._keyDownTime[k]) + 'ms');
            this.keysPressed.delete(k);
            delete this._keyDownTime[k];
          }
        }

        this.keysPressed.add(keyName);
        this._keyDownTime[keyName] = _now;

        // ESCAPE: Stop any active recording
        if (keyName === 'escape') {
          if (this.onStopRecording) this.onStopRecording();
          if (this.onStopTranslation) this.onStopTranslation();
          return;
        }

        // Check which hotkey combination is pressed
        const hasAllRecordingKeys = Array.from(recordingKeys).every(key => this.keysPressed.has(key));
        const hasAllTranslationKeys = Array.from(translationKeys).every(key => this.keysPressed.has(key));
        const hasAllUndoKeys = Array.from(undoKeys).every(key => this.keysPressed.has(key));
        const hasAllMeetingKeys = Array.from(meetingKeys).every(key => this.keysPressed.has(key));
        const hasAllTabCompleteKeys = Array.from(tabCompleteKeys).every(key => this.keysPressed.has(key));

        const hasAllUnifiedMemoryKeys = Array.from(unifiedMemoryKeys).every(key => this.keysPressed.has(key));

        const hasOnlyRecordingKeys = hasAllRecordingKeys && this.keysPressed.size === recordingKeys.size;
        const hasOnlyTranslationKeys = hasAllTranslationKeys;
        const hasOnlyUndoKeys = hasAllUndoKeys && this.keysPressed.size === undoKeys.size;
        const hasOnlyMeetingKeys = hasAllMeetingKeys && this.keysPressed.size === meetingKeys.size;
        const hasOnlyTabCompleteKeys = hasAllTabCompleteKeys && this.keysPressed.size === tabCompleteKeys.size;
        const hasOnlyUnifiedMemoryKeys = hasAllUnifiedMemoryKeys && this.keysPressed.size === unifiedMemoryKeys.size;

        // Handle Recording hotkey
        // listener-only подход: всегда suppress + tracking. Из-за async IPC lag
        // (node-global-key-listener stdin pipe) suppress может не успеть до
        // Windows hook timeout — тогда events проскакивают в активное приложение.
        // Чтобы это компенсировать, считаем утечки в _leakedTriggerCount
        // и чистим их через backspace на UP (см. UP handler ниже).
        if (hasOnlyRecordingKeys) {
          shouldSuppress = true; // всегда (listener-only)
          this._hotkeyKeysHeld = true;

          // П-25 leak-tracking: triggerKey = последняя буква без модификатора
          // (например 'a' в Shift+A). Инкремент на КАЖДОМ DOWN — даже если
          // suppress сработал, лучше "удалить лишний" чем оставить утечку.
          const trigKey = Array.from(recordingKeys).find(
            k => !['ctrl', 'shift', 'alt', 'meta'].includes(k)
          );
          // Шаг 5.3: убрали `&& trigKey.length === 1` — нормализованный OEM-триггер
          // ('section' для backquote, длина 7) иначе НЕ отслеживался → символ '`'
          // мог просочиться в активное окно на suppress-гонке.
          if (trigKey && keyName === trigKey) {
            this._leakedTriggerCount++;
          }

          if (!this.recordingHotkeyPressed) {
            console.log('[Hotkeys] Recording hotkey pressed, mode:', this.recordingMode);
            this.recordingHotkeyPressed = true;
            if (this.onStartRecording) {
              this.onStartRecording(this.recordingMode);
            } else {
              console.warn('[Hotkeys] onStartRecording callback not set!');
            }
          }
        }

        // П-25 Фикс A: defense-in-depth для race в порядке нажатия.
        // Применяется ТОЛЬКО в fallback режиме (без globalShortcut).
        // С globalShortcut — Windows сама блокирует на kernel-level.
        const recordingTrigger = Array.from(recordingKeys).find(
          k => !['ctrl', 'shift', 'alt', 'meta'].includes(k)
        );
        const recordingMods = Array.from(recordingKeys).filter(
          k => ['ctrl', 'shift', 'alt', 'meta'].includes(k)
        );
        if (!this.recordingShortcutRegistered
            && recordingTrigger && keyName === recordingTrigger
            && recordingMods.length > 0
            && recordingMods.some(m => this.keysPressed.has(m))) {
          shouldSuppress = true;
        }

        // Handle Translation hotkey
        if (hasOnlyTranslationKeys) {
          shouldSuppress = true;
          if (!this.translationHotkeyPressed) {
            this.translationHotkeyPressed = true;
            if (this.onStartTranslation) {
              this.onStartTranslation();
            }
          }
        }

        // Handle Undo hotkey
        if (hasOnlyUndoKeys) {
          shouldSuppress = true;
          if (!this.undoHotkeyPressed) {
            this.undoHotkeyPressed = true;
            if (this.onUndo) {
              this.onUndo();
            }
          }
        }

        // Handle Meeting hotkey (toggle mode)
        if (hasOnlyMeetingKeys) {
          shouldSuppress = true;
          if (!this.meetingHotkeyPressed) {
            console.log('[Hotkeys] Meeting hotkey pressed (toggle)');
            this.meetingHotkeyPressed = true;
            if (this.onToggleMeeting) {
              this.onToggleMeeting();
            } else {
              console.warn('[Hotkeys] onToggleMeeting callback not set!');
            }
          }
        }

        // Handle Tab-Complete hotkey (one-shot trigger)
        if (hasOnlyTabCompleteKeys && this.tabCompleteEnabled) {
          shouldSuppress = true;
          if (!this.tabCompleteHotkeyPressed) {
            console.log('[Hotkeys] Tab-Complete hotkey pressed');
            this.tabCompleteHotkeyPressed = true;
            if (this.onTabComplete) {
              this.onTabComplete();
            } else {
              console.warn('[Hotkeys] onTabComplete callback not set!');
            }
          }
        }

        // Handle Unified Memory hotkey (one-shot trigger)
        if (hasOnlyUnifiedMemoryKeys) {
          shouldSuppress = true;
          if (!this.unifiedMemoryHotkeyPressed) {
            console.log('[Hotkeys] Unified Memory hotkey pressed');
            this.unifiedMemoryHotkeyPressed = true;
            if (this.onUnifiedMemorySearch) {
              this.onUnifiedMemorySearch();
            } else {
              console.warn('[Hotkeys] onUnifiedMemorySearch callback not set!');
            }
          }
        }

        // Also suppress keys while recording in hold mode to prevent typing
        // П-25: catch-all suppress для ВСЕХ режимов (hold/toggle/streaming).
        // Блокирует auto-repeat DOWN events пока recording-флаг true →
        // буква-триггер не проскакивает в активное приложение
        // (например 'a'/'ф' в русской раскладке).
        if (this.recordingHotkeyPressed) {
          shouldSuppress = true;
        }

      } else if (e.state === 'UP') {
        this.keysPressed.delete(keyName);
        delete this._keyDownTime[keyName];

        // П-25 cooldown: сбрасываем cooldown когда юзер отпустил
        // ЛЮБУЮ клавишу из recording-комбинации. Это позволит следующему
        // press'у globalShortcut снова обработать (start или toggle-stop).
        if (recordingKeys.has(keyName) && this._globalShortcutCooldown) {
          this._globalShortcutCooldown = false;
        }

        // П-25 critical: сбрасываем _hotkeyKeysHeld на UP любой recording key.
        // После этого следующий DOWN не будет блокироваться как auto-repeat.
        if (recordingKeys.has(keyName)) {
          this._hotkeyKeysHeld = false;
        }

        // П-25: backspace-cleanup ОТКЛЮЧЕН — удалял валидный текст пользователя.
        // Counter показывал "теоретическое количество утечек", но listener.suppress
        // блокировал часть → реальная утечка < counter → backspace удалял лишнее.
        // Reset counter всё равно (на случай будущих фичей).
        this._leakedTriggerCount = 0;

        // Check if recording keys are still pressed
        const stillHasAllRecordingKeys = Array.from(recordingKeys).every(key => this.keysPressed.has(key));
        const stillHasAllTranslationKeys = Array.from(translationKeys).every(key => this.keysPressed.has(key));
        const stillHasAllUndoKeys = Array.from(undoKeys).every(key => this.keysPressed.has(key));
        const stillHasAllMeetingKeys = Array.from(meetingKeys).every(key => this.keysPressed.has(key));
        const stillHasAllTabCompleteKeys = Array.from(tabCompleteKeys).every(key => this.keysPressed.has(key));

            // Stop recording in 'hold' mode when keys released
        if (!stillHasAllRecordingKeys && this.recordingMode === 'hold' && this.recordingHotkeyPressed) {
          console.log('[Hotkeys] Recording keys released (hold mode)');
          this.recordingHotkeyPressed = false;
          // КРИТИЧНО: НЕ suppress UP события! Если suppress UP CTRL —
          // Chrome/Notepad/любое активное окно НЕ узнает что юзер отпустил
          // Ctrl → modifier "залипает" на стороне активного окна → нажатие F
          // открывает поиск (Ctrl+F), нажатие S вызывает Save (Ctrl+S) и т.д.
          // UP события всегда должны доходить до активного окна.
          // shouldSuppress = false; (по умолчанию)
          if (this.onStopRecording) {
            this.onStopRecording();
          }

          // П-25 АГРЕССИВНЫЙ FORCE-CLEAR: после release recording-keys
          // принудительно очищаем весь keysPressed. Это снимает любые
          // "залипшие" модификаторы (когда Windows пропустил UP event и
          // isButtonPressed тоже врёт — кеширует stale state).
          // Безопасно: если юзер реально держит Ctrl — следующий DOWN
          // его снова добавит. После записи модификаторы не должны быть
          // нажаты в нормальном workflow.
          console.log('[Hotkeys] Force-clear keysPressed after recording session:',
                      Array.from(this.keysPressed));
          this.keysPressed.clear();
          this._keyDownTime = {};
          this._hotkeyKeysHeld = false;
        }

        // Reset flag in 'toggle' mode
        if (!stillHasAllRecordingKeys && this.recordingMode === 'toggle' && this.recordingHotkeyPressed) {
          console.log('[Hotkeys] Recording keys released (toggle mode - flag reset only)');
          this.recordingHotkeyPressed = false;
        }

        // ИСПРАВЛЕНО: streaming = TOGGLE (как у Wispr Flow и других конкурентов).
        // 1й press → start; release ничего не делает; 2й press → stop.
        // Раньше я делал streaming = hold (release stops), но это противоречит
        // ожиданиям юзеров — они делают короткие тапы и запись мгновенно
        // останавливается. Теперь только сбрасываем флаг на release, остановка
        // через второй press globalShortcut callback / listener.
        if (!stillHasAllRecordingKeys && this.recordingMode === 'streaming' && this.recordingHotkeyPressed) {
          console.log('[Hotkeys] Recording keys released (streaming mode - flag reset only)');
          this.recordingHotkeyPressed = false;
          // НЕ вызываем onStopRecording — appEventHandlers.onStartRecording
          // сам toggle'ит на следующий press.
        }

        // Stop translation when keys released
        if (!stillHasAllTranslationKeys && this.translationHotkeyPressed) {
          this.translationHotkeyPressed = false;
          // НЕ suppress UP — иначе модификаторы залипают в активном окне
          if (this.onStopTranslation) {
            this.onStopTranslation();
          }
        }

        // Reset undo flag
        if (!stillHasAllUndoKeys && this.undoHotkeyPressed) {
          this.undoHotkeyPressed = false;
        }

        // Reset meeting flag
        if (!stillHasAllMeetingKeys && this.meetingHotkeyPressed) {
          this.meetingHotkeyPressed = false;
        }

        // Reset tab-complete flag
        if (!stillHasAllTabCompleteKeys && this.tabCompleteHotkeyPressed) {
          this.tabCompleteHotkeyPressed = false;
        }

        // Reset unified memory flag
        const stillHasAllUnifiedMemoryKeys = Array.from(unifiedMemoryKeys).every(key => this.keysPressed.has(key));
        if (!stillHasAllUnifiedMemoryKeys && this.unifiedMemoryHotkeyPressed) {
          this.unifiedMemoryHotkeyPressed = false;
        }
      }

      // Return true to suppress the key event and prevent it from being sent to other apps
      if (shouldSuppress) {
        return true;
      }
    });

    console.log('[Hotkeys] Listener setup complete');
  }

  /**
   * Update recording hotkey
   */
  setRecordingHotkey(hotkey) {
    // Шаг 5.6: пере-нормализуем сохранённую строку ('Alt+ё' → 'Alt+`') для дисплея
    // (матч и так через OEM_ALIAS). Идемпотентно, валидные хоткеи не трогает.
    const normalized = require('../utils/hotkeyMatch').normalizeStoredHotkey(hotkey);
    console.log('[Hotkeys] Setting recording hotkey:', normalized);
    this.currentHotkey = normalized;
    this.persistentStore.set('voice_input_hotkey', normalized);
    this.setupKeyboardListener();
    console.log('[Hotkeys] Recording hotkey updated successfully');
    return true;
  }

  /**
   * Update translation hotkey
   */
  setTranslationHotkey(hotkey) {
    console.log('[Hotkeys] Setting translation hotkey:', hotkey);
    this.translationHotkey = hotkey;
    this.persistentStore.set('translation_hotkey', hotkey);
    this.setupKeyboardListener();
    console.log('[Hotkeys] Translation hotkey updated successfully');
    return true;
  }

  /**
   * Update undo hotkey
   */
  setUndoHotkey(hotkey) {
    console.log('[Hotkeys] Setting undo hotkey:', hotkey);
    this.undoHotkey = hotkey;
    this.persistentStore.set('undo_hotkey', hotkey);
    this.setupKeyboardListener();
    console.log('[Hotkeys] Undo hotkey updated successfully');
    return true;
  }

  /**
   * Update recording mode
   */
  setRecordingMode(mode) {
    this.recordingMode = mode;
    this.persistentStore.set('voice_input_mode', mode);
    this.setupKeyboardListener();
    console.log('[Hotkeys] Recording mode updated:', mode);
  }

  /**
   * Update tab-complete hotkey
   */
  setTabCompleteHotkey(hotkey) {
    console.log('[Hotkeys] Setting tab-complete hotkey:', hotkey);
    this.tabCompleteHotkey = hotkey;
    this.persistentStore.set('tab_complete_hotkey', hotkey);
    this.setupKeyboardListener();
    console.log('[Hotkeys] Tab-complete hotkey updated successfully');
    return true;
  }

  /**
   * Enable/disable Tab-Complete feature
   */
  setTabCompleteEnabled(enabled) {
    console.log('[Hotkeys] Setting tab-complete enabled:', enabled);
    this.tabCompleteEnabled = enabled;
    this.persistentStore.set('tab_complete_enabled', enabled);
    return true;
  }

  /**
   * Update unified memory hotkey
   */
  setUnifiedMemoryHotkey(hotkey) {
    console.log('[Hotkeys] Setting unified memory hotkey:', hotkey);
    this.unifiedMemoryHotkey = hotkey;
    this.persistentStore.set('unified_memory_hotkey', hotkey);
    this.setupKeyboardListener();
    console.log('[Hotkeys] Unified memory hotkey updated successfully');
    return true;
  }

  /**
   * Get current settings
   */
  getSettings() {
    return {
      recordingHotkey: this.currentHotkey,
      translationHotkey: this.translationHotkey,
      undoHotkey: this.undoHotkey,
      tabCompleteHotkey: this.tabCompleteHotkey,
      unifiedMemoryHotkey: this.unifiedMemoryHotkey,
      recordingMode: this.recordingMode
    };
  }

  /**
   * Get listener status for diagnostics
   */
  getStatus() {
    const isAlive = this.isListenerAlive();
    const timeSinceLastEvent = Date.now() - this.lastEventTime;

    return {
      isAlive,
      restartCount: this.listenerRestartCount,
      timeSinceLastEventMs: timeSinceLastEvent,
      timeSinceLastEventFormatted: this.formatDuration(timeSinceLastEvent),
      keysCurrentlyPressed: Array.from(this.keysPressed)
    };
  }

  /**
   * Format duration in human-readable format
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Force restart the keyboard listener
   * Can be called manually via IPC if needed
   */
  forceRestart() {
    console.log('[Hotkeys] Force restarting listener...');
    this.listenerRestartCount++;
    this.setupKeyboardListener();
    return this.getStatus();
  }

  /**
   * Pause hotkey processing (for hotkey configuration UI)
   * Keys will still be tracked but won't trigger actions
   * Auto-resumes after maxPauseDuration (30 seconds) to prevent stuck paused state
   */
  pause() {
    console.log('[Hotkeys] Pausing hotkey processing...');
    this.isPaused = true;
    this.pausedAt = Date.now();

    // Clear any pressed state to avoid stuck keys
    this.keysPressed.clear();
    this.recordingHotkeyPressed = false;
    this.translationHotkeyPressed = false;
    this.undoHotkeyPressed = false;
    this.meetingHotkeyPressed = false;
    this.tabCompleteHotkeyPressed = false;
    this.unifiedMemoryHotkeyPressed = false;

    // Start auto-resume timer to prevent stuck paused state
    // This handles cases where user closes window without clicking Save/Cancel
    this.startAutoPauseResume();

    return { success: true, isPaused: this.isPaused };
  }

  /**
   * Resume hotkey processing after configuration
   */
  resume() {
    console.log('[Hotkeys] Resuming hotkey processing...');
    this.isPaused = false;
    this.pausedAt = 0;

    // Stop auto-resume timer
    this.stopAutoPauseResume();

    // Clear pressed keys to start fresh
    this.keysPressed.clear();
    return { success: true, isPaused: this.isPaused };
  }

  /**
   * Start auto-pause-resume interval
   * Automatically resumes hotkeys if paused for too long
   */
  startAutoPauseResume() {
    // Clear existing interval if any
    this.stopAutoPauseResume();

    // Check every 5 seconds if pause has exceeded max duration
    this.autoPauseResumeInterval = setInterval(() => {
      if (this.isPaused && this.pausedAt > 0) {
        const pausedDuration = Date.now() - this.pausedAt;
        if (pausedDuration >= this.maxPauseDuration) {
          console.log(`[Hotkeys] Auto-resuming after ${pausedDuration}ms pause (max: ${this.maxPauseDuration}ms)`);
          this.resume();
        }
      }
    }, 5000);
  }

  /**
   * Stop auto-pause-resume interval
   */
  stopAutoPauseResume() {
    if (this.autoPauseResumeInterval) {
      clearInterval(this.autoPauseResumeInterval);
      this.autoPauseResumeInterval = null;
    }
  }

  /**
   * Check if hotkeys are paused
   */
  getIsPaused() {
    return this.isPaused;
  }

  /**
   * Cleanup on app quit - with fast timeout to prevent hanging
   */
  cleanup() {
    console.log('[Hotkeys] Starting cleanup...');

    // B6 (28.04.2026): чистим pending debounced restart чтобы не сработал
    // после destroy-я класса — иначе TypeError на убитом listener'е.
    if (this._restartTimeout) {
      clearTimeout(this._restartTimeout);
      this._restartTimeout = null;
    }

    // Stop cleanup interval
    if (this.keysPressedCleanupInterval) {
      clearInterval(this.keysPressedCleanupInterval);
      this.keysPressedCleanupInterval = null;
    }

    // Stop health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Stop auto-pause-resume interval
    this.stopAutoPauseResume();

    // П-25: unregister globalShortcut recording hotkey
    if (this.recordingShortcutRegistered) {
      try {
        const { globalShortcut } = require('electron');
        globalShortcut.unregister(this.recordingShortcutRegistered);
        console.log('[Hotkeys] Unregistered globalShortcut on cleanup:', this.recordingShortcutRegistered);
      } catch (err) {
        console.warn('[Hotkeys] Error unregistering globalShortcut on cleanup:', err.message);
      }
      this.recordingShortcutRegistered = null;
    }

    if (this.keyboardListener) {
      // ВАЖНО: node-global-key-listener НЕ имеет removeAllListeners (это второе
      // место где этот баг был — П-5 в bagi_pol4ovatelei.md). Раньше
      // removeAllListeners кидал TypeError → outer catch ловил → kill() в той
      // же try-ветке не вызывался → WinKeyServer.exe висел в фоне → держал
      // global hotkey → новый запуск приложения не мог их зарегистрировать.
      // Это и был корень П-8 (zombie-процессы после закрытия).
      try {
        this.keyboardListener.kill();
        console.log('[Hotkeys] Listener killed gracefully');
      } catch (killErr) {
        console.log('[Hotkeys] Graceful kill failed, forcing cleanup');
      }
      this.keyboardListener = null;
    }

    // Force kill any remaining WinKeyServer processes on Windows.
    // Увеличен timeout с 2с до 5с — на медленных машинах taskkill /T /F иногда
    // не успевает обойти всё process tree за 2 секунды.
    this.killWinKeyServerProcesses(5000);

    console.log('[Hotkeys] Cleanup complete');
  }
}

module.exports = HotkeysManager;
