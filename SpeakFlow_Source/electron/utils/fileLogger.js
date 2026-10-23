/**
 * fileLogger.js — централизованное file logging для main process через electron-log.
 *
 * Зачем: до этого все console.log/info/warn/error в main процессе писались в
 * stdout, который у Electron production billd'а никуда не отображается.
 * Если у юзера баг — у нас нет логов для диагностики.
 *
 * Теперь:
 *  - Все console.* перехватываются → пишутся в файл
 *  - Файл: %APPDATA%/SpeakFlow/logs/main.log (Windows)
 *          ~/Library/Logs/SpeakFlow/main.log (macOS)
 *  - Ротация: 10 MB на файл, до 5 файлов (50 MB total)
 *  - Уровень в production: 'info' (без debug-флуда)
 *  - Уровень в dev: 'silly' (всё)
 *  - Перед записью — redact регекспом для удаления токенов/паролей
 *
 * НЕ отправляется автоматически на наш сервер — юзер сам решает приложить
 * файл к жалобе через Settings → Поддержка → Открыть папку с логами.
 */

const log = require('electron-log');
const path = require('path');

// Импортируем app только при первом обращении — иначе будет падать
// если этот модуль импортируют до app.whenReady().
function configureLogger() {
  const { app } = require('electron');
  const isDev = !app.isPackaged;

  log.transports.file.level = isDev ? 'silly' : 'info';
  log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
  log.transports.file.resolvePathFn = () =>
    path.join(app.getPath('userData'), 'logs', 'main.log');

  // Console transport — оставляем в dev (всё видно в DevTools/terminal),
  // в production — только warn/error чтобы не тормозить
  log.transports.console.level = isDev ? 'silly' : 'warn';

  // Redact: удалить sensitive строки до записи
  log.hooks.push((message, transport) => {
    if (transport !== log.transports.file) return message;
    const safeData = message.data.map((item) => {
      if (typeof item !== 'string') return item;
      return item
        .replace(/(accessToken|refreshToken|password|secret|authorization|api[-_]?key)\s*[:=]\s*['"]?[\w.-]+['"]?/gi, '$1=***REDACTED***')
        .replace(/Bearer\s+[\w.-]+/gi, 'Bearer ***REDACTED***')
        // 26.08.2026: голые query-параметры deep-link. Старые регекспы знали
        // accessToken=, но НЕ ?token= — и боевой JWT из speakflow://auth
        // лежал в main.log открытым текстом (тикет-класс P4, roadmap
        // Electron-атрибуции). receipt= — новый параметр той же природы.
        .replace(/([?&](?:token|receipt)=)[^&\s'"]+/gi, '$1***REDACTED***');
    });
    return { ...message, data: safeData };
  });

  log.info('[fileLogger] initialized', {
    file: log.transports.file.getFile().path,
    level: log.transports.file.level,
    isDev,
  });
}

// Перехватываем console.* — все существующие console.log/info/warn/error
// в main процессе теперь идут через electron-log.
// Object.assign(console, log.functions) делает: console.log = log.log, console.info = log.info, ...
function attachToConsole() {
  Object.assign(console, log.functions);
}

module.exports = {
  log,
  configureLogger,
  attachToConsole,
};
