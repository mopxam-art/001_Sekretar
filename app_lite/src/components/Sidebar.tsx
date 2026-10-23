import React from 'react';
import type { TabId } from '../App';
import featherLogo from '../assets/feather-bg.png';
import './Sidebar.css';

interface Props {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  isRecording: boolean;
}

const navItems: { id: TabId; icon: string; label: string }[] = [
  { id: 'transcription', icon: '🎙', label: 'Главная' },
  { id: 'history',       icon: '📋', label: 'История' },
  { id: 'help',          icon: '❓', label: 'Справка' },
];

export default function Sidebar({ activeTab, onTabChange, isRecording }: Props) {
  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-header">
        <div className="logo-container">
          <img src={featherLogo} className="logo-icon" alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} />
          <span className="logo-text">Перо Блиц</span>
        </div>
        {isRecording && (
          <div className="recording-badge">
            <span className="rec-dot" />
            REC
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map(item => (
          <button
            key={item.id}
            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => onTabChange(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {activeTab === item.id && <span className="nav-indicator" />}
          </button>
        ))}
      </nav>

      {/* Divider */}
      <div className="sidebar-divider" />

      {/* Settings */}
      <button
        className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
        onClick={() => onTabChange('settings')}
      >
        <span className="nav-icon">⚙️</span>
        <span className="nav-label">Настройки</span>
      </button>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-footer-text">Перо Блиц v1.0</div>
        <div className="sidebar-footer-sub">Groq · BYOK</div>
      </div>
    </aside>
  );
}
