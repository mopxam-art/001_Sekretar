/**
 * Config recovery (Шаг 3, roadmap v1.3.89) — защита настроек от обнуления.
 *
 * electron-store с `clearInvalidConfig: true` ТИХО стирает config.json при
 * повреждении (например, краш во время записи → битый JSON). Юзер теряет
 * настройки без следа. Чтобы этого не было: на старте (ДО создания любого
 * Store) держим last-known-good копию `<name>.bak` и восстанавливаем из неё,
 * если основной файл повреждён или пропал.
 *
 * Чистый fs/path, без Electron — тестируется юнит-тестом без запуска приложения.
 */
const fs = require('fs');
const path = require('path');

function assertValidJson(filePath) {
  JSON.parse(fs.readFileSync(filePath, 'utf8')); // бросит SyntaxError если битый
}

/**
 * Бэкап/восстановление одного config-файла.
 * @param {string} cfgPath полный путь к <name>.json
 * @returns {'backed-up'|'recovered'|'recovered-after-corruption'|'noop'|'both-invalid'}
 */
function recoverConfigFile(cfgPath) {
  const bakPath = cfgPath.replace(/\.json$/i, '.bak');
  try {
    if (fs.existsSync(cfgPath)) {
      assertValidJson(cfgPath);           // валиден?
      fs.copyFileSync(cfgPath, bakPath);  // обновляем last-known-good
      return 'backed-up';
    }
    if (fs.existsSync(bakPath)) {
      assertValidJson(bakPath);
      fs.copyFileSync(bakPath, cfgPath);  // файл пропал — восстановить из бэкапа
      return 'recovered';
    }
    return 'noop';                        // чистый профиль — нечего бэкапить
  } catch (_) {
    // основной файл битый → пробуем восстановить из валидного бэкапа
    try {
      if (fs.existsSync(bakPath)) {
        assertValidJson(bakPath);
        fs.copyFileSync(bakPath, cfgPath);
        return 'recovered-after-corruption';
      }
    } catch (_e) {
      /* бэкап тоже битый — отдадим clearInvalidConfig (он обнулит, но не упадёт) */
    }
    return 'both-invalid';
  }
}

/**
 * Прогон по всем известным дефолтным config-файлам в userData.
 * @param {string} userDataDir app.getPath('userData')
 * @returns {Record<string,string>} результат по каждому файлу
 */
function recoverConfigs(userDataDir) {
  const targets = ['config.json', path.join('overlay', 'config.json')];
  const results = {};
  for (const rel of targets) {
    try {
      results[rel] = recoverConfigFile(path.join(userDataDir, rel));
    } catch (e) {
      results[rel] = 'error';
    }
  }
  return results;
}

module.exports = { recoverConfigFile, recoverConfigs };
