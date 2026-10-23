import React, { useRef, useEffect } from 'react';

export default function NotesTab() {
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="tab-container">
      <div className="tab-header">
        <h1 className="tab-title">Заметки</h1>
        <div className="tab-subtitle">Личные заметки — сохраняются локально</div>
      </div>
      <div style={{ flex: 1, padding: '16px 24px 24px', display: 'flex', flexDirection: 'column' }}>
        <textarea
          ref={ref}
          style={{
            flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '14px 16px', fontSize: 14, fontFamily: 'var(--font)',
            color: 'var(--text-primary)', outline: 'none', resize: 'none', lineHeight: 1.6,
          }}
          placeholder="Введите заметки здесь..."
          onChange={e => localStorage.setItem('sekretar_notes', e.target.value)}
          defaultValue={localStorage.getItem('sekretar_notes') || ''}
        />
      </div>
    </div>
  );
}
