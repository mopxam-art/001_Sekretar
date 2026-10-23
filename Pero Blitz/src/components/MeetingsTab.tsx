import React, { useState, useEffect } from 'react';

const ipc = (window as any).electron?.ipcRenderer;

interface Meeting {
  id: string;
  platform: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  transcript?: string;
}

export default function MeetingsTab() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);

  useEffect(() => {
    if (!ipc) return;
    const onDetected = (_: any, info: any) => {
      const m: Meeting = { id: Date.now().toString(), platform: info.platform, title: info.title, startedAt: Date.now() };
      setActiveMeeting(m);
    };
    const onEnded = (_: any, info: any) => {
      setActiveMeeting(prev => {
        if (prev) setMeetings(old => [{ ...prev, endedAt: Date.now() }, ...old]);
        return null;
      });
    };
    ipc.on('meeting-detected', onDetected);
    ipc.on('meeting-ended', onEnded);
    return () => { ipc.removeListener?.('meeting-detected', onDetected); ipc.removeListener?.('meeting-ended', onEnded); };
  }, []);

  const fmtDuration = (s: number, e?: number) => {
    const ms = (e || Date.now()) - s;
    const m = Math.floor(ms / 60000); const sec = Math.floor((ms % 60000) / 1000);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="tab-container">
      <div className="tab-header">
        <h1 className="tab-title">Встречи</h1>
        <div className="tab-subtitle">Zoom, Teams, Телемост, СберJazz и другие</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {activeMeeting && (
          <div style={{ background: 'rgba(124,106,247,0.1)', border: '1px solid rgba(124,106,247,0.3)', borderRadius: 10, padding: '14px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 22 }}>🎥</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: 'var(--accent-hover)', fontSize: 13 }}>{activeMeeting.platform} — активная встреча</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{activeMeeting.title}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDuration(activeMeeting.startedAt)}</div>
          </div>
        )}
        {meetings.length === 0 && !activeMeeting ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', color: 'var(--text-muted)', gap: 10 }}>
            <div style={{ fontSize: 40, opacity: 0.3 }}>🎥</div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Нет записанных встреч</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Перо Блиц автоматически обнаружит Zoom, Телемост и другие</div>
          </div>
        ) : meetings.map(m => (
          <div key={m.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '12px 14px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 500, fontSize: 13 }}>{m.platform}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDuration(m.startedAt, m.endedAt)}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{m.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
