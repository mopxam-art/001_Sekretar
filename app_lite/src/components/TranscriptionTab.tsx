import React, { useState, useRef, useCallback } from 'react';
import type { Transcription } from '../App';
import './TranscriptionTab.css';

const ipc = (window as any).electron?.ipcRenderer;

interface Props {
  transcriptions: Transcription[];
  isRecording: boolean;
  hasApiKey: boolean;
  onGoToSettings: () => void;
}

export default function TranscriptionTab({ transcriptions, isRecording, hasApiKey, onGoToSettings }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleInsert = (text: string) => {
    ipc?.invoke('insert-text', text);
  };

  const handleDelete = (id: string) => {
    // Handled in parent via state — here just visual feedback
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="tab-container">
      {/* Header */}
      <div className="tab-header">
        <h1 className="tab-title">Транскрипция</h1>
        <div className="tab-subtitle">Голосовой ввод в любое приложение</div>
      </div>

      {/* Record button */}
      <div className="record-section">
        {!hasApiKey ? (
          <div className="no-api-banner">
            <span>⚠️</span>
            <div>
              <div className="no-api-title">Нужен Groq API ключ</div>
              <div className="no-api-sub">Перейдите в Настройки и добавьте ключ с <b>console.groq.com</b></div>
            </div>
            <button className="btn-accent" onClick={onGoToSettings}>Настройки →</button>
          </div>
        ) : (
          <div className="record-hint">
            <div className={`record-indicator ${isRecording ? 'active' : ''}`}>
              {isRecording ? (
                <>
                  <span className="rec-pulse" />
                  <span>Запись...</span>
                </>
              ) : (
                <>
                  <span className="mic-icon">🎙</span>
                  <span>Нажмите <kbd>Ctrl+Space</kbd> для записи</span>
                </>
              )}
            </div>
            <div className="record-modes">
              <span className="mode-tag">Toggle: нажать → говорить → нажать</span>
              <span className="mode-sep">·</span>
              <span className="mode-tag">Hold: удерживать пока говоришь</span>
            </div>
          </div>
        )}
      </div>

      {/* Transcription history */}
      <div className="transcriptions-list">
        {transcriptions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎙</div>
            <div className="empty-title">История пуста</div>
            <div className="empty-sub">Начните диктовать — текст появится здесь</div>
          </div>
        ) : (
          transcriptions.map(t => (
            <div key={t.id} className="transcription-card">
              <div className="card-text">{t.text}</div>
              <div className="card-footer">
                <span className="card-time">{formatTime(t.timestamp)}</span>
                <div className="card-actions">
                  <button
                    className={`card-btn ${copiedId === t.id ? 'success' : ''}`}
                    onClick={() => handleCopy(t.text, t.id)}
                    title="Копировать"
                  >
                    {copiedId === t.id ? '✓' : '📋'}
                  </button>
                  <button
                    className="card-btn"
                    onClick={() => handleInsert(t.text)}
                    title="Вставить под курсор"
                  >
                    ⬆️
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
