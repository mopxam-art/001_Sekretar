import React, { useState, useEffect } from 'react';
import './Settings.css';

const ipc = (window as any).electron?.ipcRenderer;

interface Props {
  onApiKeySaved: () => void;
}

interface AppSettings {
  hotkey: string;
  hotkeyMode: 'hold' | 'toggle';
  language: string;
  aiCleanup: boolean;
  useParagraphs: boolean;
  audioDucking?: boolean;
  overlayVisible: boolean;
  autostart: boolean;
  proxyBaseUrl: string;
  useProxy: boolean;
  httpProxy: string;
  updateUrl?: string;
  translateHotkey: string;
  undoHotkey: string;
  meetingHotkey: string;
}

export default function Settings({ onApiKeySaved }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [keyPreview, setKeyPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'ok' | 'error' | null>(null);
  const [saveError, setSaveError] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Auto-updater states
  const [appVersion, setAppVersion] = useState('1.0.2');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<{
    type: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
    message: string;
    version?: string;
    percent?: number;
  }>({ type: 'idle', message: '' });

  const [settings, setSettings] = useState<AppSettings>({
    hotkey: 'CommandOrControl+Alt',
    hotkeyMode: 'toggle',
    language: 'ru',
    aiCleanup: false, // Default to clean raw Whisper without rephrasing
    useParagraphs: false,
    audioDucking: true,
    overlayVisible: true,
    autostart: false,
    proxyBaseUrl: '',
    useProxy: true,
    httpProxy: '',
    updateUrl: '',
    translateHotkey: 'CommandOrControl+Shift+T',
    undoHotkey: 'CommandOrControl+Shift+Z',
    meetingHotkey: 'CommandOrControl+Shift+M',
  });

  useEffect(() => {
    if (!ipc) return;
    ipc.invoke('groq:get-status').then((s: any) => {
      if (s?.keyPreview) setKeyPreview(s.keyPreview);
    }).catch(() => {});
    ipc.invoke('settings:get').then((s: any) => {
      if (s) setSettings(prev => ({ ...prev, ...s }));
    }).catch(() => {});
    ipc.invoke('get-app-version').then((v: string) => {
      if (v) setAppVersion(v);
    }).catch(() => {});

    // Listen to auto-updater IPC events
    const unsubs = [
      ipc.on('update-checking', () => {
        setUpdateStatus({ type: 'checking', message: 'Проверка наличия обновлений на сервере...' });
      }),
      ipc.on('update-available', (_e: any, info: any) => {
        setCheckingUpdate(false);
        setUpdateStatus({
          type: 'available',
          version: info?.version,
          message: `Доступна новая версия ${info?.version || ''}! Нажмите «Скачать обновление».`
        });
      }),
      ipc.on('update-not-available', () => {
        setCheckingUpdate(false);
        setUpdateStatus({
          type: 'not-available',
          message: 'У вас установлена самая последняя версия приложения.'
        });
      }),
      ipc.on('update-download-progress', (_e: any, progress: any) => {
        const p = Math.round(progress?.percent || 0);
        setUpdateStatus({
          type: 'downloading',
          percent: p,
          message: `Загрузка обновления: ${p}%`
        });
      }),
      ipc.on('update-downloaded', (_e: any, info: any) => {
        setCheckingUpdate(false);
        setUpdateStatus({
          type: 'downloaded',
          version: info?.version,
          message: `Обновление ${info?.version || ''} загружено! Готово к установке.`
        });
      }),
      ipc.on('update-error', (_e: any, err: any) => {
        setCheckingUpdate(false);
        setUpdateStatus({
          type: 'error',
          message: err?.message ? `Ошибка обновления: ${err.message}` : 'Не удалось получить данные об обновлении.'
        });
      })
    ];

    return () => {
      unsubs.forEach(u => typeof u === 'function' && u());
    };
  }, []);

  const handleCheckUpdates = async () => {
    if (!ipc) return;
    setCheckingUpdate(true);
    setUpdateStatus({ type: 'checking', message: 'Проверка наличия обновлений...' });
    try {
      const res = await ipc.invoke('check-for-updates', settings.updateUrl);
      if (res && res.success === false && res.error) {
        setCheckingUpdate(false);
        setUpdateStatus({ type: 'error', message: res.error });
      }
    } catch (e: any) {
      setCheckingUpdate(false);
      setUpdateStatus({ type: 'error', message: e.message || 'Ошибка соединения с сервером обновлений' });
    }
  };

  const handleDownloadUpdate = async () => {
    if (!ipc) return;
    setUpdateStatus({ type: 'downloading', percent: 0, message: 'Начало скачивания обновления...' });
    try {
      const res = await ipc.invoke('download-update');
      if (res && res.success === false && res.error) {
        setUpdateStatus({ type: 'error', message: res.error });
      }
    } catch (e: any) {
      setUpdateStatus({ type: 'error', message: e.message || 'Ошибка загрузки' });
    }
  };

  const handleInstallUpdate = async () => {
    if (!ipc) return;
    try {
      await ipc.invoke('install-update');
    } catch (e: any) {
      setUpdateStatus({ type: 'error', message: e.message || 'Ошибка установки обновления' });
    }
  };

  const handleTestConnection = async () => {
    if (!ipc) return;
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await ipc.invoke('network:test-connection');
      if (res?.success) {
        setTestResult({
          success: true,
          message: res.proxyUsed 
            ? `Связь с Groq установлена через прокси (${res.proxyUsed})!` 
            : 'Связь с Groq установлена (прямое подключение / VPN)!'
        });
      } else {
        setTestResult({
          success: false,
          message: `Ошибка: ${res?.error || 'Сервер недоступен'}`
        });
      }
    } catch (e: any) {
      setTestResult({
        success: false,
        message: `Ошибка: ${e?.message || 'Неизвестная ошибка'}`
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const result = await ipc?.invoke('groq:set-api-key', apiKey.trim());
      if (result?.success) {
        setSaveResult('ok');
        setKeyPreview(`${apiKey.substring(0, 8)}...${apiKey.slice(-4)}`);
        setApiKey('');
        setTimeout(() => { setSaveResult(null); onApiKeySaved(); }, 1200);
      } else {
        setSaveResult('error');
        setSaveError(result?.error || 'Неверный ключ');
      }
    } catch (e: any) {
      setSaveResult('error');
      setSaveError(e.message || 'Ошибка');
    }
    setSaving(false);
  };

  const [capturingHotkeyFor, setCapturingHotkeyFor] = useState<keyof AppSettings | null>(null);

  useEffect(() => {
    if (!capturingHotkeyFor) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturingHotkeyFor(null);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return; // Handled in keydown
      e.preventDefault();
      e.stopPropagation();
      
      const keys: string[] = [];
      if (e.ctrlKey || e.key === 'Control') keys.push('CommandOrControl');
      if (e.altKey || e.key === 'Alt') keys.push('Alt');
      if (e.shiftKey || e.key === 'Shift') keys.push('Shift');
      if (e.metaKey || e.key === 'Meta') keys.push('Super');
      
      const isModifier = e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta';
      if (!isModifier) {
        let key = e.key.toUpperCase();
        if (key === ' ') key = 'Space';
        keys.push(key);
      }
      
      const newHotkey = keys.join('+');
      if (keys.length > 0) {
        handleSettingChange(capturingHotkeyFor, newHotkey);
        setCapturingHotkeyFor(null);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [capturingHotkeyFor]);

  const handleSettingChange = (key: keyof AppSettings, value: any) => {
    setSettings(prev => {
      const updated = { ...prev, [key]: value };
      // Whenever hotkey or hotkeyMode changes — sync with backend
      if (key === 'hotkeyMode' || key === 'hotkey') {
        ipc?.invoke('set-hotkey', updated.hotkey, updated.hotkeyMode).catch(() => {});
      }
      return updated;
    });
    ipc?.invoke('settings:set', key, value).catch(() => {});
  };

  return (
    <div className="tab-container">
      <div className="tab-header">
        <h1 className="tab-title">Настройки</h1>
        <div className="tab-subtitle">Конфигурация Перо Блиц</div>
      </div>

      <div className="settings-scroll">
        {/* API Key */}
        <section className="settings-section">
          <div className="section-title">🔑 Groq API Ключ</div>
          <div className="setting-sub" style={{ marginBottom: '12px' }}>
            Прямой доступ к Groq Cloud (Whisper Large v3 + Qwen). Ключ хранится локально в зашифрованном виде.
          </div>

          {keyPreview && (
            <div className="current-key">
              <span>Текущий ключ: <code>{keyPreview}</code></span>
            </div>
          )}

          <div className="key-input-row">
            <input
              type="password"
              className="input-field key-input"
              placeholder={keyPreview ? 'Введите новый ключ для замены...' : 'gsk_...'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveKey()}
            />
            <button
              className="btn-primary"
              onClick={handleSaveKey}
              disabled={saving || !apiKey.trim()}
            >
              {saving ? 'Проверка...' : 'Сохранить'}
            </button>
          </div>

          {saveResult === 'ok' && (
            <div className="save-status ok">✓ Ключ успешно сохранён и проверен!</div>
          )}
          {saveResult === 'error' && (
            <div className="save-status error">✗ Ошибка: {saveError}</div>
          )}
        </section>

        {/* Hotkeys */}
        <section className="settings-section">
          <div className="section-title">⌨️ Горячие клавиши</div>

          <div className="setting-row">
            <div className="setting-label">
              <span>Клавиша записи</span>
              <span className="setting-sub">Нажмите для изменения комбинации</span>
            </div>
            <button
              className={`hotkey-badge ${capturingHotkeyFor === 'hotkey' ? 'capturing' : ''}`}
              onClick={() => setCapturingHotkeyFor('hotkey')}
            >
              {capturingHotkeyFor === 'hotkey' ? 'Нажмите клавиши...' : settings.hotkey}
            </button>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <span>Режим работы клавиши</span>
              <span className="setting-sub">
                {settings.hotkeyMode === 'toggle' 
                  ? 'Нажатие включает / повторное нажатие выключает' 
                  : 'Запись идёт, пока клавиша зажата'}
              </span>
            </div>
            <select
              className="select-field"
              value={settings.hotkeyMode}
              onChange={e => handleSettingChange('hotkeyMode', e.target.value)}
            >
              <option value="toggle">Переключатель (Toggle)</option>
              <option value="hold">Удержание (Hold)</option>
            </select>
          </div>
        </section>

        {/* Speech Recognition */}
        <section className="settings-section">
          <div className="section-title">🎙️ Распознавание речи</div>

          <div className="setting-row">
            <div className="setting-label">
              <span>Основной язык</span>
              <span className="setting-sub">Язык для Groq Whisper</span>
            </div>
            <select
              className="select-field"
              value={settings.language}
              onChange={e => handleSettingChange('language', e.target.value)}
            >
              <option value="ru">🇷🇺 Русский</option>
              <option value="en">🇬🇧 English</option>
              <option value="auto">🌐 Автоопределение</option>
              <option value="es">🇪🇸 Español</option>
              <option value="de">🇩🇪 Deutsch</option>
              <option value="fr">🇫🇷 Français</option>
            </select>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <span>AI-очистка текста</span>
              <span className="setting-sub">
                {settings.aiCleanup 
                  ? 'Включено: текстовая нейросеть удаляет слова-паразиты и расставляет пунктуацию'
                  : 'Выключено: моментальный вывод сырого дословного текста Whisper'}
              </span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.aiCleanup}
                onChange={e => handleSettingChange('aiCleanup', e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>

          {settings.aiCleanup && (
            <div className="setting-row">
              <div className="setting-label">
                <span>Разделение на абзацы</span>
                <span className="setting-sub">Автоматически форматировать длинный текст абзацами</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={settings.useParagraphs}
                  onChange={e => handleSettingChange('useParagraphs', e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          )}
        </section>

        {/* System */}
        <section className="settings-section">
          <div className="section-title">⚙️ Система</div>
          <div className="setting-row">
            <div className="setting-label">
              <span>Приглушать звук при записи</span>
              <span className="setting-sub">Audio Ducking — снижает громкость системы до 30%</span>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={settings.audioDucking} onChange={e => handleSettingChange('audioDucking', e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span>Показывать оверлей записи</span>
              <span className="setting-sub">Плавающий индикатор поверх всех окон</span>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={settings.overlayVisible} onChange={e => handleSettingChange('overlayVisible', e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span>Запуск вместе с Windows</span>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={settings.autostart} onChange={e => handleSettingChange('autostart', e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
        </section>

        {/* Network & Proxy */}
        <section className="settings-section">
          <div className="section-title">🌐 Сеть и Прокси</div>

          <div className="setting-row">
            <div className="setting-label">
              <span>Работать по прокси</span>
              <span className="setting-sub">
                {settings.useProxy 
                  ? 'Включено: запросы к Groq идут через прокси (Tailscale или указанный ниже)' 
                  : 'Выключено: прямое подключение (используйте, если включен системный VPN)'}
              </span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.useProxy}
                onChange={e => handleSettingChange('useProxy', e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>

          {settings.useProxy && (
            <div className="setting-row">
              <div className="setting-label">
                <span>HTTP/HTTPS Прокси</span>
                <span className="setting-sub">
                  По умолчанию: http://100.86.75.16:8888 (Tailscale). Или ваш свой: http://login:pass@ip:port
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  className="input-field"
                  placeholder="http://100.86.75.16:8888"
                  value={settings.httpProxy || ''}
                  onChange={e => handleSettingChange('httpProxy', e.target.value)}
                  style={{ width: '230px' }}
                />
                {settings.httpProxy && settings.httpProxy !== 'http://100.86.75.16:8888' && (
                  <button
                    className="btn-secondary"
                    style={{ padding: '6px 10px', fontSize: '11px', whiteSpace: 'nowrap' }}
                    title="Сбросить на наш стандартный Tailscale-прокси"
                    onClick={() => handleSettingChange('httpProxy', 'http://100.86.75.16:8888')}
                  >
                    Сброс
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="setting-row">
            <div className="setting-label">
              <span>Base URL (Reverse Proxy)</span>
              <span className="setting-sub">Стандарт: https://api.groq.com (оставьте пустым по умолчанию)</span>
            </div>
            <input
              type="text"
              className="input-field"
              placeholder="https://api.groq.com"
              value={settings.proxyBaseUrl}
              onChange={e => handleSettingChange('proxyBaseUrl', e.target.value)}
              style={{ width: '250px' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '6px' }}>
            <button
              className="btn-accent"
              style={{ padding: '8px 16px', fontSize: '12px' }}
              onClick={handleTestConnection}
              disabled={testingConnection}
            >
              {testingConnection ? '⏳ Проверка соединения...' : '⚡ Проверить подключение'}
            </button>
            {testResult && (
              <span style={{ 
                fontSize: '12px', 
                color: testResult.success ? 'var(--green, #4ade80)' : 'var(--red, #f87171)',
                fontWeight: 500
              }}>
                {testResult.success ? '✅ ' : '❌ '}
                {testResult.message}
              </span>
            )}
          </div>
        </section>

        {/* Application Updates */}
        <section className="settings-section">
          <div className="section-title">🚀 Обновление программы</div>

          <div className="setting-row">
            <div className="setting-label">
              <span>Текущая версия</span>
              <span className="setting-sub">Pero Blitz PRO v{appVersion}</span>
            </div>
            <button
              className="btn-secondary"
              style={{ padding: '8px 16px', fontSize: '12px' }}
              onClick={handleCheckUpdates}
              disabled={checkingUpdate}
            >
              {checkingUpdate ? '⏳ Проверка...' : '🔄 Проверить обновления'}
            </button>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <span>Источник обновлений (GitHub / URL)</span>
              <span className="setting-sub">
                GitHub репозиторий (например, owner/repo или ссылка) или URL сервера
              </span>
            </div>
            <input
              type="text"
              className="input-field"
              placeholder="https://github.com/mopxam-art/001_Sekretar"
              value={settings.updateUrl || ''}
              onChange={e => handleSettingChange('updateUrl', e.target.value)}
              style={{ width: '250px' }}
            />
          </div>

          {updateStatus.type !== 'idle' && (
            <div style={{
              marginTop: '10px',
              padding: '12px 14px',
              borderRadius: '8px',
              background: 'var(--bg-secondary, #1a1a24)',
              border: `1px solid ${
                updateStatus.type === 'error' ? 'var(--red, #f87171)' :
                updateStatus.type === 'not-available' ? 'var(--green, #4ade80)' :
                updateStatus.type === 'available' || updateStatus.type === 'downloaded' ? 'var(--accent, #6366f1)' :
                'var(--border, #333)'
              }`,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                  {updateStatus.message}
                </span>

                {updateStatus.type === 'available' && (
                  <button
                    className="btn-accent"
                    style={{ padding: '6px 14px', fontSize: '12px', whiteSpace: 'nowrap' }}
                    onClick={handleDownloadUpdate}
                  >
                    ⬇️ Скачать обновление
                  </button>
                )}

                {updateStatus.type === 'downloaded' && (
                  <button
                    className="btn-accent"
                    style={{ padding: '6px 14px', fontSize: '12px', background: '#22c55e', whiteSpace: 'nowrap' }}
                    onClick={handleInstallUpdate}
                  >
                    🚀 Перезапустить и обновить
                  </button>
                )}
              </div>

              {updateStatus.type === 'downloading' && (
                <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden', marginTop: '4px' }}>
                  <div style={{
                    width: `${updateStatus.percent || 0}%`,
                    height: '100%',
                    background: 'var(--accent, #6366f1)',
                    transition: 'width 0.2s'
                  }} />
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
