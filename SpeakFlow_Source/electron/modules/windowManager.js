/**
 * Window Manager
 * Управление главным окном и системным треем
 */

const { BrowserWindow, Menu, Tray, nativeImage } = require('electron');
const path = require('path');

class WindowManager {
  constructor(isDev, Sentry) {
    this.isDev = isDev;
    this.Sentry = Sentry;
    this.mainWindow = null;
    this.tray = null;
    this.trayContextMenu = null;
    this.isQuitting = false;
  }

  /**
   * Создать главное окно приложения
   */
  createWindow() {
    // Путь к иконке в зависимости от режима
    const { app } = require('electron');
    const iconPath = this.isDev
      ? path.join(__dirname, '../../public/logo_speak.ico')
      : path.join(app.getAppPath(), 'build/icon.ico');

    console.log('[Window] Window icon path:', iconPath);

    this.mainWindow = new BrowserWindow({
      width: 900,
      height: 700,
      minWidth: 800,
      minHeight: 600,
      skipTaskbar: false,
      alwaysOnTop: false,
      focusable: true,
      autoHideMenuBar: true,
      // П-6 fix: окно создаётся скрытым, показываем после ready-to-show
      // → юзер не видит «белой вспышки» на 2-5 сек пока React грузится
      show: false,
      // Тёмный фон вместо дефолтного белого Chromium — даже если ready-to-show
      // не успел, юзер видит тёмный прямоугольник в стиле app theme, а не белый
      backgroundColor: '#171717',
      // Важно: иначе ready-to-show event никогда не firenет если show:false
      paintWhenInitiallyHidden: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
        // Security: disabled in dev only so the Vite renderer (localhost:5173)
        // can call api.speakflow.ru without CORS preflight failing
        // (the backend currently returns a duplicate Access-Control-Allow-Origin
        // header — needs to be fixed server-side).
        webSecurity: !this.isDev,
        allowRunningInsecureContent: false,
        // cold-start Шаг 6.3: backgroundThrottling false — выравниваем с глобальным
        // app switch `disable-renderer-backgrounding` (main.js). Раньше было true,
        // что противоречило switch'у и тротлило timers/network renderer'а когда окно
        // скрыто. При старте в трей (автозагрузка) это усугубляло cold-start: проба
        // /health и retry'и тормозились пока юзер не раскрыл окно. Теперь renderer
        // полноскоростной всегда — консистентно с тем что приложение и так хочет.
        backgroundThrottling: false,
        spellcheck: false,
        enableWebSQL: false,
        v8CacheOptions: 'bypassHeatCheck',
      },
      icon: iconPath,
      title: 'SpeakFlow'
    });

    // П-6 fix: показываем окно когда DOM готов — юзер сразу видит UI
    // вместо белого экрана/тёмного фона
    this.mainWindow.once('ready-to-show', () => {
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.show();
        this.mainWindow.focus();
        console.log('[Window] ready-to-show fired, window shown');
      }
    });

    // Safety timeout: если ready-to-show не пришёл за 8 сек (зависший
    // renderer, медленный диск, антивирус) — показываем принудительно.
    // Лучше показать «полу-готовое» окно с тёмным фоном чем держать
    // его невидимым и юзер думает «приложение не запустилось».
    setTimeout(() => {
      if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.isVisible()) {
        console.warn('[Window] ready-to-show timeout (8s) — forcing show()');
        this.mainWindow.show();
        this.mainWindow.focus();
      }
    }, 8000);

    // Убираем меню приложения
    Menu.setApplicationMenu(null);

    // DevTools в dev режиме
    if (this.isDev) {
      this.mainWindow.webContents.openDevTools();

      // Fix CSP for React DevTools in development
      this.mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': ["script-src 'self' 'unsafe-eval' 'unsafe-inline'"]
          }
        });
      });
    }

    // Обработка закрытия окна - сворачиваем в трей
    this.mainWindow.on('close', (event) => {
      if (!this.isQuitting && !this.mainWindow.isDestroyed()) {
        event.preventDefault();
        this.mainWindow.hide();
        return false;
      }
    });

    // Обработка минимизации
    this.mainWindow.on('minimize', (event) => {
      if (!this.mainWindow.isDestroyed()) {
        event.preventDefault();
        this.mainWindow.hide();
      }
    });

    // Загрузка контента
    if (this.isDev) {
      // Development: Vite dev server
      this.mainWindow.loadURL('http://localhost:5173');
    } else {
      // Production: из папки dist (в корне asar)
      const { app } = require('electron');
      const indexPath = path.join(app.getAppPath(), 'dist/index.html');
      console.log('[Window] Loading index.html from:', indexPath);

      this.mainWindow.loadFile(indexPath).catch(err => {
        console.error('[Window] Failed to load index.html:', err);
        this.Sentry.captureException(err);
      });

      // Обработка ошибок загрузки
      this.mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[Window] Window failed to load:', errorCode, errorDescription);
        this.Sentry.captureMessage(`Window load failed: ${errorDescription}`, 'error');
      });
    }

    // Enhanced diagnostics for white screen issues
    this.mainWindow.webContents.on('did-finish-load', () => {
      console.log('[Window] Content finished loading');
    });

    this.mainWindow.webContents.on('did-start-loading', () => {
      console.log('[Window] Started loading content');
    });

    this.mainWindow.webContents.on('dom-ready', () => {
      console.log('[Window] DOM is ready');
    });

    // Catch renderer process crashes
    this.mainWindow.webContents.on('render-process-gone', (event, details) => {
      console.error('[Window] Renderer process gone:', details.reason, details.exitCode);
      this.Sentry.captureMessage(`Renderer crash: ${details.reason} (code: ${details.exitCode})`, 'fatal');
    });

    // Catch unresponsive renderer
    this.mainWindow.webContents.on('unresponsive', () => {
      console.error('[Window] Renderer became unresponsive');
      this.Sentry.captureMessage('Renderer unresponsive', 'warning');
    });

    this.mainWindow.webContents.on('responsive', () => {
      console.log('[Window] Renderer became responsive again');
    });

    // Catch JavaScript errors in renderer
    this.mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      // level: 0=verbose, 1=info, 2=warning, 3=error
      if (level >= 2) {
        console.log(`[Renderer ${level === 3 ? 'ERROR' : 'WARN'}] ${message} (${sourceId}:${line})`);
      }
    });

    console.log('[Window] Main window created');
    return this.mainWindow;
  }

  /**
   * Создать иконку в системном трее
   */
  createTray() {
    // Guard: если tray уже создан — возвращаем без повторной инициализации.
    // Защита от случайного двойного вызова (например при HMR в dev mode
    // или race в lifecycle). Без этого было бы 2 иконки в трее.
    if (this.tray && !this.tray.isDestroyed()) {
      console.log('[Window] Tray already exists, skipping recreate');
      return this.tray;
    }

    const { app } = require('electron');
    const trayIconPath = this.isDev
      ? path.join(__dirname, '../../build/icon.ico')
      : path.join(app.getAppPath(), 'build/icon.ico');

    console.log('[Window] Tray icon path:', trayIconPath);
    const trayIcon = nativeImage.createFromPath(trayIconPath);

    if (trayIcon.isEmpty()) {
      console.error('[Window] Failed to load tray icon from:', trayIconPath);
    }

    this.tray = new Tray(trayIcon);
    this.tray.setToolTip('SpeakFlow - AI Voice Assistant');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Показать',
        click: () => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.show();
            this.mainWindow.focus();
          }
        }
      },
      {
        label: 'Скрыть',
        click: () => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.hide();
          }
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Выход',
        click: () => {
          console.log('[Window] Quit requested from tray');
          this.isQuitting = true;

          // Destroy tray first to remove icon immediately
          if (this.tray) {
            this.tray.destroy();
            this.tray = null;
            this.trayContextMenu = null;
          }

          // Destroy main window
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.destroy();
            this.mainWindow = null;
          }

          const { app } = require('electron');
          app.quit();

          // Force exit after short delay if app.quit() doesn't work
          setTimeout(() => {
            console.log('[Window] Force exit');
            process.exit(0);
          }, 1000);
        }
      }
    ]);

    // Store context menu reference for manual popup
    this.trayContextMenu = contextMenu;
    this.tray.setContextMenu(contextMenu);

    // Single click to toggle window visibility
    this.tray.on('click', () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        if (this.mainWindow.isVisible()) {
          this.mainWindow.hide();
        } else {
          this.mainWindow.show();
          this.mainWindow.focus();
        }
      }
    });

    // Right-click to show context menu (explicit for Windows compatibility)
    this.tray.on('right-click', () => {
      if (this.tray && this.trayContextMenu) {
        this.tray.popUpContextMenu(this.trayContextMenu);
      }
    });

    // Double click to show window (kept for consistency)
    this.tray.on('double-click', () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.show();
        this.mainWindow.focus();
      }
    });

    console.log('[Window] Tray icon created');
    return this.tray;
  }

  /**
   * Получить главное окно
   */
  getMainWindow() {
    return this.mainWindow;
  }

  /**
   * Показать окно
   */
  showWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  /**
   * Скрыть окно
   */
  hideWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.hide();
    }
  }

  /**
   * Установить флаг выхода
   */
  setQuitting(value) {
    this.isQuitting = value;
  }

  /**
   * Cleanup on app quit
   */
  cleanup() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.destroy();
      this.mainWindow = null;
    }

    console.log('[Window] Manager cleaned up');
  }
}

module.exports = WindowManager;
