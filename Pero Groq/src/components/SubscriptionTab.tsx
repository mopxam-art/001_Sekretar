import React, { useState, useEffect } from 'react';
import './SubscriptionTab.css';

export default function SubscriptionTab() {
  const [isSubscribed, setIsSubscribed] = useState(() => localStorage.getItem('pero_mock_pro') === 'true');

  useEffect(() => {
    const fetchAuth = async () => {
      const electron = (window as any).electronAPI;
      if (electron?.secureStore) {
        const auth = await electron.secureStore.isAuthenticated();
        setIsSubscribed(auth || localStorage.getItem('pero_mock_pro') === 'true');
      }
    };
    fetchAuth();
    const interval = setInterval(fetchAuth, 5000);
    return () => clearInterval(interval);
  }, []);

  const handlePurchase = (months: number) => {
    localStorage.setItem('pero_sub_months', months.toString());
    localStorage.setItem('pero_sub_date', Date.now().toString());
    localStorage.setItem('pero_mock_pro', 'true');
    
    // Simulate payment like in PaywallOverlay
    const ipc = (window as any).electron?.ipcRenderer;
    if (ipc) {
      ipc.invoke('secure-store:save-tokens', 'mock_pro_token_123', '').then(() => {
        setIsSubscribed(true);
        alert('Поздравляем! Тариф Про успешно подключен.');
      });
    }
  };

  // Вычисляем дату окончания подписки
  const savedMonths = parseInt(localStorage.getItem('pero_sub_months') || '1', 10);
  const savedDate = parseInt(localStorage.getItem('pero_sub_date') || Date.now().toString(), 10);
  const activeUntil = new Date(savedDate + savedMonths * 30 * 24 * 60 * 60 * 1000);

  return (
    <div className="subscription-tab">
      <div className="subscription-header-area">
        <h2 className="tab-title">Управление подпиской</h2>
        <p className="tab-subtitle">Выберите подходящий план и пользуйтесь программой без ограничений</p>
      </div>
      
      <div className="subscription-card">
        <div className="subscription-status-header">
          <div className="status-info">
            <h3 className="status-title">Текущий тариф</h3>
            <div className={`status-badge ${isSubscribed ? 'pro' : 'free'}`}>
              {isSubscribed ? 'Тариф Про' : 'Бесплатный'}
            </div>
          </div>
          {isSubscribed && (
            <div className="active-until">
              <span className="active-label">Актуально до:</span>
              <strong className="active-date">{activeUntil.toLocaleDateString('ru-RU')}</strong>
            </div>
          )}
        </div>

        <div className="subscription-divider" />

        <div className="subscription-offers">
          <h4 className="offers-title">Продлить / Улучшить тариф</h4>
          <p className="offers-desc">Выберите удобный план, чтобы использовать Перо Блиц с максимальной выгодой.</p>
          
          <div className="pricing-cards">
            {/* Card 1: 1 Month */}
            <div className="pricing-card basic">
              <div className="pricing-header">
                <span className="pricing-duration">1 месяц</span>
              </div>
              <div className="pricing-price">
                <span className="price-value">990</span>
                <span className="price-currency">руб/мес</span>
              </div>
              <div className="pricing-features">
                <div className="feature-item">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  <span>Полный доступ</span>
                </div>
              </div>
              <button className="renew-button" onClick={() => handlePurchase(1)}>
                {isSubscribed ? 'ПРОДЛИТЬ' : 'ОФОРМИТЬ'}
              </button>
            </div>

            {/* Card 2: 6 Months */}
            <div className="pricing-card premium">
              <div className="pricing-badge">-25%</div>
              <div className="pricing-header">
                <span className="pricing-duration">6 месяцев</span>
              </div>
              <div className="pricing-price">
                <span className="price-value">742.5</span>
                <span className="price-currency">руб/мес</span>
              </div>
              <div className="pricing-savings">Экономия 1485 руб</div>
              <div className="pricing-features">
                <div className="feature-item">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  <span>Максимальная выгода</span>
                </div>
              </div>
              <button className="renew-button highlight" onClick={() => handlePurchase(6)}>
                {isSubscribed ? 'ПРОДЛИТЬ' : 'ОФОРМИТЬ'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
