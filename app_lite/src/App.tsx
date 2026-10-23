import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import TranscriptionTab from './components/TranscriptionTab';
import Settings from './components/Settings';
import HelpTab from './components/HelpTab';
import HistoryTab from './components/HistoryTab';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import './styles/App.css';

declare global {
  interface Window {
    electron?: any;
  }
}

const ipc = window.electron?.ipcRenderer;

export type TabId = 'transcription' | 'history' | 'help' | 'settings';

export interface Transcription {
  id: string;
  text: string;
  timestamp: number;
  duration?: number;
  audioCacheId?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('transcription');
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [hasApiKey, setHasApiKey] = useState(false);

  const handleNewTranscription = (text: string, audioCacheId?: string) => {
    if (!text?.trim()) return;
    const t: Transcription = {
      id: Date.now().toString(),
      text: text.trim(),
      timestamp: Date.now(),
      audioCacheId,
    };
    setTranscriptions(prev => [t, ...prev].slice(0, 100));
  };

  const handleDeleteTranscription = (id: string) => {
    setTranscriptions(prev => prev.filter(t => t.id !== id));
  };

  const handleEditTranscription = (id: string, newText: string) => {
    setTranscriptions(prev => prev.map(t => t.id === id ? { ...t, text: newText } : t));
  };

  const { isRecording } = useAudioRecorder({
    onTranscription: handleNewTranscription
  });

  // Проверяем наличие API ключа при старте
  useEffect(() => {
    if (ipc) {
      ipc.invoke('groq:get-status').then((status: any) => {
        setHasApiKey(status?.hasKey || false);
        // Если нет ключа — открываем настройки
        if (!status?.hasKey) {
          setActiveTab('settings');
        }
      }).catch(() => {});

      // Сигнал готовности для deep links
      ipc.send('renderer-ready-for-deeplinks');
    }
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'transcription':
        return <TranscriptionTab transcriptions={transcriptions} isRecording={isRecording} hasApiKey={hasApiKey} onGoToSettings={() => setActiveTab('settings')} />;
      case 'history':
        return <HistoryTab transcriptions={transcriptions} onDelete={handleDeleteTranscription} onEdit={handleEditTranscription} />;
      case 'help':
        return <HelpTab />;
      case 'settings':
        return <Settings onApiKeySaved={() => { setHasApiKey(true); setActiveTab('transcription'); }} />;
      default:
        return null;
    }
  };

  return (
    <div className="app-layout">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} isRecording={isRecording} />
      <main className="app-content">
        {renderContent()}
      </main>
    </div>
  );
}
