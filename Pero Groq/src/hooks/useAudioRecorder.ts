import { useEffect, useRef, useState } from 'react';

const ipc = (window as any).electron?.ipcRenderer;

interface UseAudioRecorderProps {
  canRecord: boolean;
  onTranscription?: (text: string, audioCacheId?: string, duration?: number) => void;
}

// Module-level guard: strictly prevents multiple recorders from running concurrently
let isGlobalRecording = false;
let isGlobalProcessing = false;

export function useAudioRecorder({ canRecord, onTranscription }: UseAudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<BlobPart[]>([]);
  const maxDurationTimeout = useRef<NodeJS.Timeout | null>(null);

  const canRecordRef = useRef(canRecord);
  useEffect(() => {
    canRecordRef.current = canRecord;
  }, [canRecord]);

  const onTranscriptionRef = useRef(onTranscription);
  useEffect(() => {
    onTranscriptionRef.current = onTranscription;
  }, [onTranscription]);

  useEffect(() => {
    if (!ipc) return;

    const stopRecording = () => {
      if (maxDurationTimeout.current) {
        clearTimeout(maxDurationTimeout.current);
        maxDurationTimeout.current = null;
      }
      console.log('[useAudioRecorder] Stop recording requested. isGlobalRecording:', isGlobalRecording);
      
      if (!isGlobalRecording) {
        return;
      }

      if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
        try {
          mediaRecorder.current.stop();
        } catch (err) {
          console.error('[useAudioRecorder] Error stopping MediaRecorder:', err);
          isGlobalRecording = false;
          setIsRecording(false);
        }
      } else {
        isGlobalRecording = false;
        setIsRecording(false);
      }
    };

    const startRecording = async () => {
      if (isGlobalRecording || isGlobalProcessing) {
        console.warn('[useAudioRecorder] Blocked: recording or processing already in progress (recording:', isGlobalRecording, 'processing:', isGlobalProcessing, ')');
        return;
      }

      if (!canRecordRef.current) {
        console.warn('[useAudioRecorder] Blocked: Trial expired or no subscription');
        return;
      }

      isGlobalRecording = true;

      try {
        console.log('[useAudioRecorder] Requesting microphone access...');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // If stop was requested while waiting for getUserMedia
        if (!isGlobalRecording) {
          console.log('[useAudioRecorder] Recording was cancelled before stream opened');
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        mediaRecorder.current = recorder;
        audioChunks.current = [];

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunks.current.push(event.data);
          }
        };

        const startTime = Date.now();

        recorder.onerror = (event: any) => {
          console.error('[useAudioRecorder] MediaRecorder error:', event.error || event);
          isGlobalRecording = false;
          setIsRecording(false);
          stream.getTracks().forEach(track => track.stop());
          ipc.send('recording-stopped');
          ipc.send('processing-stopped');
        };

        recorder.onstop = async () => {
          const duration = Math.max(1, Math.round((Date.now() - startTime) / 1000));
          console.log(`[useAudioRecorder] Physical recording ended, duration: ${duration}s. Stopping tracks...`);
          
          isGlobalRecording = false;
          isGlobalProcessing = true;
          setIsRecording(false);

          // Notify main process and overlay that recording finished and processing started
          ipc.send('recording-stopped');
          ipc.send('processing-started');

          try {
            stream.getTracks().forEach(track => track.stop());
            const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm;codecs=opus' });
            const arrayBuffer = await audioBlob.arrayBuffer();

            console.log(`[useAudioRecorder] Audio ready, size: ${arrayBuffer.byteLength} bytes`);

            if (arrayBuffer.byteLength < 500) {
              console.warn('[useAudioRecorder] Audio buffer too small, skipping transcription');
              return;
            }

            // Deduct trial seconds
            if (duration > 0) {
              ipc.invoke('trial:deduct', duration).catch(() => {});
            }

            // 1. Save to cache
            const cacheResult = await ipc.invoke('audio-cache:save', arrayBuffer, { timestamp: Date.now() });
            const cacheId = cacheResult?.success ? cacheResult.id : null;

            // 2. Transcribe via Groq Whisper
            const transcribeResult = await ipc.invoke('groq:transcribe', arrayBuffer, { language: 'ru' });

            if (transcribeResult?.success && transcribeResult.text?.trim()) {
              const text = transcribeResult.text.trim();
              console.log(`[useAudioRecorder] Transcription success: "${text.substring(0, 40)}..."`);

              if (cacheId) {
                await ipc.invoke('audio-cache:mark-success', cacheId, Date.now().toString());
              }

              // 3. Send to history
              if (onTranscriptionRef.current) {
                onTranscriptionRef.current(text, cacheId, duration);
              }

              // 4. Insert text into target window
              await ipc.invoke('insert-text', text);
            } else {
              console.error('[useAudioRecorder] Transcription failed:', transcribeResult?.error);
              if (cacheId) {
                await ipc.invoke('audio-cache:mark-failed', cacheId, transcribeResult?.error);
              }
            }
          } catch (error) {
            console.error('[useAudioRecorder] Error during audio processing:', error);
          } finally {
            isGlobalProcessing = false;
            ipc.send('processing-stopped');
          }
        };

        // Start continuous recording (single clean stream, without chunk slicing)
        recorder.start();
        setIsRecording(true);
        ipc.send('recording-started');
        console.log('[useAudioRecorder] Recording started successfully');

        // Auto-stop after 5 minutes (300,000 ms)
        maxDurationTimeout.current = setTimeout(() => {
          console.log('[useAudioRecorder] Maximum duration reached (5 minutes). Auto-stopping.');
          stopRecording();
        }, 300000);
      } catch (err) {
        console.error('[useAudioRecorder] Failed to start recording:', err);
        isGlobalRecording = false;
        setIsRecording(false);
        ipc.send('recording-stopped');
      }
    };

    const unsubStart = ipc.on('start-recording', startRecording);
    const unsubStop = ipc.on('stop-recording', stopRecording);

    return () => {
      if (typeof unsubStart === 'function') unsubStart();
      if (typeof unsubStop === 'function') unsubStop();
      ipc.removeListener('start-recording', startRecording);
      ipc.removeListener('stop-recording', stopRecording);
    };
  }, []);

  return { isRecording };
}
