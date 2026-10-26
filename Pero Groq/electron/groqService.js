/**
 * Groq Service — замена api.speakflow.ru
 * Прямые вызовы Groq API с ключом пользователя
 */

const https = require('https');
const FormData = require('form-data');
let HttpsProxyAgent;
try {
  HttpsProxyAgent = require('https-proxy-agent').HttpsProxyAgent;
} catch (e) {
  console.warn("https-proxy-agent not available", e.message);
}

// Groq API endpoint
const GROQ_API_BASE = 'https://api.groq.com';

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
  if (_apiKey && _apiKey !== 'gsk_YOUR_GROQ_API_KEY_HERE') return _apiKey;
  if (_secureStore) {
    const key = _secureStore.getGroqApiKey();
    if (key && key !== 'gsk_YOUR_GROQ_API_KEY_HERE') {
      _apiKey = key;
      return _apiKey;
    }
  }
  return null;
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
 * Проверка на временную сетевую ошибку (для retry)
 */
function isNetworkError(err) {
  if (!err || !err.message) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('socket hang up') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('epipe') ||
    msg.includes('econnrefused') ||
    msg.includes('network error') ||
    msg.includes('timeout')
  );
}

/**
 * Единичный запрос fetch через Node.js https
 */
function _singleGroqFetch(path, options = {}) {
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
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...options.headers,
      },
      timeout: 60000,
    };

    // Применяем прокси только если useProxy не выключен
    if (settings.useProxy !== false && settings.httpProxy && settings.httpProxy.trim() !== '' && HttpsProxyAgent) {
      try {
        reqOptions.agent = new HttpsProxyAgent(settings.httpProxy.trim());
      } catch (err) {
        console.error("Invalid HTTP Proxy format:", err.message);
      }
    }

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
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout (API is not responding)'));
    });

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
 * Выполнить fetch через Node.js с автоматическим retry при сетевых сбоях
 */
async function groqFetch(path, options = {}, maxRetries = 2) {
  let attempt = 0;
  while (true) {
    try {
      return await _singleGroqFetch(path, options);
    } catch (err) {
      if (attempt < maxRetries && isNetworkError(err)) {
        attempt++;
        const delay = attempt * 500;
        console.warn(`[Groq] Network error in groqFetch: ${err.message}. Retrying (${attempt}/${maxRetries}) in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Единичная транскрипция аудио
 */
function _singleTranscribe(audioBuffer, language = 'ru') {
  return new Promise((resolve, reject) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return reject(new Error('Groq API key not set. Please add your key in Settings.'));
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

    const settings = _secureStore ? _secureStore.getSettings() : {};
    const baseUrl = settings.proxyBaseUrl && settings.proxyBaseUrl.trim() !== '' 
      ? settings.proxyBaseUrl 
      : GROQ_API_BASE;
      
    const url = new URL(baseUrl);
    url.pathname = url.pathname.replace(/\/$/, '') + '/openai/v1/audio/transcriptions';
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
      timeout: 60000,
    };

    // Применяем прокси только если useProxy не выключен
    if (settings.useProxy !== false && settings.httpProxy && settings.httpProxy.trim() !== '' && HttpsProxyAgent) {
      try {
        reqOptions.agent = new HttpsProxyAgent(settings.httpProxy.trim());
      } catch (err) {
        console.error("Invalid HTTP Proxy format:", err.message);
      }
    }

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
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Transcription request timeout (API is not responding)'));
    });
    form.pipe(req);
  });
}

/**
 * Транскрибировать аудио через Groq Whisper с автоматическим retry при сетевых сбоях
 * @param {Buffer} audioBuffer — WebM аудио буфер
 * @param {string} language — язык ('ru', 'en', null для авто)
 * @returns {Promise<{text: string}>}
 */
async function transcribeAudio(audioBuffer, language = 'ru', maxRetries = 2) {
  let attempt = 0;
  while (true) {
    try {
      return await _singleTranscribe(audioBuffer, language);
    } catch (err) {
      if (attempt < maxRetries && isNetworkError(err)) {
        attempt++;
        const delay = attempt * 500;
        console.warn(`[Groq] Network error in transcribeAudio: ${err.message}. Retrying (${attempt}/${maxRetries}) in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
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
  if (!key || typeof key !== 'string' || !key.trim().startsWith('gsk_') || key.trim() === 'gsk_YOUR_GROQ_API_KEY_HERE') {
    return { valid: false, error: 'Ключ должен начинаться с gsk_ и быть действительным.' };
  }
  const cleanKey = key.trim();
  const savedKey = _apiKey;
  _apiKey = cleanKey;
  try {
    await groqFetch('/openai/v1/models', {
      method: 'GET',
    }, 0);
    return { valid: true };
  } catch (err) {
    _apiKey = savedKey;
    console.error('[Groq] Validation failed:', err.message);
    let errMsg = err.message || 'Ошибка проверки ключа';
    if (errMsg.includes('Invalid API Key') || errMsg.includes('invalid_api_key')) {
      errMsg = 'Неверный API ключ (Groq отклонил запрос). Проверьте ключ в console.groq.com.';
    }
    return { valid: false, error: errMsg };
  }
}

/**
 * Проверить доступность Groq API через текущие настройки прокси/сети
 */
async function testConnection() {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, error: 'Groq API ключ не задан.' };
  }

  const settings = _secureStore ? _secureStore.getSettings() : {};
  const isProxy = settings.useProxy !== false && !!(settings.httpProxy && settings.httpProxy.trim());

  try {
    const res = await groqFetch('/openai/v1/models', { method: 'GET' }, 0);
    return {
      success: true,
      proxyUsed: isProxy ? settings.httpProxy : null,
      modelsCount: res?.data ? res.data.length : 0
    };
  } catch (err) {
    return {
      success: false,
      proxyUsed: isProxy ? settings.httpProxy : null,
      error: err.message
    };
  }
}

module.exports = {
  init,
  setApiKey,
  getApiKey,
  validateApiKey,
  testConnection,
  transcribeAudio,
  cleanupText,
  translateText,
  models: {
    transcription: WHISPER_MODEL,
    chat: LLM_MODEL
  }
};
