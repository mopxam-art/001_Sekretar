import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import TranscriptionTab from './components/TranscriptionTab';
import Settings from './components/Settings';
import HelpTab from './components/HelpTab';
import HistoryTab from './components/HistoryTab';
import StatisticsTab from './components/StatisticsTab';
import ReferralTab from './components/ReferralTab';
import SubscriptionTab from './components/SubscriptionTab';
import OnboardingOverlay from './components/OnboardingOverlay';
import PaywallOverlay from './components/PaywallOverlay';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import './styles/App.css';

declare global {
  interface Window {
    electron?: any;
  }
}

const ipc = window.electron?.ipcRenderer;

export type TabId = 'transcription' | 'statistics' | 'history' | 'help' | 'settings' | 'referral' | 'subscription';

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
  const [statRecords, setStatRecords] = useState<{ timestamp: number; words: number; duration: number; }[]>([]);
  const [canRecord, setCanRecord] = useState(true);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem('pero_onboarding_seen') !== 'true';
  });

  const handleNewTranscription = (text: string, audioCacheId?: string, duration?: number) => {
    if (!text?.trim()) return;
    const t: Transcription = {
      id: Date.now().toString(),
      text: text.trim(),
      timestamp: Date.now(),
      audioCacheId,
      duration,
    };
    setTranscriptions(prev => {
      const next = [t, ...prev].slice(0, 100);
      localStorage.setItem('pero_transcriptions_history', JSON.stringify(next));
      return next;
    });

    const words = text.trim().split(/\s+/).length || 0;
    const newRecord = { timestamp: Date.now(), words, duration: duration || 0 };
    setStatRecords(prev => {
      const next = [...prev, newRecord];
      localStorage.setItem('pero_stats_history', JSON.stringify(next));
      return next;
    });
  };

  const handleDeleteTranscription = (id: string) => {
    setTranscriptions(prev => {
      const next = prev.filter(t => t.id !== id);
      localStorage.setItem('pero_transcriptions_history', JSON.stringify(next));
      return next;
    });
  };

  const handleEditTranscription = (id: string, newText: string) => {
    setTranscriptions(prev => {
      const next = prev.map(t => t.id === id ? { ...t, text: newText } : t);
      localStorage.setItem('pero_transcriptions_history', JSON.stringify(next));
      return next;
    });
  };

  const { isRecording } = useAudioRecorder({
    canRecord,
    onTranscription: handleNewTranscription
  });

  // Проверяем наличие подписки или времени при старте
  useEffect(() => {
    if (ipc) {
      const checkAccess = async () => {
        const electron = (window as any).electronAPI;
        let isSubscribed = await electron?.secureStore?.isAuthenticated();
        if (localStorage.getItem('pero_mock_pro') === 'true') {
          isSubscribed = true;
        }
        
        let localUsedSeconds = 0;
        try {
          const savedStats = localStorage.getItem('pero_stats_history');
          if (savedStats) {
            const parsed = JSON.parse(savedStats);
            localUsedSeconds = parsed.reduce((acc: number, t: any) => acc + (t.duration || 0), 0);
          }
        } catch(e) {}
        
        const localRemainingSeconds = 30 * 60 - localUsedSeconds;
        const backendTrialSeconds = await electron?.trial?.get();
        
        const actualRemaining = Math.min(backendTrialSeconds, localRemainingSeconds);
        
        const canReq = isSubscribed || actualRemaining > 0;
        setCanRecord(canReq);
        
        if (isSubscribed) {
          setShowOnboarding(false);
          setShowPaywall(false);
        } else if (actualRemaining <= 0) {
          setShowPaywall(true);
        } else {
          setShowPaywall(false);
        }
      };
      
      checkAccess();
      
      const interval = setInterval(checkAccess, 5000);

      // Сигнал готовности для deep links
      ipc.send('renderer-ready-for-deeplinks');

      return () => clearInterval(interval);
    }
  }, []);

  // Load persistent stats on startup
  useEffect(() => {
    try {
      const savedStats = localStorage.getItem('pero_stats_history');
      if (savedStats) setStatRecords(JSON.parse(savedStats));
      
      const savedTrans = localStorage.getItem('pero_transcriptions_history');
      if (savedTrans) setTranscriptions(JSON.parse(savedTrans));
    } catch (e) {}
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'transcription':
        return <TranscriptionTab transcriptions={transcriptions} isRecording={isRecording} canRecord={canRecord} onGoToSettings={() => setActiveTab('settings')} />;
      case 'statistics':
        return <StatisticsTab transcriptions={transcriptions} statRecords={statRecords} />;
      case 'history':
        return <HistoryTab transcriptions={transcriptions} onDelete={handleDeleteTranscription} onEdit={handleEditTranscription} />;
      case 'help':
        return <HelpTab />;
      case 'settings':
        return <Settings />;
      case 'referral':
        return <ReferralTab />;
      case 'subscription':
        return <SubscriptionTab />;
      default:
        return null;
    }
  };

  return (
    <div className="app-layout">
      {showOnboarding && <OnboardingOverlay onComplete={() => {
        setShowOnboarding(false);
        localStorage.setItem('pero_onboarding_seen', 'true');
      }} />}
      {showPaywall && !showOnboarding && <PaywallOverlay onSuccess={() => {
        setShowPaywall(false);
        setCanRecord(true);
      }} />}
      <Sidebar 
        activeTab={activeTab} 
        onTabChange={setActiveTab} 
        isRecording={isRecording} 
        onShowOnboarding={() => setShowOnboarding(true)}
        transcriptions={transcriptions}
        statRecords={statRecords}
      />
      <main className="app-content">
        {renderContent()}
      </main>
    </div>
  );
}
