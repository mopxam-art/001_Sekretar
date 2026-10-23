import React, { useState, useEffect } from 'react';
import './TranslatorTab.css';

const ipc = (window as any).electron?.ipcRenderer;

const LANGUAGES = [
  { code: 'en', label: '🇬🇧 Английский' },
  { code: 'ru', label: '🇷🇺 Русский' },
  { code: 'de', label: '🇩🇪 Немецкий' },
  { code: 'fr', label: '🇫🇷 Французский' },
  { code: 'es', label: '🇪🇸 Испанский' },
  { code: 'zh', label: '🇨🇳 Китайский' },
  { code: 'ar', label: '🇸🇦 Арабский' },
  { code: 'ja', label: '🇯🇵 Японский' },
  { code: 'ko', label: '🇰🇷 Корейский' },
];

export default function TranslatorTab() {
  const [source, setSource] = useState('');
  const [result, setResult] = useState('');
  const [targetLang, setTargetLang] = useState('en');
  const [translating, setTranslating] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleTranslate = async () => {
    if (!source.trim()) return;
    setTranslating(true);
    setResult('');
    try {
      const res = await ipc?.invoke('groq:translate', source.trim(), targetLang);
      if (res?.success) setResult(res.text);
      else setResult('⚠️ Ошибка: ' + (res?.error || 'Неизвестная ошибка'));
    } catch (e: any) {
      setResult('⚠️ ' + e.message);
    }
    setTranslating(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleInsert = () => {
    if (result) ipc?.invoke('insert-text', result);
  };

  return (
    <div className="tab-container">
      <div className="tab-header">
        <h1 className="tab-title">Переводчик</h1>
        <div className="tab-subtitle">Перевод текста через Groq · llama-3.1-8b</div>
      </div>

      <div className="translator-body">
        <div className="translator-top">
          <div className="lang-row">
            <span className="lang-label">Источник</span>
            <select className="select-field" value={targetLang} onChange={e => setTargetLang(e.target.value)}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
          <textarea
            className="translator-input"
            placeholder="Введите текст для перевода..."
            value={source}
            onChange={e => setSource(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleTranslate(); }}
          />
          <div className="translator-actions">
            <span className="hint-text">Ctrl+Enter для перевода</span>
            <button className="btn-accent" onClick={handleTranslate} disabled={translating || !source.trim()}>
              {translating ? '⏳ Перевожу...' : '🌐 Перевести'}
            </button>
          </div>
        </div>

        {result && (
          <div className="translator-result">
            <div className="result-header">
              <span className="result-lang">{LANGUAGES.find(l => l.code === targetLang)?.label}</span>
              <div className="result-btns">
                <button className={`card-btn ${copied ? 'success' : ''}`} onClick={handleCopy}>{copied ? '✓' : '📋'}</button>
                <button className="card-btn" onClick={handleInsert}>⬆️ Вставить</button>
              </div>
            </div>
            <div className="result-text">{result}</div>
          </div>
        )}
      </div>
    </div>
  );
}
