import React, { useState, useRef, useCallback } from 'react';
import { Copy, TextCursorInput } from 'lucide-react';
import type { Transcription } from '../App';
import './TranscriptionTab.css';

const ipc = (window as any).electron?.ipcRenderer;

interface Props {
  transcriptions: Transcription[];
  isRecording: boolean;
  canRecord: boolean;
  onGoToSettings: () => void;
}

export default function TranscriptionTab({ transcriptions, isRecording, canRecord, onGoToSettings }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [hotkey, setHotkey] = useState('Ctrl+Alt');

  React.useEffect(() => {
    if (ipc) {
      ipc.invoke('settings:get').then((s: any) => {
        if (s && s.hotkey) {
          setHotkey(s.hotkey.replace('CommandOrControl', 'Ctrl'));
        }
      }).catch(() => {});
    }
  }, []);

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
        {!canRecord ? (
          <div className="no-api-banner">
            <span>🔒</span>
            <div>
              <div className="no-api-title">Бесплатные минуты исчерпаны</div>
              <div className="no-api-sub">Оформите подписку PRO для продолжения работы.</div>
            </div>
            <button className="btn-accent" onClick={onGoToSettings}>Купить подписку</button>
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
                  <span>Нажмите <kbd>{hotkey}</kbd> для записи</span>
                </>
              )}
            </div>
            <div className="record-modes">
              <span className="mode-tag">Нажатие: вкл/выкл</span>
              <span className="mode-sep">·</span>
              <span className="mode-tag">Удержание: пока зажато</span>
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
                  <button className="card-icon-btn" title="Вставить под курсор" onClick={() => handleInsert(t.text)}>
                    <TextCursorInput size={16} />
                  </button>
                  <button
                    className={`card-icon-btn ${copiedId === t.id ? 'success' : ''}`}
                    onClick={() => handleCopy(t.text, t.id)}
                    title="Копировать"
                  >
                    <Copy size={16} />
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
