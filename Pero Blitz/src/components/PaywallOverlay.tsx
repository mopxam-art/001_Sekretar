import React from 'react';
import './PaywallOverlay.css';
import './SubscriptionTab.css'; // For pricing cards
import featherLogo from '../assets/feather-bg.png';

export default function PaywallOverlay({ onSuccess }: { onSuccess?: () => void }) {
  const [isSimulating, setIsSimulating] = React.useState(false);
  const [savedMinutes, setSavedMinutes] = React.useState(0);

  React.useEffect(() => {
    try {
      const savedStats = localStorage.getItem('pero_stats_history');
      if (savedStats) {
        const parsed = JSON.parse(savedStats);
        const totalWords = parsed.reduce((acc: number, t: any) => acc + (t.words || 0), 0);
        const totalDurationSec = parsed.reduce((acc: number, t: any) => acc + (t.duration || 0), 0);
        const typingSpeed = parseInt(localStorage.getItem('pero_manual_typing_speed') || '40', 10);
        
        const typingTime = Math.round(totalWords / typingSpeed);
        const speakingTime = Math.round(totalDurationSec / 60);
        setSavedMinutes(Math.max(0, typingTime - speakingTime));
      }
    } catch(e) {}
  }, []);

  const handleMockPayment = (months: number) => {
    setIsSimulating(true);
    setTimeout(async () => {
      localStorage.setItem('pero_sub_months', months.toString());
      localStorage.setItem('pero_sub_date', Date.now().toString());
      localStorage.setItem('pero_mock_pro', 'true');
      
      const ipc = (window as any).electron?.ipcRenderer;
      if (ipc) {
        const res = await ipc.invoke('secure-store:save-tokens', 'mock_pro_token_123', '');
        if (res && res.success === false) {
          console.error('Failed to save token:', res.error);
        }
        alert('Поздравляем! Тариф Про успешно подключен.');
      }
      setIsSimulating(false);
      if (onSuccess) onSuccess();
    }, 1500);
  };

  return (
    <div className="paywall-overlay">
      <div className="paywall-modal">
        <div className="paywall-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#7c6af7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <h2 className="paywall-title">Время вышло</h2>
        <p className="paywall-subtitle" style={{ marginBottom: '16px' }}>
          Вы израсходовали бесплатные 30 минут.
        </p>
        <div style={{ border: '2px dashed rgba(167, 139, 250, 0.4)', borderRadius: '8px', padding: '12px', marginBottom: '20px', background: 'rgba(167, 139, 250, 0.05)' }}>
          <span style={{ fontSize: '15px', color: '#e2e8f0' }}>Сэкономлено минут жизни: <strong style={{ color: '#4ade80', fontSize: '18px' }}>{savedMinutes}</strong></span>
        </div>
        <p className="paywall-subtitle" style={{ marginBottom: '24px' }}>
          Чтобы продолжить использовать <span style={{ color: '#a78bfa', fontWeight: 'bold', textShadow: '0 0 10px rgba(167,139,250,0.5)', whiteSpace: 'nowrap' }}><img src={featherLogo} alt="" style={{ width: '1.2em', height: '1.2em', verticalAlign: 'text-bottom', marginRight: '4px' }} />Перо Блиц</span> без ограничений, перейдите на тариф Про.
        </p>
        <div className="pricing-cards" style={{ width: '100%', marginTop: '10px' }}>
          {/* Card 1: 1 Month */}
          <div className="pricing-card basic" style={{ textAlign: 'left' }}>
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
            <button 
              className="renew-button"
              disabled={isSimulating}
              onClick={() => handleMockPayment(1)}
            >
              ОФОРМИТЬ
            </button>
          </div>

          {/* Card 2: 6 Months */}
          <div className="pricing-card premium" style={{ textAlign: 'left' }}>
            <div className="pricing-badge">-25%</div>
            <div className="pricing-header">
              <span className="pricing-duration">6 месяцев</span>
            </div>
            <div className="pricing-price">
              <span className="price-value">743</span>
              <span className="price-currency">руб/мес</span>
            </div>
            <div className="pricing-savings">Экономия 1485 руб</div>
            <div className="pricing-features">
              <div className="feature-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span>Максимальная выгода</span>
              </div>
            </div>
            <button 
              className="renew-button highlight"
              disabled={isSimulating}
              onClick={() => handleMockPayment(6)}
            >
              {isSimulating ? 'Оплата...' : 'ОФОРМИТЬ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
