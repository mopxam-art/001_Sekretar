import React, { useState, useEffect } from 'react';
import type { Transcription } from '../App';
import TypingSpeedModal from './TypingSpeedModal';
import './StatisticsTab.css';

const ipc = (window as any).electron?.ipcRenderer;

interface Props {
  transcriptions: Transcription[];
  statRecords?: { timestamp: number; words: number; duration: number; }[];
}

export default function StatisticsTab({ transcriptions, statRecords }: Props) {
  const [typingSpeedWPM, setTypingSpeedWPM] = useState(() => {
    const saved = localStorage.getItem('pero_manual_typing_speed');
    return saved ? parseInt(saved, 10) : 45;
  });
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (!ipc) return;
    ipc.invoke('settings:get').then((s: any) => {
      if (s && s.manualTypingSpeed) {
        const localSaved = localStorage.getItem('pero_manual_typing_speed');
        if (s.manualTypingSpeed === 45 && localSaved && localSaved !== '45') {
          // Backend is default, but we have a custom local value. Sync local to backend.
          ipc.invoke('settings:set', 'manualTypingSpeed', parseInt(localSaved, 10)).catch(() => {});
        } else {
          setTypingSpeedWPM(s.manualTypingSpeed);
          localStorage.setItem('pero_manual_typing_speed', s.manualTypingSpeed.toString());
        }
      }
    }).catch(() => {});
  }, []);

  const handleSaveSpeed = (wpm: number) => {
    setTypingSpeedWPM(wpm);
    localStorage.setItem('pero_manual_typing_speed', wpm.toString());
    setIsModalOpen(false);
    if (ipc) {
      ipc.invoke('settings:set', 'manualTypingSpeed', wpm).catch(() => {});
    }
  };

  // Use persistent stats if available, otherwise fallback to active session
  const records = statRecords && statRecords.length > 0 
    ? statRecords 
    : transcriptions.map(t => ({ timestamp: t.timestamp, words: t.text.split(' ').length, duration: t.duration || 0 }));

  const totalWords = records.reduce((acc, t) => acc + (t.words || 0), 0);
  const totalRecords = records.length;
  const totalSeconds = records.reduce((acc, t) => acc + (t.duration || 0), 0);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const remSeconds = totalSeconds % 60;
  const wordsPerMin = totalSeconds > 0 ? Math.round(totalWords / (totalSeconds / 60)) : 0;
  
  const getStats = (periodStart: number) => {
    const pRecords = records.filter(r => r.timestamp >= periodStart);
    const words = pRecords.reduce((acc, r) => acc + (r.words || 0), 0);
    const count = pRecords.length;
    const seconds = pRecords.reduce((acc, r) => acc + (r.duration || 0), 0);
    const minutes = Math.ceil(seconds / 60);
    
    const typingMins = words / typingSpeedWPM;
    const audioMins = seconds / 60;
    const saved = Math.max(0, Math.round(typingMins - audioMins));
    const wpm = seconds > 0 ? Math.round(words / (seconds / 60)) : 0;
    
    return { words, count, minutes, saved, wpm };
  };

  const todayStart = new Date().setHours(0, 0, 0, 0);
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
  const monthStart = todayStart - 29 * 24 * 60 * 60 * 1000;

  const stToday = getStats(todayStart);
  const stWeek = getStats(weekStart);
  const stMonth = getStats(monthStart);
  const stAll = getStats(0);
  
  return (
    <div className="tab-container" style={{ overflowY: 'auto', paddingBottom: '32px' }}>
      <div className="tab-header">
        <h1 className="tab-title">Статистика</h1>
      </div>

      <div className="stats-cards">
        <div className="stat-card">
          <div className="stat-value">{stAll.words}</div>
          <div className="stat-label">слов всего</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stAll.count}</div>
          <div className="stat-label">записей</div>
        </div>
      </div>

      <div className="speed-metrics-row">
        <div className="speed-metric-card">
          <div className="sm-info">
            <span className="sm-label">Средняя скорость диктовки:</span>
            <span className="sm-value">{wordsPerMin} слов/мин</span>
          </div>
        </div>
        <div className="speed-metric-card">
          <div className="sm-info">
            <span className="sm-label">Средняя скорость ручной печати:</span>
            <span className="sm-value">{typingSpeedWPM} слов/мин</span>
          </div>
          <button className="sm-check-btn" onClick={() => setIsModalOpen(true)}>
            Проверить
          </button>
        </div>
      </div>

      <div className="stats-summary-row">
        <div className="stats-time-compact">
          <span className="time-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </span>
          <div className="time-info">
            <div className="time-label">Общее время диктовки за всё время</div>
            <div className="time-value">{totalMinutes} мин {remSeconds} сек</div>
          </div>
        </div>
      </div>

      <div className="stats-periods">
        <div className="period-title">ПО ПЕРИОДАМ</div>
        
        <div className="period-row">
          <div className="period-name">
            <span className="period-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            </span> 
            Сегодня
          </div>
          <div className="period-stats">
            <div className="p-stat"><strong>{stToday.words}</strong><span>слов</span></div>
            <div className="p-stat"><strong>{stToday.count}</strong><span>записей</span></div>
            <div className="p-stat"><strong>{stToday.minutes}</strong><span>мин</span></div>
            <div className="p-stat tooltip-container">
              <strong style={{color: '#4ade80'}}>+{stToday.saved}</strong><span>мин экон.</span>
              <div className="tooltip-content">
                Ваша средняя скорость диктовки: <strong>~{stToday.wpm || 180} слов/мин</strong><br/><br/>
                Средняя скорость печати руками: <strong>{typingSpeedWPM} слов/мин</strong><br/><br/>
                Разница формирует сэкономленное время.
              </div>
            </div>
          </div>
        </div>
        
        <div className="period-row">
          <div className="period-name">
            <span className="period-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
            </span> 
            За неделю
          </div>
          <div className="period-stats">
            <div className="p-stat"><strong>{stWeek.words}</strong><span>слов</span></div>
            <div className="p-stat"><strong>{stWeek.count}</strong><span>записей</span></div>
            <div className="p-stat"><strong>{stWeek.minutes}</strong><span>мин</span></div>
            <div className="p-stat tooltip-container">
              <strong style={{color: '#4ade80'}}>+{stWeek.saved}</strong><span>мин экон.</span>
              <div className="tooltip-content">
                Ваша средняя скорость диктовки: <strong>~{stWeek.wpm || 180} слов/мин</strong><br/><br/>
                Средняя скорость печати руками: <strong>{typingSpeedWPM} слов/мин</strong><br/><br/>
                Разница формирует сэкономленное время.
              </div>
            </div>
          </div>
        </div>

        <div className="period-row">
          <div className="period-name">
            <span className="period-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
            </span> 
            За месяц
          </div>
          <div className="period-stats">
            <div className="p-stat"><strong>{stMonth.words}</strong><span>слов</span></div>
            <div className="p-stat"><strong>{stMonth.count}</strong><span>записей</span></div>
            <div className="p-stat"><strong>{stMonth.minutes}</strong><span>мин</span></div>
            <div className="p-stat tooltip-container">
              <strong style={{color: '#4ade80'}}>+{stMonth.saved}</strong><span>мин экон.</span>
              <div className="tooltip-content">
                Ваша средняя скорость диктовки: <strong>~{stMonth.wpm || 180} слов/мин</strong><br/><br/>
                Средняя скорость печати руками: <strong>{typingSpeedWPM} слов/мин</strong><br/><br/>
                Разница формирует сэкономленное время.
              </div>
            </div>
          </div>
        </div>

        <div className="period-row">
          <div className="period-name">
            <span className="period-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </span> 
            За весь период
          </div>
          <div className="period-stats">
            <div className="p-stat"><strong>{stAll.words}</strong><span>слов</span></div>
            <div className="p-stat"><strong>{stAll.count}</strong><span>записей</span></div>
            <div className="p-stat"><strong>{stAll.minutes}</strong><span>мин</span></div>
            <div className="p-stat tooltip-container">
              <strong style={{color: '#4ade80'}}>+{stAll.saved}</strong><span>мин экон.</span>
              <div className="tooltip-content">
                Ваша средняя скорость диктовки: <strong>~{stAll.wpm || 180} слов/мин</strong><br/><br/>
                Средняя скорость печати руками: <strong>{typingSpeedWPM} слов/мин</strong><br/><br/>
                Разница формирует сэкономленное время.
              </div>
            </div>
          </div>
        </div>
      </div>

      <TypingSpeedModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSave={handleSaveSpeed} 
      />
    </div>
  );
}
