import React, { useState, useEffect, useRef } from 'react';
import './Settings.css';

const ipc = (window as any).electron?.ipcRenderer;

interface Props {
  onApiKeySaved?: () => void;
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
  httpProxy: string;
  translateHotkey: string;
  undoHotkey: string;
  meetingHotkey: string;
}

// Отладочный компонент для перехвата любых ошибок рендера внутри Настроек
class ErrorBoundary extends React.Component<{children: React.ReactNode}, { hasError: boolean, error: any }> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  componentDidCatch(error: any, errorInfo: any) { console.error("Settings Render Error:", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return <div style={{padding: '30px', color: '#ff6b6b'}}>
        <h2>Сбой при отображении Настроек</h2>
        <p>Ошибка: {this.state.error?.toString()}</p>
        <button onClick={() => this.setState({hasError: false})} style={{padding: '8px 16px', background: '#333', color: 'white', borderRadius: '8px', marginTop: '10px'}}>Попробовать снова</button>
      </div>;
    }
    return this.props.children;
  }
}

function SettingsContent(props: Props) {
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
    httpProxy: '',
    translateHotkey: 'CommandOrControl+Shift+T',
    undoHotkey: 'CommandOrControl+Shift+Z',
    meetingHotkey: 'CommandOrControl+Shift+M',
  });

  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    if (!ipc) return;
    ipc.invoke('settings:get').then((s: any) => {
      if (s) setSettings(prev => ({ ...prev, ...s }));
    }).catch(() => {});
    
    ipc.invoke('secure-store:is-authenticated').then(setIsSubscribed).catch(() => {});
    
    const electron = (window as any).electronAPI;
    if (electron && electron.onAuthFromDeepLink) {
      electron.onAuthFromDeepLink(async (token: string) => {
        try {
          await ipc.invoke('secure-store:save-tokens', token, null);
          setIsSubscribed(true);
        } catch (err) {}
      });
      if (electron.signalDeepLinkReady) electron.signalDeepLinkReady();
    }
  }, []);

  const [capturingHotkeyFor, setCapturingHotkeyFor] = useState<keyof AppSettings | null>(null);

  useEffect(() => {
    if (!capturingHotkeyFor) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') setCapturingHotkeyFor(null);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return; 
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
      if (key === 'hotkeyMode' || key === 'hotkey') {
        ipc?.invoke('set-hotkey', updated.hotkey || 'CommandOrControl+Alt', updated.hotkeyMode || 'toggle').catch(() => {});
      }
      return updated;
    });
    ipc?.invoke('settings:set', key, value).catch(() => {});
  };

  // Safe variables for rendering
  const safeHotkey = (settings?.hotkey || 'CommandOrControl+Alt').replace('CommandOrControl', 'Ctrl');
  const safeMode = settings?.hotkeyMode || 'toggle';
  const safeLang = settings?.language || 'ru';
  const safeAi = !!settings?.aiCleanup;
  const safePara = !!settings?.useParagraphs;
  const safeDuck = !!settings?.audioDucking;
  const safeOverlay = !!settings?.overlayVisible;
  const safeStart = !!settings?.autostart;

  return (
    <div className="tab-container">
      <div className="tab-header">
        <h1 className="tab-title">Настройки</h1>
        <div className="tab-subtitle">Конфигурация Перо Блиц</div>
      </div>

      <div className="settings-scroll">
        <section className="settings-section">
          <div className="section-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #7c6af7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2" ry="2"/><line x1="6" x2="6.01" y1="8" y2="8"/><line x1="10" x2="10.01" y1="8" y2="8"/><line x1="14" x2="14.01" y1="8" y2="8"/><line x1="18" x2="18.01" y1="8" y2="8"/><line x1="8" x2="8.01" y1="12" y2="12"/><line x1="12" x2="12.01" y1="12" y2="12"/><line x1="16" x2="16.01" y1="12" y2="12"/><line x1="7" x2="17" y1="16" y2="16"/></svg>
            Горячие клавиши
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span>Клавиша записи</span>
              <span className="setting-sub">Текущая: {safeHotkey}</span>
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
              <span className="setting-sub">Нажатие: вкл/выкл · Удержание: пока зажато</span>
            </div>
            <div className="toggle-group">
              {(['toggle', 'hold'] as const).map(m => (
                <button
                  key={m}
                  className={`toggle-btn ${safeMode === m ? 'active' : ''}`}
                  onClick={() => handleSettingChange('hotkeyMode', m)}
                >
                  {m === 'toggle' ? 'Нажатие' : 'Удержание'}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #7c6af7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
            Распознавание речи
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span>Язык распознавания</span>
            </div>
            <div className="custom-select-container" style={{ position: 'relative', width: '200px' }}>
              <div 
                className="select-field custom-select-trigger"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                onClick={(e) => {
                  const el = e.currentTarget.nextElementSibling as HTMLElement;
                  el.style.display = el.style.display === 'block' ? 'none' : 'block';
                  // Simple click outside to close
                  const closeSelect = (evt: MouseEvent) => {
                    if (!e.currentTarget.parentElement?.contains(evt.target as Node)) {
                      el.style.display = 'none';
                      document.removeEventListener('click', closeSelect);
                    }
                  };
                  setTimeout(() => document.addEventListener('click', closeSelect), 10);
                }}
              >
                {safeLang === 'ru' && <span className="flag-icon">🇷🇺</span>}
                {safeLang === 'en' && <span className="flag-icon">🇬🇧</span>}
                {safeLang === 'de' && <span className="flag-icon">🇩🇪</span>}
                {safeLang === 'fr' && <span className="flag-icon">🇫🇷</span>}
                {safeLang === 'es' && <span className="flag-icon">🇪🇸</span>}
                {safeLang === '' && <span className="flag-icon">🌐</span>}
                <span style={{ flex: 1 }}>
                  {safeLang === 'ru' ? 'Русский' : 
                   safeLang === 'en' ? 'English' : 
                   safeLang === 'de' ? 'Deutsch' : 
                   safeLang === 'fr' ? 'Français' : 
                   safeLang === 'es' ? 'Español' : 'Авто-определение'}
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
              <div className="custom-select-dropdown" style={{ 
                display: 'none', position: 'absolute', top: '100%', left: 0, right: 0, 
                background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', 
                borderRadius: '8px', marginTop: '4px', zIndex: 100, overflow: 'hidden',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
              }}>
                {[
                  { id: 'ru', label: 'Русский', flag: '🇷🇺' },
                  { id: 'en', label: 'English', flag: '🇬🇧' },
                  { id: 'de', label: 'Deutsch', flag: '🇩🇪' },
                  { id: 'fr', label: 'Français', flag: '🇫🇷' },
                  { id: 'es', label: 'Español', flag: '🇪🇸' },
                  { id: '', label: 'Авто-определение', flag: '🌐' }
                ].map(opt => (
                  <div 
                    key={opt.id}
                    className="custom-select-option"
                    style={{ 
                      padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px', 
                      cursor: 'pointer', background: safeLang === opt.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                      color: safeLang === opt.id ? '#fff' : '#aaa'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = safeLang === opt.id ? 'rgba(255,255,255,0.1)' : 'transparent'}
                    onClick={(e) => {
                      handleSettingChange('language', opt.id);
                      (e.currentTarget.parentElement as HTMLElement).style.display = 'none';
                    }}
                  >
                    <span className="flag-icon" style={{ 
                      fontFamily: '"Twemoji Mozilla", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", "EmojiOne Color", "Android Emoji", sans-serif'
                    }}>{opt.flag}</span>
                    <span>{opt.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span>AI-очистка текста</span>
              <span className="setting-sub">Убирает слова-паразиты и заминки</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={safeAi}
                onChange={e => handleSettingChange('aiCleanup', e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>

          {safeAi && (
            <div className="setting-row">
              <div className="setting-label">
                <span>Разделение на абзацы</span>
                <span className="setting-sub">Автоматически форматировать длинный текст абзацами</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={safePara}
                  onChange={e => handleSettingChange('useParagraphs', e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          )}
        </section>

        <section className="settings-section">
          <div className="section-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #7c6af7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Система
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span>HTTP/HTTPS Прокси</span>
              <span className="setting-sub">Формат: http://login:pass@ip:port</span>
            </div>
            <input
              type="text"
              style={{ width: '220px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '8px 12px', borderRadius: '8px', outline: 'none', fontSize: '13px' }}
              placeholder="http://..."
              value={settings?.httpProxy || ''}
              onChange={e => handleSettingChange('httpProxy', e.target.value)}
            />
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span>Приглушать звук при записи</span>
              <span className="setting-sub">Audio Ducking — снижает громкость системы до 30%</span>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={safeDuck} onChange={e => handleSettingChange('audioDucking', e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span>Показывать оверлей записи</span>
              <span className="setting-sub">Плавающий индикатор поверх всех окон</span>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={safeOverlay} onChange={e => handleSettingChange('overlayVisible', e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span>Запуск вместе с Windows</span>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={safeStart} onChange={e => handleSettingChange('autostart', e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function Settings(props: Props) {
  return (
    <ErrorBoundary>
      <SettingsContent {...props} />
    </ErrorBoundary>
  );
}
