import React, { useState } from 'react';
import './ReferralTab.css';

export default function ReferralTab() {
  const [copied, setCopied] = useState(false);
  const referralCode = "ECHO-83XW7V";

  const handleCopyCode = () => {
    navigator.clipboard.writeText(referralCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`https://t.me/PeroBlitzBot?start=${referralCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTelegramShare = () => {
    const text = encodeURIComponent(`Держи промокод на скидку 50% на первый месяц в Перо Блиц: ${referralCode}`);
    const electron = (window as any).electronAPI;
    if (electron?.openExternal) {
      electron.openExternal(`https://t.me/share/url?url=${text}`);
    } else {
      window.open(`https://t.me/share/url?url=${text}`, '_blank');
    }
  };

  return (
    <div className="tab-container">
      <div className="tab-header">
        <h1 className="tab-title" style={{ textTransform: 'uppercase', fontSize: '18px', color: '#9898ae', letterSpacing: '1px' }}>
          Реферальная программа
        </h1>
      </div>

      <div className="settings-scroll">
        
        {/* Main Invite Card */}
        <section className="ref-card main-card">
          <div className="ref-header">
            <div className="ref-icon purple">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 12 20 22 4 22 4 12"></polyline>
                <rect x="2" y="7" width="20" height="5"></rect>
                <line x1="12" y1="22" x2="12" y2="7"></line>
                <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
                <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
              </svg>
            </div>
            <div className="ref-titles">
              <h3>Пригласить друга</h3>
              <p>Получите 500 бонусных рублей за каждого друга, который оплатит подписку</p>
            </div>
          </div>

          <div className="ref-code-area">
            <div className="ref-code-box">{referralCode}</div>
            <button className="ref-copy-btn" onClick={handleCopyCode} title="Копировать код">
              {copied ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              )}
            </button>
          </div>

          <div className="ref-actions">
            <button className="ref-btn secondary" onClick={handleCopyLink}>
              🔗 Скопировать ссылку
            </button>
            <button className="ref-btn primary" onClick={handleTelegramShare}>
              Telegram
            </button>
          </div>
        </section>

        {/* Statistics Card */}
        <section className="ref-card">
          <div className="ref-stats-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            
            <div className="ref-stat-item">
              <div className="stat-icon-wrap blue">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </div>
              <div className="stat-info">
                <span className="stat-val">0</span>
                <span className="stat-lbl">Приглашено</span>
              </div>
            </div>

            <div className="ref-stat-item">
              <div className="stat-icon-wrap green">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
              </div>
              <div className="stat-info">
                <span className="stat-val">0</span>
                <span className="stat-lbl">Оплатили</span>
              </div>
            </div>

            <div className="ref-stat-item">
              <div className="stat-icon-wrap purple">₽</div>
              <div className="stat-info">
                <span className="stat-val">0</span>
                <span className="stat-lbl">Баланс (руб)</span>
              </div>
            </div>

          </div>
        </section>

        {/* How it works Card */}
        <section className="ref-card instructions">
          <h4>Как это работает:</h4>
          <ol>
            <li>Поделитесь своим кодом или ссылкой с друзьями (без ограничений на количество)</li>
            <li>Друг получает скидку <strong>50%</strong> на свою первую оплату сервиса</li>
            <li>Вы получаете <strong>500 бонусных рублей</strong>, когда друг оплатит подписку</li>
            <li>Накапливайте бонусы и используйте их для полной или частичной оплаты своей подписки!</li>
          </ol>
        </section>

      </div>
    </div>
  );
}
