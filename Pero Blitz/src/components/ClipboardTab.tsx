import React, { useState, useEffect } from 'react';

const ipc = (window as any).electron?.ipcRenderer;

interface ClipItem { id: string; text?: string; image?: string; timestamp: number; }

export default function ClipboardTab() {
  const [items, setItems] = useState<ClipItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!ipc) return;
    const onText = (_: any, text: string) => {
      if (!text?.trim()) return;
      setItems(prev => [{ id: Date.now().toString(), text, timestamp: Date.now() }, ...prev].slice(0, 50));
    };
    ipc.on('clipboard-text-changed', onText);
    return () => ipc.removeListener?.('clipboard-text-changed', onText);
  }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const fmt = (ts: number) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="tab-container">
      <div className="tab-header">
        <h1 className="tab-title">Буфер обмена</h1>
        <div className="tab-subtitle">История копирований</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', color: 'var(--text-muted)', gap: 10 }}>
            <div style={{ fontSize: 40, opacity: 0.3 }}>📎</div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Буфер пустой</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Скопируйте что-нибудь</div>
          </div>
        ) : items.map(item => (
          <div key={item.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-primary)', userSelect: 'text', marginBottom: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 80, overflow: 'hidden' }}>
              {item.text}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt(item.timestamp)}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button style={{ background: 'transparent', border: '1px solid transparent', borderRadius: 5, padding: '3px 8px', fontSize: 12, color: copiedId === item.id ? 'var(--green)' : 'var(--text-muted)', cursor: 'pointer' }}
                  onClick={() => item.text && handleCopy(item.text, item.id)}>
                  {copiedId === item.id ? '✓' : '📋'}
                </button>
                <button style={{ background: 'transparent', border: '1px solid transparent', borderRadius: 5, padding: '3px 8px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}
                  onClick={() => item.text && ipc?.invoke('insert-text', item.text)}>⬆️</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
