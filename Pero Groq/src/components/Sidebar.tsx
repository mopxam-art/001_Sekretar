import React from 'react';
import type { TabId, Transcription } from '../App';
import featherLogo from '../assets/feather-bg.png';
import './Sidebar.css';

interface Props {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  isRecording: boolean;
  onShowOnboarding?: () => void;
  transcriptions?: Transcription[];
  statRecords?: { timestamp: number; words: number; duration: number; }[];
}

const navItems: { id: TabId; icon: React.ReactNode; label: string }[] = [
  { id: 'transcription', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>, label: 'Главная' },
  { id: 'statistics',    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>, label: 'Статистика' },
  { id: 'history',       icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>, label: 'История' },
  { id: 'subscription',  icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>, label: 'Подписка' },
  { id: 'settings',      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>, label: 'Настройки' },
];

export default function Sidebar({ activeTab, onTabChange, isRecording, onShowOnboarding, transcriptions = [], statRecords = [] }: Props) {
  const [trialSeconds, setTrialSeconds] = React.useState<number>(2700);
  const [isSubscribed, setIsSubscribed] = React.useState(false);

  React.useEffect(() => {
    const electron = (window as any).electronAPI;
    const fetchTrial = () => {
      electron?.trial?.get().then((sec: number) => setTrialSeconds(sec));
      electron?.secureStore?.isAuthenticated().then((val: boolean) => {
        setIsSubscribed(val || localStorage.getItem('pero_mock_pro') === 'true');
      });
    };
    
    fetchTrial();
    
    // Refresh trial balance periodically
    const interval = setInterval(fetchTrial, 5000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-header">
        <div className="logo-container">
          <img src={featherLogo} className="logo-icon" alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} />
          <span className="logo-text">Перо Блиц</span>
        </div>
        {isRecording && (
          <div className="recording-badge">
            <span className="rec-dot" />
            REC
          </div>
        )}
      </div>

      <div className="sidebar-scroll-content">
        {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map(item => (
          <button
            key={item.id}
            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => onTabChange(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {activeTab === item.id && <span className="nav-indicator" />}
          </button>
        ))}
      </nav>

      {/* Divider */}
      <div className="sidebar-divider" />

      {/* Help & Referral Link */}
      <div className="sidebar-help-section" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button
          className={`nav-item help-item ${activeTab === 'referral' ? 'active' : ''}`}
          onClick={() => onTabChange('referral')}
        >
          <div className="help-icon" style={{ background: 'rgba(124, 106, 247, 0.15)', color: '#7c6af7' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 12 20 22 4 22 4 12"></polyline>
              <rect x="2" y="7" width="20" height="5"></rect>
              <line x1="12" y1="22" x2="12" y2="7"></line>
              <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
              <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
            </svg>
          </div>
          <div className="help-text-block">
            <span className="help-label">Пригласи друга</span>
            <span className="help-sub">Реферальная программа</span>
          </div>
        </button>

        <button
          className={`nav-item help-item ${activeTab === 'help' ? 'active' : ''}`}
          onClick={() => onTabChange('help')}
        >
          <div className="help-icon" style={{ background: 'rgba(74, 222, 128, 0.15)', color: '#4ade80' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </div>
          <div className="help-text-block">
            <span className="help-label">Как пользоваться?</span>
            <span className="help-sub">Инструкция по функциям</span>
          </div>
        </button>
      </div>

      <div style={{flexGrow: 1}} />

      {/* User Profile */}
      <div 
        className="user-profile-block" 
        style={{ cursor: 'pointer' }}
        onClick={() => onShowOnboarding ? onShowOnboarding() : onTabChange('settings')}
        title="Нажмите для авторизации"
      >
        <div className="user-avatar">
          {/* Avatar Icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div className="user-info">
          <div className="user-name">Пользователь</div>
          <div className="user-email">Нажмите для входа</div>
        </div>
      </div>

      {/* Trial / Subscription Status */}
      <div className="tariff-block">
        <div className="tariff-header">
          <span className="tariff-label">Тариф</span>
          <span className="tariff-value">{isSubscribed ? 'Про' : 'Бесплатный'}</span>
        </div>
        
        {!isSubscribed ? (
          <>
            <div className="tariff-minutes-header">
              <span className="tariff-minutes-label">Минуты</span>
              <span className="tariff-minutes-value">
                {Math.max(0, 30 - Math.ceil((statRecords.length > 0 ? statRecords : transcriptions).reduce((acc, t) => acc + (t.duration || 0), 0) / 60))} / 30
              </span>
            </div>
            <div className="tariff-progress-bg">
              <div 
                className="tariff-progress-fill" 
                style={{ width: `${Math.max(0, Math.min(100, ( (30 * 60 - (statRecords.length > 0 ? statRecords : transcriptions).reduce((acc, t) => acc + (t.duration || 0), 0)) / (30 * 60) ) * 100))}%` }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="tariff-minutes-header">
              <span className="tariff-minutes-label">Активен до:</span>
              <span className="tariff-minutes-value">
                {(() => {
                  const savedMonths = parseInt(localStorage.getItem('pero_sub_months') || '1', 10);
                  const savedDate = parseInt(localStorage.getItem('pero_sub_date') || Date.now().toString(), 10);
                  return new Date(savedDate + savedMonths * 30 * 24 * 60 * 60 * 1000).toLocaleDateString('ru-RU');
                })()}
              </span>
            </div>
            <div className="tariff-progress-bg">
              <div 
                className="tariff-progress-fill" 
                style={{ width: '100%', background: 'linear-gradient(90deg, #4ade80, #22c55e)' }}
              />
            </div>
          </>
        )}
      </div>

      {!isSubscribed && (
        <div className="sidebar-footer">
          <button 
            className="upgrade-btn"
            onClick={() => onTabChange('subscription')}
          >
            Обновить тариф
          </button>
        </div>
      )}
      </div>
    </aside>
  );
}
