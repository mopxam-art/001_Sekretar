/**
 * SpeakFlow - Main Process
 * Optimized 2026 version with lazy loading and minimal memory footprint
 */

const { app, powerMonitor, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { initMain } = require('electron-audio-loopback');
const electronStoreModule = require('electron-store');
const Store = electronStoreModule.default || electronStoreModule;
require('dotenv').config();

// File logging — должен подключаться рано, чтобы перехватить console.* всех
// последующих модулей. Сама конфигурация (file path) откладывается до
// app.whenReady() — иначе app.getPath() упадёт.
const fileLogger = require('./utils/fileLogger');
fileLogger.attachToConsole();

// ============ PERFORMANCE OPTIMIZATIONS 2026 ============
// FIX: Disabled GPU acceleration flags - they crash fullscreen games!
// These flags conflict with DirectX exclusive fullscreen mode
// app.commandLine.appendSwitch('enable-gpu-rasterization');
// app.commandLine.appendSwitch('enable-zero-copy');
// app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder');

// FIX: Removed disable-gpu-compositing - it causes black screen on some Intel GPUs
// Use default GPU settings for maximum compatibility
// app.commandLine.appendSwitch('disable-gpu-compositing');

// Memory optimizations - increased from 256MB to 512MB (React + Mantine + TipTap need more)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
app.commandLine.appendSwitch('disable-renderer-backgrounding'); // Keep renderer responsive when hidden

// Disable unnecessary features for faster startup
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('disable-extensions');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-translate');
app.commandLine.appendSwitch('metrics-recording-only');
app.commandLine.appendSwitch('no-first-run');
app.commandLine.appendSwitch('safebrowsing-disable-auto-update');

// v1.3.84 (23.05.2026): отключаем GPU acceleration для всех юзеров.
// Lunar Lake + старые Intel drivers валят renderer (GlitchTip Issue #1 crashed
// -1073741819 + killed code:1). Software rendering достаточно быстрый для нашего
// UI (нет 3D/WebGL/canvas-heavy). Должно быть вызвано ДО app.whenReady().
app.disableHardwareAcceleration();

// v1.3.84 (23.05.2026): AppUserModelId для Windows toast notifications.
// Должен совпадать с appId в package.json:build. Без этого Windows показывает
// уведомления как "Electron" вместо "SpeakFlow" или вообще не показывает на
// свежих установках. NSIS installer обычно устанавливает автоматически, но
// явный вызов гарантирует и в edge-cases (portable, dev mode).
if (process.platform === 'win32') {
  app.setAppUserModelId('com.speakflow.app');
}

// Modules
const WindowManager = require('./modules/windowManager');
const HotkeysManager = require('./modules/hotkeys');
const { registerIpcHandlers } = require('./modules/ipc');
const { registerTranslatorHandlers } = require('./modules/translatorHandlers');
const { setupHotkeysCallbacks, setupMeetingDetectorCallbacks, setupSystemEventHandlers } = require('./modules/appEventHandlers');

// Services - lazy loaded
const secureStore = require('./secureStore');
const audioCacheManager = require('./audioCacheManager');
const { AutoUpdaterManager } = require('./modules/autoUpdater');

// ============ ENVIRONMENT ============
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const API_URL = isDev
  ? (process.env.API_URL || 'http://localhost:4000')
  : 'https://api.speakflow.ru';

// ============ SENTRY SETUP ============
const Sentry = require("@sentry/electron/main");
const { normalizeGpuInfo, buildGpuContext } = require('./utils/gpuContext');
let cachedGpu = null; // Шаг 3: закэшированный GPUInfo (наполняется на whenReady)
let sentryDSN = process.env.SENTRY_DSN || '';

if (!isDev && !sentryDSN) {
  try {
    const buildConfig = require('../build.config.js');
    sentryDSN = buildConfig.SENTRY_DSN || '';
  } catch (err) {
    console.warn('[Sentry] Could not load build config');
  }
}

// Privacy opt-out: юзер отключил отчёты об ошибках в Settings → Конфиденциальность.
// localStorage в main-process недоступен, поэтому используем файл-flag в userData.
// Файл создаётся/удаляется через IPC handler 'set-sentry-opt-out' (см. ipcMain.handle ниже).
let sentryOptedOutMain = false;
try {
  const optOutFile = path.join(app.getPath('userData'), 'sentry_opt_out');
  sentryOptedOutMain = fs.existsSync(optOutFile);
  if (sentryOptedOutMain) {
    console.log('[Sentry] Opt-out flag detected, Sentry disabled in main process');
  }
} catch (err) {
  // Silent fail — fallback на enabled=true
}

// ============ ANON ID (Шаг 1) ============
// Стабильный per-install идентификатор для Sentry, когда юзер НЕ залогинен
// (гость / первый запуск). Без него краши до логина шли анонимно → userCount=0
// у Issues в GlitchTip. machineId один и тот же в main и renderer (тот же
// node-machine-id) → renderer-anon == main-anon = одна установка = один "юзер".
function getPersistedAnonUuid() {
  // Прямой fs (НЕ electron-store): getMainAnonId зовётся на init ДО app.ready,
  // где new Store() иногда падает; app.getPath('userData')+fs работают (см. :96).
  try {
    const p = path.join(app.getPath('userData'), 'anon-id.json');
    let id = null;
    try { id = JSON.parse(fs.readFileSync(p, 'utf8')).anonId; } catch { /* нет файла / битый */ }
    if (!id) {
      id = 'uuid-' + require('crypto').randomUUID();
      try { fs.writeFileSync(p, JSON.stringify({ anonId: id })); } catch { /* диск RO — вернём разовый */ }
    }
    return String(id);
  } catch {
    return 'unknown';
  }
}
function getMainAnonId() {
  // E2E: форсим путь persisted-UUID (эмуляция «machineIdSync упал») — T1.7/T1.8.
  if (process.env.SF_E2E === '1' && process.env.SF_E2E_FORCE_ANON_FALLBACK === '1') {
    return getPersistedAnonUuid();
  }
  // E2E-детерминизм: тот же id, что renderer берёт из get-machine-id (Шаг 0.4).
  if (process.env.SF_E2E === '1' && process.env.SF_E2E_MACHINE_ID) {
    return process.env.SF_E2E_MACHINE_ID;
  }
  try {
    const mid = secureStore.getMachineId();
    if (mid) return String(mid);
  } catch {
    // machineIdSync упал (VM / hardened OS) → persisted UUID
  }
  return getPersistedAnonUuid();
}

Sentry.init({
  dsn: sentryDSN || 'https://b6bda3c950654d7b819211da12e082e2@errors.speakflow.ru/1',
  release: `speakflow-electron@${app.getVersion()}`,
  environment: isDev ? 'development' : 'production',
  enabled: !sentryOptedOutMain,
  // Тот же фильтр что в renderer — token / Bearer redact в любом event'е
  beforeSend(event) {
    try {
      const json = JSON.stringify(event);
      const cleaned = json
        .replace(/(accessToken|refreshToken|password|secret|authorization|api[-_]?key)\s*[:=]\s*['"]?[\w.-]+['"]?/gi, '$1=***REDACTED***')
        .replace(/Bearer\s+[\w.-]+/gi, 'Bearer ***REDACTED***')
        // 26.08.2026: те же голые ?token=/?receipt=, что и в fileLogger —
        // две независимые точки redact обязаны знать одинаковый набор.
        .replace(/([?&](?:token|receipt)=)[^&\s'"\\]+/gi, '$1***REDACTED***');
      const sanitized = JSON.parse(cleaned);
      // Шаг 0 (E2E-only seam): пишем ИСХОДЯЩЕЕ (уже очищенное) событие в файл,
      // чтобы Playwright-тесты читали user.id / errorName / context.gpu. Гейт по
      // SF_E2E — в prod ветка мёртвая (T0.6); пишем ПОСЛЕ sanitize (T0.7).
      if (process.env.SF_E2E === '1') {
        try {
          const f = path.join(app.getPath('userData'), 'sf-e2e-events.jsonl');
          fs.appendFileSync(f, JSON.stringify(sanitized) + '\n');
        } catch { /* тест-хелпер недоступен — не мешаем отправке */ }
      }
      return sanitized;
    } catch {
      return null; // если sanitize упал — не отправляем
    }
  },
});

// v1.3.86 (Phase C): setUser в main process сразу после init.
// До этого Sentry.setUser в renderer НЕ применялся к event'ам main process
// (краши main / IPC / autoUpdater), что давало userCount=0 у всех Issues
// в GlitchTip. Phase G v1 в v1.3.85 пытался решить через renderer setUser
// + tags, но не сработал т.к. main process — отдельный Sentry SDK.
//
// Читаем сохранённого юзера из secureStore (восстанавливается между запусками).
// Если юзер ещё не залогинился — оставляем anonymous, renderer вызовет
// IPC bridge `sentry-set-user` после логина (см. handler в appHandlers).
//
// Email НЕ включаем при старте — privacy-conservative default. Renderer
// при вызове IPC bridge пробрасывает actual sentry_attach_email флаг из
// localStorage, тогда email может быть прикреплён.
try {
  if (!sentryOptedOutMain) {
    const storedUser = secureStore.getUser();
    if (storedUser && storedUser.id) {
      const userObj = {
        id: String(storedUser.id),
        username: String(storedUser.id), // GlitchTip часто агрегирует по username
      };
      Sentry.setUser(userObj);
      Sentry.setTag('user_id', String(storedUser.id));
      console.log('[Sentry] Main process setUser at init:', { id: userObj.id });
    } else {
      // Шаг 1.1: гость / первый запуск → стабильный anon-id по machineId на
      // ГЛОБАЛЬНОМ scope. captureMessage в windowManager его наследует (withScope
      // не нужен). Одна машина = один anon = один "юзер" в GlitchTip.
      const anonId = 'anon-' + getMainAnonId();
      Sentry.setUser({ id: anonId, username: anonId });
      Sentry.setTag('user_id', anonId);
      console.log('[Sentry] Main process setUser at init (anon):', { id: anonId });
    }
  }
} catch (err) {
  console.warn('[Sentry] Failed to setUser in main process:', err && err.message);
}

// Шаг 0 (E2E-only seam): отдаём уже инициализированный Sentry в globalThis,
// чтобы Playwright app.evaluate мог форсить события (в app.evaluate нет require).
if (process.env.SF_E2E === '1') {
  globalThis.__sfSentry = Sentry;
  globalThis.__sfGetAnonId = getMainAnonId; // renderer get-machine-id берёт тот же id
}

// Initialize electron-audio-loopback BEFORE app is ready
initMain();

// ============ APP STATE ============
let windowManager;
let hotkeysManager;
// Шаг 3 (v1.3.89): восстановление настроек из last-known-good бэкапа ДО
// создания любого Store. Без этого clearInvalidConfig тихо обнуляет битый
// config.json (например после краша во время записи), и юзер теряет хоткеи/
// позицию overlay. Guard кладёт валидную копию в .bak и восстанавливает из
// неё, если основной файл повреждён/пропал. Запускать ПЕРВЫМ — до new Store().
try {
  const { recoverConfigs } = require('./utils/configRecovery');
  const recovery = recoverConfigs(app.getPath('userData'));
  if (Object.values(recovery).some(v => String(v).startsWith('recovered'))) {
    console.log('[Store] config recovery from backup:', JSON.stringify(recovery));
  }
} catch (e) {
  console.error('[Store] config recovery guard failed:', e);
}

// clearInvalidConfig: true — если config.json повреждён (например после
// апгрейда поверх старой версии или с повреждённого диска), electron-store
// тихо стирает файл вместо краха «JSON.parse Unexpected token». Дефолтные
// значения подгрузятся, юзер не потеряет доступ к приложению.
let persistentStore = new Store({ clearInvalidConfig: true });
let autoUpdater = null;

// Lazy-loaded services (created on first use)
let _overlay = null;
let _liveAssistantOverlay = null;
let _liveAssistantSidebar = null;
let _translationOverlay = null;
let _memoryOverlay = null;
let _clipboardManager = null;
let _clipboardTranslation = null;
let _meetingDetector = null;

// ============ LAZY LOADERS ============
// These functions create instances only when first needed

function getOverlay() {
  if (!_overlay) {
    console.log('[Lazy] Creating RecordingOverlay');
    const RecordingOverlay = require('./overlay');
    _overlay = new RecordingOverlay();
    _overlay.create();
  }
  return _overlay;
}

function getMemoryOverlay() {
  if (!_memoryOverlay) {
    console.log('[Lazy] Creating MemoryOverlay');
    const MemoryOverlay = require('./memoryOverlay/MemoryOverlay');
    _memoryOverlay = new MemoryOverlay();
    _memoryOverlay.create();
  }
  return _memoryOverlay;
}

function getTranslationOverlay() {
  if (!_translationOverlay) {
    console.log('[Lazy] Creating TranslationOverlay');
    const TranslationOverlay = require('./translationOverlay');
    _translationOverlay = new TranslationOverlay();
    _translationOverlay.create();
  }
  return _translationOverlay;
}

function getLiveAssistantOverlay() {
  if (!_liveAssistantOverlay) {
    console.log('[Lazy] Creating LiveAssistantOverlay');
    const LiveAssistantOverlay = require('./liveAssistantOverlay');
    _liveAssistantOverlay = new LiveAssistantOverlay();
  }
  return _liveAssistantOverlay;
}

function getLiveAssistantSidebar() {
  if (!_liveAssistantSidebar) {
    console.log('[Lazy] Creating LiveAssistantSidebar');
    const LiveAssistantSidebar = require('./LiveAssistantSidebar');
    _liveAssistantSidebar = new LiveAssistantSidebar();
  }
  return _liveAssistantSidebar;
}

function getClipboardManager() {
  if (!_clipboardManager) {
    console.log('[Lazy] Creating ClipboardManager');
    const ClipboardManager = require('./clipboardManager');
    _clipboardManager = new ClipboardManager();
  }
  return _clipboardManager;
}

function getClipboardTranslation(mainWindow) {
  if (!_clipboardTranslation) {
    console.log('[Lazy] Creating ClipboardTranslation');
    const ClipboardTranslation = require('./clipboardTranslation');
    _clipboardTranslation = new ClipboardTranslation(mainWindow, getTranslationOverlay());
  }
  return _clipboardTranslation;
}

function getMeetingDetector() {
  if (!_meetingDetector) {
    console.log('[Lazy] Creating MeetingDetector');
    const MeetingDetector = require('./MeetingDetector');
    _meetingDetector = new MeetingDetector();
  }
  return _meetingDetector;
}

// ============ PROTOCOL HANDLER REGISTRATION ============
// Test-only предохранитель. E2E запускает временную копию приложения из
// каталога сборки, и обычная регистрация переписывает системную ассоциацию
// speakflow:// на этот временный путь. После завершения теста путь исчезает,
// и рабочие ссылки перестают открываться (проверено 15.08.2026 на реестре).
// Guard срабатывает только на точное значение переменной, которую выставляет
// tests/e2e/helpers.ts; production-ветка и обработка deep-link не меняются.
const skipProtocolRegistration = process.env.SF_E2E_SKIP_PROTOCOL_REGISTRATION === '1';
if (process.platform === 'win32' && !skipProtocolRegistration) {
  if (isDev) {
    app.setAsDefaultProtocolClient('speakflow', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('speakflow');
  }
}

// ============ SINGLE INSTANCE LOCK ============
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Шаг 9 (упрощено 26.04 после live-теста UX):
  // Стандартный паттерн Electron-приложений (Telegram, Discord, Slack):
  // второй экземпляр тихо квитается, первый через app.on('second-instance')
  // поднимает своё окно. Юзер видит «оно уже работает».
  //
  // Раньше здесь был русский диалог «SpeakFlow уже запущен» с двумя
  // кнопками — но live-тест показал что это сбивает с толку: первый
  // экземпляр уже поднял окно через second-instance event, и юзер
  // получал ОДНОВРЕМЕННО окно SpeakFlow + диалог-вопрос. Знакомый
  // паттерн без диалога — лучший UX.
  //
  // tree-kill убивает наш process.pid (включая renderer/GPU helpers
  // второго экземпляра) — иначе app.exit оставлял бы их зомби.
  // Первый экземпляр живёт в ДРУГОМ дереве процессов, его не трогаем.
  try {
    require('tree-kill')(process.pid);
  } catch { /* Если tree-kill сломался — fallback на app.exit ниже */ }
  // Safety: если tree-kill не успел убить нас за 500мс — app.exit(0)
  setTimeout(() => app.exit(0), 500);
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Шаг 9: при попытке запустить второй instance — поднимаем окно
    // первого. Раньше работало через windowManager.showWindow(),
    // расширяем чтобы окно ещё и focus получало (если было свёрнуто).
    if (windowManager) {
      windowManager.showWindow();
      const mainWindow = windowManager.getMainWindow();
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    }

    const url = commandLine.find(arg => arg.startsWith('speakflow://'));
    if (url) {
      handleDeepLink(url);
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

// ============ DEEP LINK HANDLER ============
// 26.08.2026 (roadmap Electron-атрибуции, P4). Три правки разом:
//   1. 🔴 Полный URL больше НЕ логируется никогда: раньше строки main.js:403 и
//      main.js:667 клали боевой JWT в %APPDATA%/SpeakFlow/logs/main.log — тот
//      самый файл, который мы штатно просим прислать с жалобой. Логируется
//      только purpose и факт наличия payload.
//   2. В одном протоколе теперь ДВА purpose, и парсер различает их явно:
//      speakflow://auth?token=<JWT>      — вход (существующий механизм);
//      speakflow://attr?receipt=<opaque> — квитанция установки (новый).
//      Чужой формат в чужой канал не попадает.
//   3. Слепой setTimeout(1000) заменён буфером: событие, пришедшее раньше,
//      чем renderer смонтировал слушатели, не теряется молча — оно ждёт
//      сигнала готовности renderer'а и отдаётся после него. Факт «пришёл, но
//      некому отдать» логируется явно.

// Форма квитанции фиксирована сервером (install-attribution.service.ts).
const RECEIPT_SHAPE_RE = /^sfr1_[A-Za-z0-9_-]{43}$/;
// JWT deep-link: не валидируем содержимое (это дело backend), только не-пустоту.

let rendererReadyForDeepLinks = false;
const pendingDeepLinks = [];
const MAX_PENDING_DEEP_LINKS = 4;

function deliverDeepLink(channel, payload) {
  if (windowManager) {
    windowManager.showWindow();
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && rendererReadyForDeepLinks) {
      mainWindow.webContents.send(channel, payload);
      return;
    }
  }
  // Renderer ещё не готов (cold start, антивирусный warmup 30-90 с — штатный
  // сценарий проекта). Буферизуем и говорим об этом вслух.
  console.log(`[DeepLink] Renderer not ready — buffered channel=${channel}`);
  // Ревью 26.08.2026: при переполнении роняем СТАРЕЙШЕЕ, не новейшее — свежий
  // auth-токен (TTL 5 минут) ценнее протухшего из начала очереди.
  if (pendingDeepLinks.length >= MAX_PENDING_DEEP_LINKS) {
    const dropped = pendingDeepLinks.shift();
    console.warn('[DeepLink] Pending buffer full — oldest event dropped', dropped.channel);
  }
  pendingDeepLinks.push({ channel, payload });
}

function flushPendingDeepLinks() {
  if (!windowManager) return;
  const mainWindow = windowManager.getMainWindow();
  if (!mainWindow) return;
  while (pendingDeepLinks.length > 0) {
    const { channel, payload } = pendingDeepLinks.shift();
    console.log(`[DeepLink] Delivering buffered channel=${channel}`);
    mainWindow.webContents.send(channel, payload);
  }
}

// Renderer сообщает о готовности слушателей (App.tsx, после монтирования).
ipcMain.on('renderer-ready-for-deeplinks', () => {
  rendererReadyForDeepLinks = true;
  flushPendingDeepLinks();
});

function handleDeepLink(url) {
  try {
    const parsedUrl = new URL(url);
    const route = parsedUrl.hostname || parsedUrl.pathname.replace(/^\//, '');

    if (route === 'auth') {
      const token = parsedUrl.searchParams.get('token');
      console.log(`[DeepLink] Received purpose=auth hasToken=${Boolean(token)}`);
      if (token) deliverDeepLink('auth-from-deeplink', token);
      return;
    }

    if (route === 'attr') {
      const receipt = parsedUrl.searchParams.get('receipt');
      const valid = typeof receipt === 'string' && RECEIPT_SHAPE_RE.test(receipt);
      console.log(`[DeepLink] Received purpose=attr validReceipt=${valid}`);
      // Кривая квитанция не идёт в renderer: там ей делать нечего.
      if (valid) deliverDeepLink('attribution-receipt', receipt);
      return;
    }

    // Неизвестный purpose: логируем только маршрут, без query.
    console.log(`[DeepLink] Received unknown purpose route=${route}`);
  } catch (error) {
    // error.message у кривого URL может содержать сам URL — не логируем его.
    console.error('[DeepLink] Failed to parse deep link (URL not logged)');
    Sentry.captureException(new Error('DeepLink parse failed'));
  }
}

// ============ MACOS PERMISSIONS ============
async function requestMacOSPermissions() {
  if (process.platform !== 'darwin') return { accessibilityGranted: true };

  try {
    const { systemPreferences, dialog, shell } = require('electron');
    const permissionsStore = new Store({ name: 'permissions', clearInvalidConfig: true });

    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log('[Permissions] Microphone status:', micStatus);

    if (micStatus === 'not-determined') {
      console.log('[Permissions] Requesting microphone access (first time)...');
      const granted = await systemPreferences.askForMediaAccess('microphone');
      console.log('[Permissions] Microphone granted:', granted);
    } else if (micStatus === 'denied') {
      console.log('[Permissions] Microphone denied - user needs to enable in System Preferences');
    }

    const accessibilityGranted = systemPreferences.isTrustedAccessibilityClient(false);
    console.log('[Permissions] Accessibility status:', accessibilityGranted);

    const accessibilityAsked = permissionsStore.get('accessibilityAsked', false);

    if (!accessibilityGranted && !accessibilityAsked) {
      console.log('[Permissions] Accessibility NOT granted - showing instruction dialog');
      permissionsStore.set('accessibilityAsked', true);

      const result = await dialog.showMessageBox({
        type: 'warning',
        title: 'Требуется разрешение',
        message: 'SpeakFlow требует разрешение "Универсальный доступ" для работы горячих клавиш.',
        detail: 'Без этого разрешения горячие клавиши не будут работать.\n\n' +
          'Нажмите "Открыть настройки" и добавьте SpeakFlow в список разрешённых приложений:\n\n' +
          'Системные настройки → Конфиденциальность и безопасность → Универсальный доступ',
        buttons: ['Открыть настройки', 'Позже'],
        defaultId: 0,
        cancelId: 1
      });

      if (result.response === 0) {
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      }
    }

    const screenStatus = systemPreferences.getMediaAccessStatus('screen');
    console.log('[Permissions] Screen recording status:', screenStatus);

    return { accessibilityGranted };
  } catch (error) {
    console.error('[Permissions] Error requesting macOS permissions:', error);
    return { accessibilityGranted: false };
  }
}

// ============ APP READY ============
app.whenReady().then(async () => {
  // Конфигурируем file logger — теперь app.getPath() доступен
  try {
    fileLogger.configureLogger();
  } catch (logErr) {
    console.error('[Main] fileLogger configuration failed:', logErr);
  }

  // ============ GPU CONTEXT (Шаг 3) ============
  // Обогащаем краши (render-process-gone) моделью/вендором/драйвером GPU —
  // половина 0xC0000005 связана с GPU. getGPUInfo async → кэшируем и ставим на
  // ГЛОБАЛЬНЫЙ scope (captureMessage в windowManager наследует). featureStatus
  // (sync) добавляется в buildGpuContext. fire-and-forget, старт не блокируем.
  const applyGpuContext = () => {
    try {
      if (!sentryOptedOutMain) {
        Sentry.setContext('gpu', buildGpuContext(cachedGpu, () => app.getGPUFeatureStatus()));
      }
    } catch (e) { /* setContext не критично */ }
  };
  app.getGPUInfo('complete')
    .then((info) => {
      cachedGpu = normalizeGpuInfo(info);
      console.log('[GPU] cached context:', JSON.stringify(cachedGpu)); // T3.9: раз залогировать реальные поля
      applyGpuContext();
    })
    .catch((gpuErr) => {
      console.warn('[GPU] getGPUInfo failed:', gpuErr && gpuErr.message);
      applyGpuContext(); // без модели, но с featureStatus (T3.6)
    });

  // ============ COLD-START PRE-WARM (roadmap cold-start Шаг 1) ============
  // Греем TLS-соединение к API ДО того как renderer выстрелит свои ~9 запросов.
  // На машинах с антивирусом (Kaspersky/Avast/ESET) первый HTTPS-хендшейк
  // перехватывается TLS-MITM и занимает 30-60 сек → приложение выглядит зависшим.
  // main и renderer делят defaultSession network pool + TLS session cache →
  // прогретый здесь сокет/хендшейк переиспользуется renderer'ом (Electron 38,
  // session.preconnect подтверждён). fire-and-forget, окно НЕ блокируем.
  try {
    const { session, net } = require('electron');
    const apiOrigin = (() => {
      const raw = process.env.VITE_API_URL || 'https://api.speakflow.ru';
      try { return new URL(raw).origin; } catch { return 'https://api.speakflow.ru'; }
    })();
    const prewarmT0 = Date.now();
    // 1. preconnect — открыть TCP+TLS сокеты заранее (numSockets 4: покрыть burst при HTTP/1.1)
    session.defaultSession.preconnect({ url: apiOrigin, numSockets: 4 });
    console.log(`[Prewarm] preconnect → ${apiOrigin} (4 sockets) issued in ${Date.now() - prewarmT0}ms`);
    // 2. net.fetch /health — догрев полного пути + проба живости.
    //    Бьём в /health (НЕ /api/health — там 404). fire-and-forget.
    net.fetch(`${apiOrigin}/health`)
      .then(r => console.log(`[Prewarm] /health ${Date.now() - prewarmT0}ms status=${r.status}`))
      .catch(err => console.warn(`[Prewarm] /health failed in ${Date.now() - prewarmT0}ms: ${err.message}`));
  } catch (prewarmErr) {
    console.warn('[Prewarm] skipped:', prewarmErr.message);
  }

  // IPC handler для логов из renderer процесса.
  // Renderer не имеет прямого fs-доступа (security), пишем за него.
  ipcMain.handle('log-from-renderer', (_event, level, message, context) => {
    try {
      const validLevels = ['error', 'warn', 'info', 'verbose', 'debug', 'silly'];
      const safeLevel = validLevels.includes(level) ? level : 'info';
      // Префикс [Renderer] чтобы отличать от main-логов в одном файле
      fileLogger.log[safeLevel](`[Renderer] ${message}`, context);
    } catch (err) {
      console.warn('[Main] log-from-renderer failed:', err.message);
    }
  });

  // Шаг 7: открыть папку с логами в Проводнике/Finder
  ipcMain.handle('open-logs-folder', async () => {
    try {
      const { shell } = require('electron');
      const logsPath = path.join(app.getPath('userData'), 'logs');
      await shell.openPath(logsPath);
      return { success: true };
    } catch (err) {
      console.error('[Main] open-logs-folder failed:', err);
      return { success: false, error: err.message };
    }
  });

  // Privacy opt-out для Sentry в main-процессе через файл-flag.
  // Renderer (Settings → Конфиденциальность → toggle) вызывает этот IPC.
  // Main-процесс при следующем запуске прочитает файл и применит enabled=false.
  // Sentry.init читается один раз при старте — поэтому требует перезапуска.
  ipcMain.handle('set-sentry-opt-out', async (_event, optOut) => {
    try {
      const optOutFile = path.join(app.getPath('userData'), 'sentry_opt_out');
      if (optOut) {
        await fs.promises.writeFile(optOutFile, '1');
        console.log('[Sentry] Opt-out flag created:', optOutFile);
      } else {
        try {
          await fs.promises.unlink(optOutFile);
          console.log('[Sentry] Opt-out flag removed');
        } catch (err) {
          // ENOENT (файла нет) — норма, юзер кликнул on без предыдущего off
          if (err.code !== 'ENOENT') throw err;
        }
      }
      return { success: true };
    } catch (err) {
      console.error('[Main] set-sentry-opt-out failed:', err);
      return { success: false, error: err.message };
    }
  });

  // v1.3.86 (Phase C): bridge для проброса user info из renderer в main process.
  // Renderer при логине / при init с cached user вызывает этот IPC, чтобы
  // main процесс знал кто текущий юзер. Без этого Sentry events из main
  // (краши main / IPC / autoUpdater) идут анонимно → userCount=0 в GlitchTip.
  //
  // Уважаем sentry_opt_out флаг (если файл есть — игнорируем вызов).
  // email опционален — renderer пробрасывает его только если у юзера НЕ
  // включён privacy opt-out для email.
  ipcMain.handle('sentry-set-user', async (_event, payload) => {
    try {
      if (sentryOptedOutMain) {
        return { success: false, reason: 'opted_out' };
      }
      const userId = payload && payload.userId;
      const email = payload && payload.email;
      if (!userId) {
        // Шаг 1.5: logout → возвращаемся на стабильный anon-id (НЕ null), иначе
        // последующие краши снова userCount=0 и одна машина плодит "юзеров".
        const anonId = 'anon-' + getMainAnonId();
        Sentry.setUser({ id: anonId, username: anonId });
        Sentry.setTag('user_id', anonId);
        console.log('[Sentry] Main process: setUser reverted to anon on logout:', anonId);
        return { success: true, cleared: true, anon: anonId };
      }
      const userObj = {
        id: String(userId),
        username: String(userId),
        ...(email ? { email: String(email) } : {}),
      };
      Sentry.setUser(userObj);
      Sentry.setTag('user_id', String(userId));
      console.log('[Sentry] Main process setUser via IPC:', { id: userObj.id, hasEmail: !!userObj.email });
      return { success: true };
    } catch (err) {
      console.warn('[Sentry] sentry-set-user IPC failed:', err && err.message);
      return { success: false, error: err && err.message };
    }
  });

  console.log('[Main] App is ready - optimized lazy loading mode');
  const startTime = Date.now();

  // ============ PATH DIAGNOSTICS ============
  // Log critical paths on startup. Helps diagnose issues on systems
  // where the Windows username contains Cyrillic, spaces, or other
  // non-ASCII characters (execSync calls can fail in such paths).
  try {
    const criticalPaths = {
      userData: app.getPath('userData'),
      temp: app.getPath('temp'),
      appPath: app.getAppPath(),
      execPath: process.execPath,
      cwd: process.cwd(),
    };
    console.log('[Paths] System paths:', JSON.stringify(criticalPaths, null, 2));

    const nonAsciiPattern = /[^\x00-\x7F]/;
    const problematicPaths = Object.entries(criticalPaths)
      .filter(([, p]) => nonAsciiPattern.test(p));
    if (problematicPaths.length > 0) {
      const names = problematicPaths.map(([k]) => k).join(', ');
      console.warn(`[Paths] ⚠️ Non-ASCII characters detected in: ${names}`);
      console.warn('[Paths] This may cause issues with child_process.execSync on Windows');
      console.warn('[Paths] See docs/electron/road_map_pravka_bagov24_04_2026.md (Step 0)');
    }
  } catch (pathErr) {
    console.warn('[Paths] Failed to log path diagnostics:', pathErr.message);
  }

  // Request macOS permissions
  const permissions = await requestMacOSPermissions();
  const hasAccessibilityPermission = permissions?.accessibilityGranted ?? true;

  // Handle deep link on first launch (Windows).
  // 26.08.2026: слепой setTimeout(1000) снят — handleDeepLink буферизует
  // событие до сигнала готовности renderer'а (см. DEEP LINK HANDLER выше).
  // Полный URL не логируется: в auth-варианте внутри живой JWT.
  if (process.platform === 'win32') {
    const deepLinkUrl = process.argv.find(arg => arg.startsWith('speakflow://'));
    if (deepLinkUrl) {
      console.log('[DeepLink] Found deep link in argv (URL not logged)');
      handleDeepLink(deepLinkUrl);
    }
  }

  // Initialize core managers (required at startup)
  try {
    console.log('[Main] Creating WindowManager...');
    windowManager = new WindowManager(isDev, Sentry);
    console.log('[Main] WindowManager created successfully');
  } catch (error) {
    console.error('[Main] CRITICAL: Failed to create WindowManager:', error);
    Sentry.captureException(error);
    throw error; // Can't continue without window manager
  }

  try {
    console.log('[Main] Creating HotkeysManager...');
    hotkeysManager = new HotkeysManager();
    console.log('[Main] HotkeysManager created successfully');
  } catch (error) {
    console.error('[Main] Failed to create HotkeysManager (non-critical):', error);
    Sentry.captureException(error);
    // Continue without hotkeys - better than crashing
  }

  // Create window and tray
  let mainWindow = null;
  try {
    console.log('[Main] Creating main window...');
    mainWindow = windowManager.createWindow();
    console.log('[Main] Main window created successfully');

    console.log('[Main] Creating tray...');
    windowManager.createTray();
    console.log('[Main] Tray created successfully');
  } catch (error) {
    console.error('[Main] CRITICAL: Failed to create window/tray:', error);
    Sentry.captureException(error);
    throw error; // Can't continue without window
  }

  // Initialize only RecordingOverlay at startup (most frequently used)
  // Other overlays are created lazily on first use
  let overlay = null;
  try {
    console.log('[Main] Creating RecordingOverlay...');
    overlay = getOverlay();
    console.log('[Main] RecordingOverlay created successfully');
  } catch (error) {
    console.error('[Main] Failed to create RecordingOverlay (non-critical):', error);
    Sentry.captureException(error);
    // Continue without overlay - better than crashing
  }

  // Setup meeting detector callbacks with lazy loaders
  let meetingDetector = null;
  try {
    console.log('[Main] Creating MeetingDetector...');
    meetingDetector = getMeetingDetector();
    setupMeetingDetectorCallbacks(
      meetingDetector,
      persistentStore,
      getLiveAssistantOverlay,
      getLiveAssistantSidebar
    );
    console.log('[Main] MeetingDetector callbacks configured');

    // Start meeting detector only if enabled
    if (persistentStore.get('meeting_auto_start', true)) {
      meetingDetector.start();
      console.log('[Main] MeetingDetector started');
    }
  } catch (error) {
    console.error('[Main] Failed to setup MeetingDetector (non-critical):', error);
    Sentry.captureException(error);
    // Continue without meeting detector
  }

  // Setup hotkeys callbacks with lazy loaders (only if hotkeys manager exists)
  if (hotkeysManager) {
    try {
      console.log('[Main] Setting up hotkeys callbacks...');
      setupHotkeysCallbacks(
        hotkeysManager,
        windowManager,
        overlay,
        getLiveAssistantSidebar,
        { show: () => getMemoryOverlay().show() } // Lazy wrapper for memory overlay
      );
      console.log('[Main] Hotkeys callbacks configured');
    } catch (error) {
      console.error('[Main] Failed to setup hotkeys callbacks:', error);
      Sentry.captureException(error);
    }

    // Initialize hotkeys
    try {
      console.log('[Main] Initializing hotkeys...');
      hotkeysManager.initialize(hasAccessibilityPermission);
      console.log('[Main] Hotkeys initialized successfully');
    } catch (error) {
      console.error('[Main] Failed to initialize hotkeys:', error);
      Sentry.captureException(error);
    }
  } else {
    console.warn('[Main] HotkeysManager not available, skipping hotkeys setup');
  }

  // On macOS: check accessibility permission when app becomes active
  if (mainWindow && process.platform === 'darwin' && !hasAccessibilityPermission && hotkeysManager) {
    const { systemPreferences } = require('electron');
    let accessibilityInitialized = false;

    const checkAndInitHotkeys = () => {
      if (accessibilityInitialized) return;
      const nowGranted = systemPreferences.isTrustedAccessibilityClient(false);
      if (nowGranted) {
        console.log('[Main] Accessibility permission now granted - initializing hotkeys');
        accessibilityInitialized = true;
        hotkeysManager.initializeWhenReady();
      }
    };

    app.on('browser-window-focus', checkAndInitHotkeys);
    mainWindow.on('focus', checkAndInitHotkeys);
  }

  // Auto-resume hotkeys when window state changes
  if (mainWindow && hotkeysManager) {
    mainWindow.on('show', () => {
      if (hotkeysManager.getIsPaused()) {
        hotkeysManager.resume();
      }
    });

    mainWindow.on('hide', () => {
      if (hotkeysManager.getIsPaused()) {
        hotkeysManager.resume();
      }
    });

    mainWindow.on('minimize', () => {
      if (hotkeysManager.getIsPaused()) {
        hotkeysManager.resume();
      }
    });
  }

  // Setup system event handlers
  setupSystemEventHandlers(powerMonitor, hotkeysManager);

  // Initialize auto-updater
  // В dev — создаём instance но НЕ проверяем обновления (для тестирования
  // UI баннера через simulateDownloaded). В production — полный flow с
  // periodic check каждые 3 часа.
  setTimeout(() => {
    autoUpdater = new AutoUpdaterManager();
    autoUpdater.init(mainWindow);

    if (!isDev) {
      // v1.3.83: оборачиваем checkForUpdates в setImmediate, чтобы гарантировать
      // отдачу управления event loop (renderer не зависает на 5-30 сек при
      // плохой сети). См. GlitchTip Issue #4 (10.05.2026).
      setImmediate(() => {
        console.log('[Main] Checking for updates (non-blocking)...');
        autoUpdater.checkForUpdates().catch((err) => {
          console.error('[Main] Initial update check failed:', err);
        });
      });

      setInterval(() => {
        if (autoUpdater) {
          setImmediate(() => {
            console.log('[Main] Periodic update check (3h, non-blocking)...');
            autoUpdater.checkForUpdates().catch((err) => {
              console.error('[Main] Periodic update check failed:', err);
            });
          });
        }
      }, 3 * 60 * 60 * 1000); // 3 часа
    } else {
      console.log('[Main] Dev mode — autoUpdater initialized without auto-check (use simulate-update-downloaded IPC for testing)');
    }
  }, 15000);

  // Start clipboard translation if enabled (lazy)
  if (persistentStore.get('clipboard_auto_translate') === 'true' ||
      persistentStore.get('clipboard_auto_translate') === true) {
    // Delay clipboard monitoring to not impact startup
    setTimeout(() => {
      const clipboardTranslation = getClipboardTranslation(mainWindow);
      const autoHideDelay = parseInt(persistentStore.get('clipboard_auto_hide_delay') || '5');
      clipboardTranslation.setAutoHideDelay(autoHideDelay);
      clipboardTranslation.start();
      console.log('[Main] Clipboard auto-translation started');
    }, 5000);
  }

  // Register IPC handlers with lazy getters
  registerIpcHandlers({
    windowManager,
    hotkeysManager,
    overlay,
    liveAssistantOverlay: null, // Will be created on demand via IPC
    clipboardTranslation: null, // Will use getter
    clipboardManager: null, // Will use getter
    meetingDetector,
    secureStore,
    audioCacheManager,
    persistentStore,
    autoUpdater,
    // Getter для autoUpdater — реальное значение создаётся через setTimeout
    // 15 сек после регистрации IPC handlers, поэтому deps.autoUpdater всегда
    // null. IPC handlers должны вызывать deps.getAutoUpdater() чтобы получить
    // актуальный instance после инициализации.
    getAutoUpdater: () => autoUpdater,
    isDev,
    API_URL,
    // Lazy getters for IPC handlers
    getClipboardTranslation: () => getClipboardTranslation(mainWindow),
    getClipboardManager,
    getTranslationOverlay,
    getMemoryOverlay,
  });

  // Register translator handlers
  registerTranslatorHandlers({
    windowManager,
    secureStore,
    persistentStore,
    API_URL
  });

  const startupTime = Date.now() - startTime;
  console.log(`[Main] Initialization complete in ${startupTime}ms (lazy loading enabled)`);
});

// ============ APP LIFECYCLE ============
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (windowManager) {
    windowManager.showWindow();
  }
});

// Шаг 8: защита от двойного вызова cleanup (window-all-closed + before-quit)
let isCleaningUp = false;

app.on('before-quit', () => {
  console.log('[Main] App is quitting - cleaning up resources');

  if (windowManager) {
    windowManager.setQuitting(true);
  }

  if (_overlay) {
    _overlay.setQuitting(true);
  }
});

app.on('will-quit', () => {
  if (isCleaningUp) {
    console.log('[Main] will-quit fired again — skip duplicate cleanup');
    return;
  }
  isCleaningUp = true;

  console.log('[Main] will-quit: Starting cleanup with 5 second safety timeout');

  const safetyTimeout = setTimeout(() => {
    console.error('[Main] Cleanup timeout exceeded, forcing process exit');
    process.exit(0);
  }, 5000);

  // Clean up window manager
  if (windowManager) {
    try {
      windowManager.cleanup();
    } catch (err) {
      console.error('[Main] Error cleaning up window manager:', err);
    }
  }

  // Clean up overlay windows (only if they were created)
  if (_overlay) {
    try {
      _overlay.destroy();
      _overlay = null;
    } catch (err) {
      console.error('[Main] Error destroying overlay:', err);
    }
  }

  if (_liveAssistantOverlay) {
    try {
      _liveAssistantOverlay.destroy();
      _liveAssistantOverlay = null;
    } catch (err) {
      console.error('[Main] Error destroying Live Assistant overlay:', err);
    }
  }

  if (_liveAssistantSidebar) {
    try {
      _liveAssistantSidebar.destroy();
      _liveAssistantSidebar = null;
    } catch (err) {
      console.error('[Main] Error destroying Live Assistant sidebar:', err);
    }
  }

  if (_translationOverlay) {
    try {
      _translationOverlay.destroy();
      _translationOverlay = null;
    } catch (err) {
      console.error('[Main] Error destroying translation overlay:', err);
    }
  }

  if (_memoryOverlay) {
    try {
      _memoryOverlay.destroy();
      _memoryOverlay = null;
    } catch (err) {
      console.error('[Main] Error destroying memory overlay:', err);
    }
  }

  // Clean up hotkeys manager
  if (hotkeysManager) {
    try {
      hotkeysManager.cleanup();
    } catch (err) {
      console.error('[Main] Error cleaning up hotkeys:', err);
    }
  }

  // Stop clipboard services (only if created)
  if (_clipboardTranslation) {
    try {
      _clipboardTranslation.stop();
    } catch (err) {
      console.error('[Main] Error stopping clipboard translation:', err);
    }
  }

  if (_clipboardManager) {
    try {
      // КРИТИЧНО: stopMonitoring() освобождает native Windows clipboard hook
      // (electron-clipboard-watcher). Без этого hook остаётся в системе и
      // конфликтует с обработкой WM_MOUSEWHEEL — в Telegram колесо мыши
      // «бешено» крутится до перезагрузки ПК. Найдено 28.04.2026 (B2).
      _clipboardManager.stopMonitoring();
      _clipboardManager.stopCleanupInterval();
      _clipboardManager = null;
    } catch (err) {
      console.error('[Main] Error stopping clipboard manager:', err);
    }
  }

  // Stop meeting detector (only if created)
  if (_meetingDetector) {
    try {
      _meetingDetector.stop();
      _meetingDetector = null;
    } catch (err) {
      console.error('[Main] Error stopping meeting detector:', err);
    }
  }

  // N4 (29.04.2026): clear retry-timer в autoUpdater. Иначе после quit
  // setTimeout сработает на уже выгруженном app — упадёт. См. autoUpdater.cleanup().
  if (autoUpdater && typeof autoUpdater.cleanup === 'function') {
    try {
      autoUpdater.cleanup();
    } catch (err) {
      console.error('[Main] Error cleaning up autoUpdater:', err);
    }
  }

  // Clean up audio cache
  if (audioCacheManager) {
    try {
      audioCacheManager.cleanup();
    } catch (err) {
      console.error('[Main] Error cleaning up audio cache:', err);
    }
  }

  // Unregister all global shortcuts
  const { globalShortcut } = require('electron');
  globalShortcut.unregisterAll();

  // Шаг 8: SAFETY-NET — destroy ВСЕ оставшиеся BrowserWindow если что-то
  // забылось в специфичных destroy() выше. Это защита от случайных
  // зомби-окон.
  try {
    const { BrowserWindow } = require('electron');
    const allWindows = BrowserWindow.getAllWindows();
    if (allWindows.length > 0) {
      console.warn(`[Main] Safety-net: destroying ${allWindows.length} remaining windows`);
      for (const w of allWindows) {
        try {
          if (!w.isDestroyed()) w.destroy();
        } catch (e) {
          console.error('[Main] Window destroy failed:', e.message);
        }
      }
    }
  } catch (e) {
    console.error('[Main] Safety-net cleanup failed:', e);
  }

  // Шаг 8: явно убить WinKeyServer.exe (Windows-only) — корень zombie-процессов
  // от node-global-key-listener. Резервная защита если hotkeysManager.cleanup()
  // не доработал. На Mac такой процесс не создаётся.
  if (process.platform === 'win32') {
    try {
      require('child_process').execSync(
        'taskkill /F /IM WinKeyServer.exe /T',
        { stdio: 'ignore', timeout: 3000 }
      );
      console.log('[Main] Safety-net: WinKeyServer.exe killed');
    } catch {
      // Уже убит или не было — это ОК
    }
  }

  // Шаг 8: tree-kill — кросс-платформенный убийца дерева процессов.
  // Запускается ПОСЛЕДНИМ — если что-то ещё висит как child этого процесса,
  // оно тоже умрёт. На Win/Mac/Linux работает одинаково.
  // ВАЖНО: НЕ вызываем синхронно для своего pid — это создаст race с
  // process.exit(0) ниже. Просто оставляем safetyTimeout чтобы дочистил.

  // Snять все ipcMain handlers — защита от lingering listener'ов
  try {
    ipcMain.removeAllListeners();
  } catch (e) {
    console.error('[Main] removeAllListeners failed:', e.message);
  }

  clearTimeout(safetyTimeout);
  console.log('[Main] Cleanup complete');
});

console.log('[Main] SpeakFlow starting...');
