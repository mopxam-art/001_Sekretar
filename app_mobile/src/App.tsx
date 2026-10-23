import React, { useState, useEffect, useRef } from 'react';
import { Settings, X, Copy, Check, Feather, Mic } from 'lucide-react';
import localforage from 'localforage';
import './App.css';

// --- Groq Service Logic ---
const GROQ_API_BASE = 'https://api.groq.com';
const WHISPER_MODEL = 'whisper-large-v3-turbo';

async function transcribeAudio(audioBlob: Blob, apiKey: string, baseUrl: string) {
  // Use the provided proxy or default to the local Vite proxy (which avoids CORS and uses PC's network)
  const effectiveBaseUrl = baseUrl || window.location.origin;
  const url = new URL('/openai/v1/audio/transcriptions', effectiveBaseUrl);
  
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', WHISPER_MODEL);
  formData.append('response_format', 'json');
  formData.append('language', 'ru');
  formData.append('prompt', 'Это диктовка. Расставь знаки препинания, точки, запятые и заглавные буквы корректно.');

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    let errorMsg = `Groq API Error ${response.status}`;
    try {
      const errorData = await response.json();
      errorMsg = errorData.error?.message || errorMsg;
    } catch (e) {}
    throw new Error(errorMsg);
  }

  const data = await response.json();
  return data.text;
}

async function cleanupText(text: string, apiKey: string, baseUrl: string) {
  const effectiveBaseUrl = baseUrl || window.location.origin;
  const url = new URL('/openai/v1/chat/completions', effectiveBaseUrl);
  
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: 'Ты помощник для очистки распознанной речи. Убери слова-паразиты, исправь очевидные ошибки распознавания, расставь знаки препинания. Верни ТОЛЬКО исправленный текст без каких-либо пояснений, предисловий и комментариев.'
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.1,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    return text; // fallback to raw text
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || text;
}

// --- Components ---

function App() {
  const [apiKey, setApiKey] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');
  const [aiCleanup, setAiCleanup] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [lastText, setLastText] = useState('');
  const [history, setHistory] = useState<{text: string, timestamp: number}[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Load settings on mount
  useEffect(() => {
    localforage.getItem('sekretar_apiKey').then((val) => {
      if (val) setApiKey(val as string);
    });
    localforage.getItem('sekretar_proxyUrl').then((val) => {
      if (val) setProxyUrl(val as string);
    });
    localforage.getItem('sekretar_aiCleanup').then((val) => {
      if (val !== null) setAiCleanup(val === true || val === 'true');
    });
  }, []);

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    localforage.setItem('sekretar_apiKey', apiKey);
    localforage.setItem('sekretar_proxyUrl', proxyUrl);
    localforage.setItem('sekretar_aiCleanup', aiCleanup);
    setShowSettings(false);
  };

  const startRecording = async () => {
    if (!apiKey) {
      setShowSettings(true);
      return;
    }

    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (timerRef.current) clearInterval(timerRef.current);
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setIsProcessing(true);
        try {
          let text = await transcribeAudio(audioBlob, apiKey, proxyUrl);
          
          if (text && aiCleanup) {
             text = await cleanupText(text, apiKey, proxyUrl);
          }

          if (text) {
            setLastText(text);
            setHistory(prev => [{text, timestamp: Date.now()}, ...prev].slice(0, 50)); // keep last 50
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        } catch (err: any) {
          setError(err.message || 'Failed to transcribe');
        } finally {
          setIsProcessing(false);
          setRecordingTime(0);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err: any) {
      setError('Microphone permission denied');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      // Stop all tracks to release microphone
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
    }
  };

  const handleToggleRecord = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <div className="logo-area">
          <div className="logo-circle">
            <Feather size={18} color="#fff" />
          </div>
          <h1>Перо Блиц Mobile</h1>
        </div>
        <button className="icon-btn" onClick={() => setShowSettings(true)}>
          <Settings size={24} color="#aaa" />
        </button>
      </header>

      {showSettings ? (
        <div className="settings-screen">
          <div className="settings-header">
            <h2>Настройки</h2>
            <button className="icon-btn" onClick={() => setShowSettings(false)}>
              <X size={24} color="#aaa" />
            </button>
          </div>
          
          <div className="settings-body">
            <div className="input-group">
              <label>Groq API Key</label>
              <input 
                type="password" 
                placeholder="gsk_..." 
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="help-text">Ключ от console.groq.com</p>
            </div>

            <div className="input-group">
              <label>Base URL (Reverse Proxy)</label>
              <input 
                type="text" 
                value={proxyUrl} 
                onChange={(e) => setProxyUrl(e.target.value)} 
                placeholder="Оставьте пустым для прокси через ПК"
              />
            </div>
            
            <div className="input-group" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 16, color: 'white', display: 'block' }}>AI-очистка текста</label>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Убирает слова-паразиты, ставит запятые</div>
              </div>
              <label className="switch" style={{ flexShrink: 0 }}>
                <input 
                  type="checkbox" 
                  checked={aiCleanup} 
                  onChange={(e) => setAiCleanup(e.target.checked)} 
                />
                <span className="slider round"></span>
              </label>
            </div>
            <button type="submit" className="primary-btn" onClick={handleSaveSettings}>
              Сохранить
            </button>
          </div>
        </div>
      ) : (
        <div className="main-screen">
          <div className="status-area">
            {error && <div className="error-badge">{error}</div>}
            {isProcessing && <div className="processing-badge">Распознавание...</div>}
            {copied && <div className="success-badge"><Check size={16}/> Скопировано</div>}
          </div>

          <div className="record-container">
            <button 
              className={`record-btn ${isRecording ? 'recording' : ''} ${isProcessing ? 'processing' : ''}`}
              onClick={handleToggleRecord}
              disabled={isProcessing}
            >
              <Feather size={isRecording ? 64 : 48} color={isRecording ? '#fff' : 'rgba(255,255,255,0.8)'} />
            </button>
            <p className="record-hint">
              {isRecording 
                ? `Запись... ${Math.floor(recordingTime / 60).toString().padStart(2, '0')}:${(recordingTime % 60).toString().padStart(2, '0')}` 
                : 'Нажмите чтобы начать'}
            </p>
          </div>

          {(lastText || history.length > 0) && !isRecording && !isProcessing && (
            <div className="result-area">
              <div className="result-header">
                <h3>Последняя фраза</h3>
                <button 
                  className="copy-btn" 
                  onClick={() => {
                    navigator.clipboard.writeText(lastText);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <p className="result-text">{lastText}</p>
              
              {history.length > 1 && (
                <div className="history-section">
                  <h4 className="history-title">История:</h4>
                  <ul className="history-list">
                    {history.slice(1).map((item, index) => (
                      <li key={index} className="history-item">
                        <div className="history-item-content">
                          <span className="history-time">
                            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="history-text">{item.text}</span>
                        </div>
                        <button className="copy-small-btn" onClick={() => navigator.clipboard.writeText(item.text)}>
                          <Copy size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
