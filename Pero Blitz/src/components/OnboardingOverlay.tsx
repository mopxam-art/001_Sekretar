import React, { useState } from 'react';
import { Mail, MessageCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import './OnboardingOverlay.css';
import featherLogo from '../assets/feather-bg.png';

interface Props {
  onComplete: () => void;
}

export default function OnboardingOverlay({ onComplete }: Props) {
  const [step, setStep] = useState<'method' | 'waiting' | 'success'>('method');
  const [selectedMethod, setSelectedMethod] = useState<'telegram' | 'email' | null>(null);

  const handleSelectMethod = (method: 'telegram' | 'email') => {
    setSelectedMethod(method);
    setStep('waiting');
    
    // Временная заглушка: Имитируем переход на сайт/бота и автоматическое получение токена через 3 секунды
    setTimeout(() => {
      setStep('success');
      setTimeout(() => {
        onComplete();
      }, 1500);
    }, 3000);
  };

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        <div className="onboarding-header">
          <img src={featherLogo} alt="Logo" className="onboarding-logo" />
          <h2 className="onboarding-title">Добро пожаловать в Перо Блиц</h2>
          <p className="onboarding-subtitle">
            Голосовой ввод на базе AI, который работает в любом приложении.
          </p>
        </div>

        {step === 'method' && (
          <div className="onboarding-content">
            <p className="onboarding-instruction">
              Для начала работы выберите удобный способ авторизации. Вы получите <strong>бесплатные 30 минут</strong> для тестирования.
            </p>
            
            <div className="auth-methods">
              <button className="auth-btn telegram" onClick={() => handleSelectMethod('telegram')}>
                <MessageCircle size={20} />
                <span>Продолжить через Telegram</span>
              </button>
              
              <button className="auth-btn email" onClick={() => handleSelectMethod('email')}>
                <Mail size={20} />
                <span>Продолжить по Email</span>
              </button>
            </div>
          </div>
        )}

        {step === 'waiting' && (
          <div className="onboarding-content waiting-state">
            <div className="spinner"></div>
            <h3>Ожидание авторизации...</h3>
            <p className="onboarding-instruction">
              Пожалуйста, завершите регистрацию в открывшемся окне браузера или мессенджера.
              <br/><br/>
              <em>(Демо-режим: авторизация произойдет автоматически через пару секунд)</em>
            </p>
          </div>
        )}

        {step === 'success' && (
          <div className="onboarding-content success-state">
            <CheckCircle2 size={48} color="#4caf50" className="success-icon" />
            <h3>Авторизация успешна!</h3>
            <p className="onboarding-instruction">
              Ваш аккаунт привязан к устройству. Вы получили 30 минут бесплатно!
            </p>
          </div>
        )}
        
        <div className="onboarding-footer">
          Нажимая «Продолжить», вы соглашаетесь с 
          <a href="#" className="onboarding-link"> Условиями использования</a> и 
          <a href="#" className="onboarding-link"> Политикой конфиденциальности</a>.
        </div>
      </div>
    </div>
  );
}
