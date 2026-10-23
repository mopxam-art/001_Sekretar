import React, { useState, useRef, useEffect } from 'react';
import type { Transcription } from '../App';
import { Pencil, Copy, Trash2, Check, X, Clipboard } from 'lucide-react';
import './HistoryTab.css';

interface Props {
  transcriptions: Transcription[];
  onDelete?: (id: string) => void;
  onEdit?: (id: string, newText: string) => void;
}

export default function HistoryTab({ transcriptions, onDelete, onEdit }: Props) {
  const ipc = (window as any).electron?.ipcRenderer;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fmt = (ts: number) => {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (e) {
      return '';
    }
  };

  const handleCopy = (t: Transcription) => {
    navigator.clipboard.writeText(t.text).then(() => {
      setCopiedId(t.id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const handleInsert = (text: string) => {
    ipc?.invoke('insert-text', text);
  };

  const handleEditStart = (t: Transcription) => {
    setEditingId(t.id);
    setEditText(t.text);
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }, 50);
  };

  const handleEditSave = (id: string) => {
    if (onEdit && editText.trim()) {
      onEdit(id, editText.trim());
    }
    setEditingId(null);
  };

  const handleEditCancel = () => {
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleEditSave(id);
    if (e.key === 'Escape') handleEditCancel();
  };

  return (
    <div className="tab-container">
      <div className="tab-header">
        <div>
          <h1 className="tab-title">История</h1>
          <div className="tab-subtitle">Все транскрипции сессии</div>
        </div>
        {transcriptions.length > 0 && (
          <span className="history-count">{transcriptions.length}</span>
        )}
      </div>

      <div className="history-list">
        {transcriptions.length === 0 ? (
          <div className="history-empty">
            <div className="history-empty-icon">📋</div>
            <div className="history-empty-title">История пуста</div>
            <div className="history-empty-sub">Начните диктовать — текст появится здесь</div>
          </div>
        ) : (
          transcriptions.map((t) => (
            <div key={t.id} className="history-item">
              <div className="history-item-time">{fmt(t.timestamp)}</div>

              <div className="history-item-body">
                {editingId === t.id ? (
                  <div className="history-edit-mode">
                    <textarea
                      ref={textareaRef}
                      className="history-edit-textarea"
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => handleKeyDown(e, t.id)}
                      rows={3}
                    />
                    <div className="history-edit-actions">
                      <button className="history-edit-save" onClick={() => handleEditSave(t.id)} title="Сохранить (Ctrl+Enter)">
                        <Check size={14} /> Сохранить
                      </button>
                      <button className="history-edit-cancel" onClick={handleEditCancel} title="Отмена (Esc)">
                        <X size={14} /> Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="history-item-text" onDoubleClick={() => handleEditStart(t)}>
                    {t.text}
                  </div>
                )}
              </div>

              {editingId !== t.id && (
                <div className="history-item-actions">
                  <button
                    className="history-action-btn"
                    onClick={() => handleEditStart(t)}
                    title="Редактировать"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className={`history-action-btn ${copiedId === t.id ? 'copied' : ''}`}
                    onClick={() => handleCopy(t)}
                    title="Копировать"
                  >
                    {copiedId === t.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <button
                    className="history-action-btn insert"
                    onClick={() => handleInsert(t.text)}
                    title="Вставить в активное окно"
                  >
                    <Clipboard size={14} />
                  </button>
                  <button
                    className="history-action-btn delete"
                    onClick={() => onDelete?.(t.id)}
                    title="Удалить"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
