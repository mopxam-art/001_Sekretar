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
  audioDucking: boolean;
  overlayVisible: boolean;
  autostart: boolean;
  proxyBaseUrl: string;
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
  const [settings, setSettings] = useState<AppSettings>({
    hotkey: 'CommandOrControl+Alt',
    hotkeyMode: 'toggle',
    language: 'ru',
    aiCleanup: true,
    useParagraphs: false,
    audioDucking: true,
    overlayVisible: true,
    autostart: false,
    proxyBaseUrl: '',
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
  }, []);

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
      
      const keys: string[] = [];
      if (e.ctrlKey) keys.push('CommandOrControl');
      if (e.altKey) keys.push('Alt');
      if (e.shiftKey) keys.push('Shift');
      if (e.metaKey) keys.push('Super');
      
      if (e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Shift' && e.key !== 'Meta') {
        let key = e.key.toUpperCase();
        if (key === ' ') key = 'Space';
        keys.push(key);
      }
      
      const newHotkey = keys.join('+');
      if (keys.length > 0 && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Shift' && e.key !== 'Meta') {
        handleSettingChange(capturingHotkeyFor, newHotkey);
        setCapturingHotkeyFor(null);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
          <div className="section-title">🔑 API Ключ</div>
          <div className="section-desc">
            Мы транскрибируем, разбираем и вставляем текст в любое место, где находится курсор в моменте.
          </div>

          {keyPreview && (
            <div className="key-status">
              <span className="key-dot ok" />
              <span>Ключ установлен: <code>{keyPreview}</code></span>
            </div>
          )}

          <div className="key-input-row">
            <input
              type="password"
              className="input-field"
              placeholder="gsk_..."
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveKey()}
            />
            <button
              className={`btn-accent ${saving ? 'loading' : ''} ${saveResult === 'ok' ? 'success' : ''} ${saveResult === 'error' ? 'error' : ''}`}
              onClick={handleSaveKey}
              disabled={saving || !apiKey.trim()}
            >
              {saving ? '⏳' : saveResult === 'ok' ? '✓ Сохранён' : saveResult === 'error' ? '✗ Ошибка' : 'Сохранить'}
            </button>
          </div>
          {saveResult === 'error' && <div className="error-msg">{saveError}</div>}
        </section>

        {/* Hotkey */}
        <section className="settings-section">
          <div className="section-title">⌨️ Горячие клавиши</div>
          <div className="setting-row">
            <div className="setting-label">
              <span>Клавиша записи</span>
              <span className="setting-sub">Текущая: {settings.hotkey.replace('CommandOrControl', 'Ctrl')}</span>
            </div>
            {capturingHotkeyFor === 'hotkey' ? (
              <button className="hotkey-badge active" onClick={() => setCapturingHotkeyFor(null)}>Нажмите клавиши (Esc для отмены)...</button>
            ) : (
              <button className="hotkey-badge btn-accent" style={{padding: '6px 12px', fontSize: '13px'}} onClick={() => setCapturingHotkeyFor('hotkey')}>Изменить комбинацию</button>
            )}
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span>Режим записи</span>
              <span className="setting-sub">Toggle: 2 нажатия · Hold: удерживать</span>
            </div>
            <div className="toggle-group">
              {(['toggle', 'hold'] as const).map(m => (
                <button
                  key={m}
                  className={`toggle-btn ${settings.hotkeyMode === m ? 'active' : ''}`}
                  onClick={() => handleSettingChange('hotkeyMode', m)}
                >
                  {m === 'toggle' ? 'Toggle' : 'Hold'}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* STT Settings */}
        <section className="settings-section">
          <div className="section-title">🎙 Распознавание речи</div>
          <div className="setting-row">
            <div className="setting-label">
              <span>Язык распознавания</span>
              <span className="setting-sub">Whisper large-v3-turbo</span>
            </div>
            <select
              className="select-field"
              value={settings.language}
              onChange={e => handleSettingChange('language', e.target.value)}
            >
              <option value="ru">🇷🇺 Русский</option>
              <option value="en">🇬🇧 English</option>
              <option value="de">🇩🇪 Deutsch</option>
              <option value="fr">🇫🇷 Français</option>
              <option value="es">🇪🇸 Español</option>
              <option value="">🌐 Авто-определение</option>
            </select>
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span>AI-очистка текста</span>
              <span className="setting-sub">Убирает слова-паразиты и заминки</span>
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
          <div className="setting-row">
            <div className="setting-label">
              <span>Base URL (Reverse Proxy)</span>
              <span className="setting-sub">Для обхода блокировок без VPN (оставьте пустым для стандарта)</span>
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
        </section>
      </div>
    </div>
  );
}
