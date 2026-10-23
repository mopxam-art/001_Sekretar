/**
 * Text Insertion IPC Handlers
 * Вставка текста через буфер обмена + эмуляция Ctrl+V
 */

const { ipcMain, clipboard, app } = require('electron');
const { execSync, spawnSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const sharedState = require('../sharedState');

/**
 * Returns a temp directory path safe for child_process shell invocations.
 * On Windows, the default temp dir can contain non-ASCII characters
 * (e.g. C:\Users\Иван\AppData\Local\Temp), which breaks PowerShell
 * invocations through execSync. Falls back to C:\ProgramData\speakflow
 * which is always ASCII.
 */
function getSafeTempDir() {
  const defaultTemp = app.getPath('temp');
  const hasNonAscii = /[^\x00-\x7F]/.test(defaultTemp);
  if (!hasNonAscii) return defaultTemp;

  // Non-ASCII path detected — use ASCII fallback
  const fallback = process.platform === 'win32'
    ? path.join('C:', 'ProgramData', 'speakflow', 'temp')
    : '/tmp/speakflow';
  try {
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  } catch (err) {
    console.warn('[IPC:TextInsertion] Failed to create fallback temp dir:', err.message);
    return defaultTemp;
  }
}

// Ленивая инициализация robotjs
let robot = null;
function getRobot() {
  if (!robot) {
    robot = require('@jitsi/robotjs');
    console.log('[IPC:TextInsertion] robotjs loaded (lazy init)');
  }
  return robot;
}

// Ленивая инициализация nut.js
let nutKeyboard = null;
let nutKey = null;
let nutInitialized = false;

function initNutJs() {
  if (nutInitialized) return;
  nutInitialized = true;

  if (process.platform === 'win32') {
    try {
      const { keyboard, Key } = require('@nut-tree-fork/nut-js');
      nutKeyboard = keyboard;
      nutKey = Key;
      console.log('[IPC:TextInsertion] nut.js loaded (lazy init)');
    } catch (error) {
      console.log('[IPC:TextInsertion] nut.js not available:', error.message);
      nutKeyboard = null;
    }
  }
}

// keysender - самый быстрый способ (SendInput напрямую)
let keysenderHardware = null;
function getKeysender() {
  if (!keysenderHardware) {
    try {
      const { Hardware } = require('keysender');
      keysenderHardware = new Hardware();
      console.log('[IPC:TextInsertion] keysender loaded (lazy init)');
    } catch (error) {
      console.log('[IPC:TextInsertion] keysender not available:', error.message);
      keysenderHardware = false; // Mark as failed
    }
  }
  return keysenderHardware;
}

function registerTextInsertionHandlers(deps) {
  const { windowManager, clipboardTranslation } = deps;

  let lastInsertedTextLength = 0;
  let lastInsertedText = '';
  let lastInsertTime = 0;
  const INSERT_DEBOUNCE_MS = 1000;

  // ============ TEXT INSERTION ============
  ipcMain.handle('insert-text', async (event, text, options = {}) => {
    // B1 INVESTIGATION (28.04.2026): добавлен lastChar — если в проде увидим
    // что приходит текст с лишней «и» в конце, поймём что баг в STT/backend,
    // а не в Electron paste-логике.
    console.log('[IPC] insert-text called, text length:', text ? text.length : 0,
                'preview:', text ? text.substring(0, 50) : 'null',
                'lastChar:', text ? JSON.stringify(text.slice(-1)) : 'null');

    const now = Date.now();

    // Проверка на дублирование
    if (text === lastInsertedText && (now - lastInsertTime) < INSERT_DEBOUNCE_MS) {
      console.log('[IPC] Duplicate text insertion blocked (debounce)', {
        textLength: text.length,
        timeSinceLastInsert: now - lastInsertTime
      });
      return { success: true, method: 'debounced-duplicate' };
    }

    const savedClipboard = clipboard.readText();
    console.log('[IPC] Saved clipboard, length:', savedClipboard ? savedClipboard.length : 0);

    // Игнорировать следующее изменение буфера обмена
    if (clipboardTranslation) {
      clipboardTranslation.ignoreNextClipboardChange();
    }

    try {
      clipboard.writeText(text);
      console.log('[IPC] Text written to clipboard, verifying...');
      const verifyClipboard = clipboard.readText();
      console.log('[IPC] Clipboard verification:', verifyClipboard === text ? 'OK' : 'MISMATCH', 'clipboard length:', verifyClipboard.length);

      // ✅ OPTIMIZATION 2026: Use Shift+Insert (works in all apps including IDEs)
      if (process.platform === 'win32') {
        const ks = getKeysender();
        if (ks && ks !== false) {
          const mainWindow = windowManager.getMainWindow();
          const isFocused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();

          // П-40: на NotesScreen окно НЕ прячем, текст вставляется прямо в редактор/чат
          if (isFocused && !sharedState.getNotesScreenActive()) {
            mainWindow.hide();
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          try {
            // B3 FIX (28.04.2026): defensive release всех модификаторов ПЕРЕД paste.
            // Если Windows потерял UP-event для Ctrl/Alt при отпускании хоткея
            // записи — активное окно увидит Ctrl+Shift+Insert (не paste) и
            // модификаторы «залипнут» для следующих кликов мышью (баг в
            // Telegram/Excel). Эти toggleKey быстрые (~5мс), не критично для UX.
            try {
              await ks.keyboard.toggleKey('ctrl', false);
              await ks.keyboard.toggleKey('alt', false);
              await ks.keyboard.toggleKey('lWin', false);
              await ks.keyboard.toggleKey('rWin', false);
            } catch (releaseErr) {
              // Если modifier и так был отпущен — keysender может выкинуть, это OK
            }

            // Shift+Insert without await - fire and forget for speed (~30ms vs ~200ms)
            ks.keyboard.sendKey(['shift', 'insert']);

            // Wait for paste to complete before restoring clipboard
            setTimeout(() => {
              if (savedClipboard !== undefined) {
                clipboard.writeText(savedClipboard);
              }
              // B3 FIX: гарантируем что Shift не остался прижатым после paste
              try {
                ks.keyboard.toggleKey('shift', false).catch(() => {});
              } catch {}
            }, 300);

            lastInsertedTextLength = text.length;
            lastInsertedText = text;
            lastInsertTime = Date.now();
            return { success: true, method: 'keysender-shift-insert' };
          } catch (ksError) {
            console.log('[IPC] keysender failed:', ksError.message);
          }
        }
      }

      // Windows fallback: PowerShell с keybd_event API
      if (process.platform === 'win32') {
        try {
          console.log('[IPC] Using PowerShell keybd_event for paste (fallback)');

          const mainWindow = windowManager.getMainWindow();
          const isFocused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();
          // П-40: на NotesScreen окно НЕ прячем
          if (isFocused && !sharedState.getNotesScreenActive()) {
            mainWindow.hide();
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          // B3 FIX (28.04.2026): добавлены UP-события для Shift/Alt/Win
          // ПЕРЕД CtrlV() — снимает возможно залипшие модификаторы от хоткея.
          const psScript = `
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
public class KBD {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void CtrlV() {
    keybd_event(0x10, 0, 2, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    keybd_event(0x5B, 0, 2, UIntPtr.Zero);
    keybd_event(0x5C, 0, 2, UIntPtr.Zero);
    keybd_event(0x11, 0, 0, UIntPtr.Zero);
    keybd_event(0x56, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(30);
    keybd_event(0x56, 0, 2, UIntPtr.Zero);
    keybd_event(0x11, 0, 2, UIntPtr.Zero);
  }
}
'
[KBD]::CtrlV()
`;
          // Use ASCII-safe temp dir to avoid shell issues with Cyrillic paths
          const tempScript = path.join(getSafeTempDir(), 'paste.ps1');
          fs.writeFileSync(tempScript, psScript);

          // spawnSync with args array (no shell interpolation) handles
          // unusual path characters better than execSync with a shell string
          const psResult = spawnSync('powershell', [
            '-NoProfile',
            '-NonInteractive',
            '-WindowStyle', 'Hidden',
            '-ExecutionPolicy', 'Bypass',
            '-File', tempScript,
          ], {
            timeout: 3000,
            windowsHide: true,
            encoding: 'utf8',
          });

          if (psResult.error) {
            throw psResult.error;
          }
          if (psResult.status !== 0) {
            throw new Error(`PowerShell exit ${psResult.status}: ${psResult.stderr || 'no stderr'}`);
          }

          await new Promise(resolve => setTimeout(resolve, 100));
          console.log('[IPC] PowerShell keybd_event Ctrl+V sent successfully');

          setTimeout(() => {
            if (savedClipboard !== undefined) {
              clipboard.writeText(savedClipboard);
              console.log('[IPC] Clipboard restored to original');
            }
          }, 500);

          lastInsertedTextLength = text.length;
          lastInsertedText = text;
          lastInsertTime = Date.now();
          return { success: true, method: 'powershell-keybd-event' };
        } catch (psError) {
          console.log('[IPC] PowerShell keybd_event failed:', psError.message);
        }
      }

      // Windows fallback: nut.js
      if (process.platform === 'win32' && !nutInitialized) {
        initNutJs();
      }

      if (nutKeyboard && nutKey) {
        try {
          console.log('[IPC] Using nut.js for paste (fallback)');

          await new Promise(resolve => setTimeout(resolve, 50));

          await nutKeyboard.pressKey(nutKey.LeftShift);
          await new Promise(resolve => setTimeout(resolve, 10));
          await nutKeyboard.pressKey(nutKey.Insert);
          await new Promise(resolve => setTimeout(resolve, 10));
          await nutKeyboard.releaseKey(nutKey.Insert);
          await new Promise(resolve => setTimeout(resolve, 10));
          await nutKeyboard.releaseKey(nutKey.LeftShift);

          console.log('[IPC] nut.js Shift+Insert sent successfully');

          setTimeout(() => {
            if (savedClipboard !== undefined) {
              clipboard.writeText(savedClipboard);
            }
          }, 200);

          lastInsertedTextLength = text.length;
          lastInsertedText = text;
          lastInsertTime = Date.now();
          return { success: true, method: 'nutjs-shift-insert' };
        } catch (nutError) {
          console.log('[IPC] nut.js failed:', nutError.message);
        }
      }

      // Windows fallback: PowerShell SendKeys (if all above methods failed)
      if (process.platform === 'win32') {
        console.log('[IPC] Using PowerShell for paste');

        const mainWindow = windowManager.getMainWindow();
        const isFocused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();

        // П-40: на NotesScreen окно НЕ прячем
        if (isFocused && !sharedState.getNotesScreenActive()) {
          mainWindow.hide();
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        try {
          execSync(`powershell -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys('^v')"`, {
            timeout: 2000,
            windowsHide: true
          });
          console.log('[IPC] PowerShell SendKeys executed');

          setTimeout(() => {
            if (savedClipboard !== undefined) {
              clipboard.writeText(savedClipboard);
            }
          }, 200);

          lastInsertedTextLength = text.length;
          lastInsertedText = text;
          lastInsertTime = Date.now();
          return { success: true, method: 'powershell-sendkeys' };
        } catch (psError) {
          console.log('[IPC] PowerShell failed, trying robotjs:', psError.message);

          getRobot().keyToggle('control', 'up');
          getRobot().keyToggle('alt', 'up');
          getRobot().keyToggle('shift', 'up');
          await new Promise(resolve => setTimeout(resolve, 30));

          getRobot().setKeyboardDelay(10);
          getRobot().keyTap('v', 'control');

          setTimeout(() => {
            if (savedClipboard !== undefined) {
              clipboard.writeText(savedClipboard);
            }
          }, 150);

          lastInsertedTextLength = text.length;
          lastInsertedText = text;
          lastInsertTime = Date.now();
          return { success: true, method: 'robotjs-ctrl-v' };
        }
      }

      // macOS: AppleScript
      if (process.platform === 'darwin') {
        try {
          execSync(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, {
            timeout: 1000,
            stdio: 'ignore'
          });

          setTimeout(() => {
            if (savedClipboard !== undefined) {
              clipboard.writeText(savedClipboard);
            }
          }, 200);

          lastInsertedTextLength = text.length;
          lastInsertedText = text;
          lastInsertTime = Date.now();
          return { success: true, method: 'applescript-cmd-v' };
        } catch (appleScriptError) {
          console.log('[IPC] AppleScript failed, falling back to robotjs:', appleScriptError.message);
        }
      }

      // Linux (или fallback): robotjs
      console.log('[IPC] Using robotjs fallback for paste...');
      getRobot().setKeyboardDelay(0);

      const modifierKey = process.platform === 'darwin' ? 'command' : 'control';
      getRobot().keyTap('v', modifierKey);
      console.log('[IPC] robotjs keyTap sent');

      setTimeout(() => {
        if (savedClipboard !== undefined) {
          clipboard.writeText(savedClipboard);
        }
      }, 200);

      lastInsertedTextLength = text.length;
      lastInsertedText = text;
      lastInsertTime = Date.now();
      return { success: true, method: `robotjs-${modifierKey}-v` };
    } catch (error) {
      console.error('[IPC] Error inserting text:', error);
      return { success: false, error: error.message };
    }
  });

  // ============ REALTIME TEXT TYPING (for streaming) ============
  // П-21: mutex через Promise queue — гарантирует что параллельные IPC-вызовы
  //        от рендерера не наслаиваются (lastStreamText читается+пишется
  //        атомарно за одну итерацию).
  // П-22: common-prefix diff — при изменении регистра/пунктуации удаляем
  //        ровно ту часть что изменилась (через backspace) и допечатываем
  //        новый суффикс. Раньше при regress печаталась полная новая строка
  //        рядом со старой → видели "приветПривет".
  // П-23: hide() убран — теперь делается один раз в session_start
  //        (см. useStreamingRecorder.ts).
  let lastStreamText = '';
  let typingQueue = Promise.resolve();

  /**
   * Длина общего префикса двух строк
   */
  function commonPrefixLen(a, b) {
    const max = Math.min(a.length, b.length);
    let i = 0;
    while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    return i;
  }

  ipcMain.handle('type-text-realtime', async (event, text, options = {}) => {
    const { reset = false } = options;

    // Сериализуем выполнение через очередь — закрывает race condition П-21
    const task = typingQueue.then(async () => {
      // Reset state if requested (new streaming session)
      if (reset) {
        lastStreamText = '';
        console.log('[IPC] Realtime typing: reset state');
        return { success: true, method: 'reset' };
      }

      if (!text) {
        return { success: false, error: 'No text provided' };
      }

      // П-22: считаем diff через common-prefix вместо startsWith
      const common = commonPrefixLen(lastStreamText, text);
      const toDeleteCount = lastStreamText.length - common;
      const toType = text.slice(common);

      if (toDeleteCount === 0 && toType.length === 0) {
        // Текст не изменился
        return { success: true, method: 'no-change' };
      }

      // B1 INVESTIGATION: добавлены концы строк — если в проде поймаем «и»,
      // увидим где именно она появилась (в lastStreamText или в новом text).
      console.log(`[IPC] Realtime typing diff: -${toDeleteCount} +${toType.length} chars`,
                  ` lastEnd=${JSON.stringify(lastStreamText.slice(-15))}`,
                  ` newEnd=${JSON.stringify(text.slice(-15))}`,
                  ` toType=${JSON.stringify(toType)}`);

      // Use keysender for fast character-by-character typing
      if (process.platform === 'win32') {
        const ks = getKeysender();
        if (ks && ks !== false) {
          try {
            // Удалить устаревший суффикс (если был regress в diff)
            for (let i = 0; i < toDeleteCount; i++) {
              await ks.keyboard.sendKey('backspace');
            }
            // Допечатать новый суффикс
            if (toType) {
              await ks.keyboard.printText(toType);
            }

            lastStreamText = text;
            return {
              success: true,
              method: 'keysender-realtime',
              deleted: toDeleteCount,
              typed: toType.length
            };
          } catch (ksError) {
            console.log('[IPC] keysender realtime failed:', ksError.message);
          }
        }
      }

      // Fallback: robotjs (no native diff support — печатаем только дополнение)
      try {
        getRobot().setKeyboardDelay(0);
        // robotjs: backspace через keyTap
        for (let i = 0; i < toDeleteCount; i++) {
          getRobot().keyTap('backspace');
        }
        if (toType) {
          getRobot().typeString(toType);
        }
        lastStreamText = text;
        return {
          success: true,
          method: 'robotjs-realtime',
          deleted: toDeleteCount,
          typed: toType.length
        };
      } catch (robotError) {
        console.log('[IPC] robotjs realtime failed:', robotError.message);
      }

      // Last fallback
      lastStreamText = text;
      return { success: false, error: 'No realtime typing method available' };
    }).catch(err => {
      console.error('[IPC] Error in realtime typing queue:', err);
      return { success: false, error: err.message };
    });

    // Не разорвать цепочку даже при ошибке — следующий вызов продолжит
    typingQueue = task.catch(() => {});
    return task;
  });

  // ============ UNDO LAST INSERT ============
  ipcMain.handle('undo-last-insert', async () => {
    try {
      if (lastInsertedTextLength > 0) {
        getRobot().setKeyboardDelay(5);
        for (let i = 0; i < lastInsertedTextLength; i++) {
          getRobot().keyTap('backspace');
          await new Promise(resolve => setTimeout(resolve, 3));
        }
        lastInsertedTextLength = 0;
        return { success: true };
      }
      return { success: false, error: 'Nothing to undo' };
    } catch (error) {
      console.error('[IPC] Error undoing last insert:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[IPC:TextInsertion] Handlers registered');
}

module.exports = { registerTextInsertionHandlers };
