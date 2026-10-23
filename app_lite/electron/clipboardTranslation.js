const { clipboard } = require('electron');
const axios = require('axios');
const { machineIdSync } = require('node-machine-id');

class ClipboardTranslation {
  constructor(mainWindow, translationOverlay) {
    this.mainWindow = mainWindow;
    this.translationOverlay = translationOverlay; // Отдельный оверлей для перевода
    this.enabled = false;
    this.intervalId = null;
    this.lastClipboardText = '';
    this.lastOriginalText = '';
    this.lastTranslatedText = '';
    this.isFirstCheck = true;
    this.minTextLength = 3;
    this.maxTextLength = 2000; // Увеличено до 2000 символов для больших текстов
    this.autoHideDelay = 5; // 5 секунд по умолчанию (можно изменить в настройках)
    this.ignoreNextChange = false; // Флаг для игнорирования внутренних операций
    this.ignoreTimeout = null; // Таймер для сброса флага
    this.lastTranslationTimestamp = 0; // Защита от повторных переводов одного текста
    this.translationCooldown = 5000; // 5 секунд минимум между переводами одного текста
    // Get machine ID once during initialization
    this.deviceId = machineIdSync();
    console.log('[ClipboardTranslation] Device ID:', this.deviceId);
  }

  start() {
    // ✅ КРИТИЧНО: Очищаем старый интервал перед запуском нового
    // Иначе будут работать несколько интервалов параллельно → дубли переводов
    if (this.intervalId) {
      console.log('[ClipboardTranslation] ⚠️ Already running! Clearing previous interval first');
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('[ClipboardTranslation] ✅ Starting clipboard monitoring...');

    this.enabled = true;
    this.isFirstCheck = true;

    // Check clipboard every 1 second
    this.intervalId = setInterval(async () => {
      if (!this.enabled) return;

      try {
        const text = clipboard.readText();
        if (text && text.trim()) {
          await this.handleClipboardChange(text);
        }
      } catch (error) {
        console.error('[ClipboardTranslation] Error reading clipboard:', error);
      }
    }, 1000);
  }

  stop() {
    console.log('[ClipboardTranslation] Stopping clipboard monitoring...');
    this.enabled = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // ✅ Очищаем ignoreTimeout чтобы избежать утечки памяти
    if (this.ignoreTimeout) {
      clearTimeout(this.ignoreTimeout);
      this.ignoreTimeout = null;
    }
  }

  detectLanguage(text) {
    // Simple heuristic - check for Cyrillic vs Latin
    const cyrillicPattern = /[а-яА-ЯЁё]/;
    const latinPattern = /[a-zA-Z]/;

    const hasCyrillic = cyrillicPattern.test(text);
    const hasLatin = latinPattern.test(text);

    // Подсчитываем соотношение кириллицы и латиницы
    const cyrillicCount = (text.match(/[а-яА-ЯЁё]/g) || []).length;
    const latinCount = (text.match(/[a-zA-Z]/g) || []).length;

    console.log(`[ClipboardTranslation] Language detection: ${cyrillicCount} Cyrillic, ${latinCount} Latin chars`);

    // Если преобладает кириллица - это русский (не переводим)
    if (cyrillicCount > latinCount && cyrillicCount > 0) {
      return 'ru';
    }

    // Если есть латиница и мало кириллицы (или вообще нет) - это английский
    // ✅ Изменено: теперь считаем английским если есть хотя бы немного латиницы
    if (latinCount > 0 && cyrillicCount < latinCount) {
      return 'en';
    }

    // Если вообще нет букв (только цифры, символы) - не переводим
    if (latinCount === 0 && cyrillicCount === 0) {
      return 'unknown';
    }

    // По умолчанию - если не определили точно, считаем английским
    // (чтобы хотя бы попытаться перевести)
    return latinCount > 0 ? 'en' : 'unknown';
  }

  async handleClipboardChange(clipboardText) {
    // First check - just save current clipboard state
    if (this.isFirstCheck) {
      this.isFirstCheck = false;
      this.lastClipboardText = clipboardText;
      console.log('[ClipboardTranslation] Initial clipboard state saved');
      return;
    }

    // ВАЖНО: Игнорировать если это внутренняя операция приложения
    if (this.ignoreNextChange) {
      console.log('[ClipboardTranslation] Ignoring internal app operation');
      this.ignoreNextChange = false;
      this.lastClipboardText = clipboardText;
      return;
    }

    // Ignore empty or too short text
    if (!clipboardText || clipboardText.trim().length < this.minTextLength) {
      return;
    }

    // Ignore too long text (silent skip to avoid log spam)
    if (clipboardText.length > this.maxTextLength) {
      return;
    }

    // Ignore if same as last check
    if (clipboardText === this.lastClipboardText) {
      return;
    }

    // Ignore if it's our own translation or previous original (avoid loop)
    if (clipboardText === this.lastTranslatedText || clipboardText === this.lastOriginalText) {
      console.log('[ClipboardTranslation] Skipping to avoid loop');
      this.lastClipboardText = clipboardText;
      return;
    }

    // ✅ Защита от повторных переводов одного текста за короткий период
    // (если несколько интервалов работают параллельно или пользователь быстро копирует)
    const now = Date.now();
    if (clipboardText === this.lastOriginalText &&
        now - this.lastTranslationTimestamp < this.translationCooldown) {
      console.log('[ClipboardTranslation] Same text translated recently, skipping (cooldown)');
      this.lastClipboardText = clipboardText;
      return;
    }

    this.lastClipboardText = clipboardText;

    // Detect language
    const detectedLang = this.detectLanguage(clipboardText);

    // ВАЖНО: Переводим ТОЛЬКО английский текст → русский (EN→RU)
    // Русский текст игнорируем (для RU→EN есть отдельная горячая клавиша Ctrl+Shift+T)
    if (detectedLang !== 'en') {
      console.log(`[ClipboardTranslation] Text is not English (detected: ${detectedLang}), skipping translation`);
      return;
    }

    const finalTargetLang = 'ru'; // Всегда переводим на русский

    console.log(`[ClipboardTranslation] Detected English text, translating to Russian`);

    try {
      // Get access token and API URL from main window's localStorage
      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        console.error('[ClipboardTranslation] Main window not available');
        return;
      }

      const accessToken = await this.mainWindow.webContents.executeJavaScript('localStorage.getItem("accessToken")');
      const apiUrl = process.env.VITE_API_URL || 'https://api.speakflow.ru';

      if (!accessToken) {
        console.error('[ClipboardTranslation] No access token');
        return;
      }

      // ✅ Получаем модель из настроек пользователя
      const userModel = await this.mainWindow.webContents.executeJavaScript('localStorage.getItem("translation_model")');
      const model = userModel || 'minimax/minimax-m2:free'; // Fallback на дефолтную модель

      // Call translation API
      const requestData = {
        text: clipboardText,
        targetLang: finalTargetLang,  // ✅ Исправлено: targetLang вместо targetLanguage
        model: model
      };

      console.log('[ClipboardTranslation] Translating EN→RU:', clipboardText.substring(0, 50) + '...');

      const response = await axios.post(
        `${apiUrl}/api/translation/translate`,
        requestData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Device-ID': this.deviceId
          }
        }
      );

      console.log('[ClipboardTranslation] ✅ Translation completed');

      if (response.data && response.data.translatedText) {
        const result = {
          originalText: clipboardText,
          translatedText: response.data.translatedText,
          sourceLang: detectedLang,
          targetLang: finalTargetLang,
          autoHideDelay: this.autoHideDelay
        };

        // Save to avoid re-translating
        this.lastOriginalText = clipboardText;
        this.lastTranslatedText = response.data.translatedText;
        this.lastTranslationTimestamp = Date.now(); // ✅ Сохраняем время перевода

        // Показываем перевод в отдельном оверлее
        if (this.translationOverlay) {
          this.translationOverlay.show(result);
          console.log('[ClipboardTranslation] ✅ Translation shown in overlay:', {
            original: result.originalText.substring(0, 30) + '...',
            translated: result.translatedText.substring(0, 30) + '...'
          });
        } else {
          console.error('[ClipboardTranslation] ❌ Translation overlay not available');
        }
      }
    } catch (error) {
      console.error('[ClipboardTranslation] Translation failed:', error.message);
      if (error.response) {
        console.error('[ClipboardTranslation] Response data:', error.response.data);
        console.error('[ClipboardTranslation] Response status:', error.response.status);
      }
    }
  }

  setAutoHideDelay(delay) {
    this.autoHideDelay = delay;
    // Передаём настройку в оверлей
    if (this.translationOverlay) {
      this.translationOverlay.setAutoHideDelay(delay);
    }
  }

  // Метод для установки флага игнорирования следующего изменения
  // Вызывается когда приложение само вставляет текст через буфер обмена
  ignoreNextClipboardChange() {
    this.ignoreNextChange = true;
    console.log('[ClipboardTranslation] Next clipboard change will be ignored');

    // Сбрасываем флаг через 2 секунды на случай если что-то пошло не так
    if (this.ignoreTimeout) {
      clearTimeout(this.ignoreTimeout);
    }
    this.ignoreTimeout = setTimeout(() => {
      if (this.ignoreNextChange) {
        console.log('[ClipboardTranslation] Auto-resetting ignore flag after timeout');
        this.ignoreNextChange = false;
      }
    }, 2000);
  }
}

module.exports = ClipboardTranslation;
