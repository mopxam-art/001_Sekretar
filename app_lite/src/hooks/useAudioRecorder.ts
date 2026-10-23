import { useEffect, useRef, useState } from 'react';

const ipc = (window as any).electron?.ipcRenderer;

interface UseAudioRecorderProps {
  onTranscription?: (text: string, audioCacheId?: string) => void;
}

export function useAudioRecorder({ onTranscription }: UseAudioRecorderProps = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<BlobPart[]>([]);
  const maxDurationTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!ipc) return;

    const startRecording = async () => {
      try {
        console.log('[useAudioRecorder] Requesting microphone access...');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        mediaRecorder.current = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        audioChunks.current = [];

        mediaRecorder.current.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.current.push(event.data);
          }
        };

        mediaRecorder.current.onstop = async () => {
          stream.getTracks().forEach(track => track.stop());
          const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm;codecs=opus' });
          const arrayBuffer = await audioBlob.arrayBuffer();
          
          try {
            console.log('[useAudioRecorder] Audio recorded, size:', arrayBuffer.byteLength);
            
            // 1. Save to cache
            const cacheResult = await ipc.invoke('audio-cache:save', arrayBuffer, { timestamp: Date.now() });
            const cacheId = cacheResult?.success ? cacheResult.id : null;
            
            // 2. Transcribe
            const transcribeResult = await ipc.invoke('groq:transcribe', arrayBuffer, { language: 'ru' });
            
            if (transcribeResult?.success) {
              const text = transcribeResult.text;
              
              if (cacheId) {
                await ipc.invoke('audio-cache:mark-success', cacheId, Date.now().toString());
              }
              
              // 3. Send to history
              if (onTranscription) {
                onTranscription(text, cacheId);
              }
              
              // 4. Insert text
              await ipc.invoke('insert-text', text);
            } else {
              console.error('[useAudioRecorder] Transcription failed:', transcribeResult?.error);
              if (cacheId) {
                await ipc.invoke('audio-cache:mark-failed', cacheId, transcribeResult?.error);
              }
            }
          } catch (error) {
            console.error('[useAudioRecorder] Error during processing:', error);
          } finally {
            setIsRecording(false);
          }
        };

        mediaRecorder.current.start();
        setIsRecording(true);
        console.log('[useAudioRecorder] Recording started');
        
        // Auto-stop after 5 minutes (300,000 ms)
        maxDurationTimeout.current = setTimeout(() => {
          console.log('[useAudioRecorder] Maximum duration reached (5 minutes). Auto-stopping.');
          stopRecording();
        }, 300000);
      } catch (err) {
        console.error('[useAudioRecorder] Failed to start recording:', err);
        setIsRecording(false);
      }
    };

    const stopRecording = () => {
      if (maxDurationTimeout.current) {
        clearTimeout(maxDurationTimeout.current);
        maxDurationTimeout.current = null;
      }
      console.log('[useAudioRecorder] Stopping recording...');
      if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
        mediaRecorder.current.stop();
      }
    };

    ipc.on('start-recording', startRecording);
    ipc.on('stop-recording', stopRecording);

    return () => {
      ipc.removeListener('start-recording', startRecording);
      ipc.removeListener('stop-recording', stopRecording);
    };
  }, []);

  return { isRecording };
}
