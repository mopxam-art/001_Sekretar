/**
 * Чистые хелперы матчинга хоткеев (Шаг 5). Тестируются в Node без Electron.
 *
 * OEM-клавиши: node-global-key-listener отдаёт standardName (VK_OEM_3 backquote
 * → 'SECTION'), а renderer раньше писал символ `e.key` ('`' на EN / 'ё' на RU,
 * зависит от раскладки) → матч '`' против 'section' НИКОГДА не сходился (#10).
 */

// Токен из строки хоткея → native standardName листенера (lowercase).
// Подтверждено кодом node-global-key-listener: VK_OEM_3 → 'SECTION'.
// (VK_OEM_102 → 'BACKTICK' — другая физическая клавиша, НЕ путать.)
const OEM_ALIAS = { '`': 'section', '~': 'section', 'ё': 'section' };

function parseHotkeyToSet(hotkey) {
  const keys = new Set();
  const parts = String(hotkey || '').toLowerCase().replace('commandorcontrol', 'ctrl').split('+');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === 'ctrl' || trimmed === 'control') keys.add('ctrl');
    else if (trimmed === 'shift') keys.add('shift');
    else if (trimmed === 'alt') keys.add('alt');
    else if (trimmed === 'space') keys.add('space');
    else if (trimmed) keys.add(OEM_ALIAS[trimmed] || trimmed);
  }
  return keys;
}

function matchesRecordingHotkey(keysPressed, recordingKeys) {
  const pressed = keysPressed instanceof Set ? keysPressed : new Set(keysPressed);
  return Array.from(recordingKeys).every((k) => pressed.has(k));
}

// Есть ли в хоткее не-модификаторная клавиша (иначе триггер неразрешим — 5.5).
function hasRecordingTrigger(hotkey) {
  for (const k of parseHotkeyToSet(hotkey)) {
    if (!['ctrl', 'shift', 'alt', 'meta'].includes(k)) return true;
  }
  return false;
}

// Пере-нормализовать сохранённую (возможно битую) строку для ДИСПЛЕЯ (5.6).
// Матч и так покрыт OEM_ALIAS; тут только 'ё'/'Ё'/'~' → '`' для консистентности.
// Идемпотентна и не трогает валидные хоткеи.
function normalizeStoredHotkey(hotkey) {
  if (!hotkey || typeof hotkey !== 'string') return hotkey;
  return hotkey
    .split('+')
    .map((p) => {
      const t = p.trim();
      if (t === 'ё' || t === 'Ё' || t === '~') return '`';
      return t;
    })
    .join('+');
}

module.exports = { parseHotkeyToSet, matchesRecordingHotkey, hasRecordingTrigger, normalizeStoredHotkey, OEM_ALIAS };
