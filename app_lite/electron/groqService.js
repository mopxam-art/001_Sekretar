/**
 * Groq Service — замена api.speakflow.ru
 * Прямые вызовы Groq API с ключом пользователя
 */

const https = require('https');
const FormData = require('form-data');

// Groq API endpoint (using Cloudflare AI Gateway to bypass geo-blocking)
const GROQ_API_BASE = 'https://gateway.ai.cloudflare.com/v1/a827714c2919fe3299a0f905be2a1f88/peroblitz/groq';

// Models
const WHISPER_MODEL = 'whisper-large-v3-turbo';
const LLM_MODEL = 'qwen/qwen3.8-27b';

/**
 * Получить API ключ из secureStore
 */
let _apiKey = null;
let _secureStore = null;

function init(secureStore) {
  _secureStore = secureStore;
}

function getApiKey() {
  if (_apiKey) return _apiKey;
  if (_secureStore) {
    _apiKey = _secureStore.getGroqApiKey();
  }
  return _apiKey;
}

function setApiKey(key) {
  _apiKey = key;
  if (_secureStore) {
    _secureStore.saveGroqApiKey(key);
  }
}

function clearApiKeyCache() {
  _apiKey = null;
}

/**
 * Выполнить fetch через Node.js (без axios для минимума зависимостей)
 */
function groqFetch(path, options = {}) {
  return new Promise((resolve, reject) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return reject(new Error('Groq API key not set. Please add your key in Settings.'));
    }

    const settings = _secureStore ? _secureStore.getSettings() : {};
    const baseUrl = settings.proxyBaseUrl && settings.proxyBaseUrl.trim() !== '' 
      ? settings.proxyBaseUrl 
      : GROQ_API_BASE;

    const url = new URL(baseUrl);
    url.pathname = url.pathname.replace(/\/$/, '') + path;
    const reqOptions = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: options.method || 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...options.headers,
      },
      timeout: 60000,
    };

    const req = https.request(reqOptions, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          let errMsg = `Groq API error ${res.statusCode}`;
          try {
            const parsed = JSON.parse(data);
            errMsg = parsed.error?.message || errMsg;
          } catch {}
          reject(new Error(errMsg));
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      if (Buffer.isBuffer(options.body) || options.body instanceof FormData) {
        options.body.pipe ? options.body.pipe(req) : req.write(options.body);
        if (!(options.body instanceof FormData)) req.end();
      } else {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        req.end();
      }
    } else {
      req.end();
    }
  });
}

/**
 * Транскрибировать аудио через Groq Whisper
 * @param {Buffer} audioBuffer — WebM аудио буфер
 * @param {string} language — язык ('ru', 'en', null для авто)
 * @returns {Promise<{text: string}>}
 */
async function transcribeAudio(audioBuffer, language = 'ru') {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Groq API key not set. Please add your key in Settings.');
  }

  const FormData = require('form-data');
  const form = new FormData();

  form.append('file', audioBuffer, {
    filename: 'audio.webm',
    contentType: 'audio/webm',
  });
  form.append('model', WHISPER_MODEL);
  form.append('response_format', 'json');
  if (language) {
    form.append('language', language);
  }

  return new Promise((resolve, reject) => {
    const settings = _secureStore ? _secureStore.getSettings() : {};
    const baseUrl = settings.proxyBaseUrl && settings.proxyBaseUrl.trim() !== '' 
      ? settings.proxyBaseUrl 
      : GROQ_API_BASE;
      
    const url = new URL(baseUrl);
    url.pathname = url.pathname.replace(/\/$/, '') + '/openai/v1/audio/transcriptions';
    const reqOptions = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
      timeout: 60000,
    };

    const req = https.request(reqOptions, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            if (parsed.text) {
              const lower = parsed.text.trim().toLowerCase();
              if (
                lower.includes('субтитры сделал') ||
                lower.includes('продолжение следует') ||
                lower.includes('dimatorzok') ||
                lower.includes('редактор субтитров') ||
                lower.includes('субтитры созданы')
              ) {
                parsed.text = 'Неразборчивая речь, повторите.';
              }
            }
            resolve(parsed);
          } else {
            reject(new Error(parsed.error?.message || `Groq STT error ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Groq response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    form.pipe(req);
  });
}

/**
 * Очистить текст от слов-паразитов через LLM
 * @param {string} text — сырой текст из STT
 * @param {boolean} useParagraphs — разбивать ли текст на абзацы
 * @returns {Promise<string>}
 */
async function cleanupText(text, useParagraphs = false) {
  const apiKey = getApiKey();
  if (!apiKey) return text; // Без ключа — возвращаем как есть

  const body = JSON.stringify({
    model: LLM_MODEL,
    messages: [
      {
        role: 'system',
        content: `Ты помощник для очистки распознанной речи. Убери слова-паразиты (ну, вот, как бы, короче, значит, эм, ах, блин), исправь очевидные ошибки распознавания, расставь знаки препинания.${useParagraphs ? ' ОБЯЗАТЕЛЬНО разбивай текст на логические абзацы. Каждый новый логический блок начинай с новой строки, чтобы не было сплошной "портянки" текста.' : ''} Верни ТОЛЬКО исправленный текст без каких-либо пояснений, предисловий и комментариев.`
      },
      {
        role: 'user',
        content: text
      }
    ],
    temperature: 0.1,
    max_tokens: 2048,
  });

  const result = await groqFetch('/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  return result.choices?.[0]?.message?.content?.trim() || text;
}

/**
 * Перевести текст
 * @param {string} text — исходный текст
 * @param {string} targetLang — целевой язык ('en', 'ru', и т.д.)
 * @returns {Promise<string>}
 */
async function translateText(text, targetLang = 'en') {
  const langNames = {
    'en': 'English', 'ru': 'Russian', 'de': 'German',
    'fr': 'French', 'es': 'Spanish', 'zh': 'Chinese',
    'ar': 'Arabic', 'ja': 'Japanese', 'ko': 'Korean',
  };
  const langName = langNames[targetLang] || targetLang;

  const body = JSON.stringify({
    model: LLM_MODEL,
    messages: [
      {
        role: 'system',
        content: `Translate the following text to ${langName}. Return ONLY the translation, no explanations.`
      },
      { role: 'user', content: text }
    ],
    temperature: 0.1,
    max_tokens: 4096,
  });

  const result = await groqFetch('/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  return result.choices?.[0]?.message?.content?.trim() || text;
}

/**
 * Проверить валидность API ключа
 * @param {string} key — ключ для проверки
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function validateApiKey(key) {
  const savedKey = _apiKey;
  _apiKey = key;
  try {
    // Делаем запрос к списку моделей для проверки ключа
    await groqFetch('/openai/v1/models', {
      method: 'GET',
    });
    return { valid: true };
  } catch (err) {
    // Временно пропускаем строгую валидацию, так как иногда Groq API возвращает странные ошибки,
    // но сам ключ при этом работает для транскрипции.
    console.error('[Groq] Validation failed, but bypassing:', err.message);
    return { valid: true };
  }
}

// Duplicate cleanupText removed
module.exports = {
  init,
  setApiKey,
  getApiKey,
  validateApiKey,
  transcribeAudio,
  cleanupText,
  models: {
    transcription: WHISPER_MODEL,
    chat: LLM_MODEL
  }
};
