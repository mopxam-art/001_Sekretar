// ============================================================
// LIVE ASSISTANT SIDEBAR - CLIENT SCRIPT
// Real-time transcription + AI suggestions
// ============================================================

// Try to load marked for markdown
let marked;
try {
    marked = window.require ? window.require('marked').marked : null;
    if (marked) {
        marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false });
        console.log('✅ Markdown support enabled');
    }
} catch (err) {
    console.warn('⚠️ Markdown not available');
    marked = null;
}

// ============================================================
// DOM ELEMENTS
// ============================================================

const timer = document.getElementById('timer');
const platform = document.getElementById('platform');
const minimizeBtn = document.getElementById('minimizeBtn');
const finishBtn = document.getElementById('finishBtn');
const speakerInfo = document.getElementById('speakerInfo');
const speakerName = document.getElementById('speakerName');
const speakerRole = document.getElementById('speakerRole');
const speakerAvatar = document.getElementById('speakerAvatar');
const transcriptArea = document.getElementById('transcriptArea');
const emptyState = document.getElementById('emptyState');
const messages = document.getElementById('messages');
const inputField = document.getElementById('inputField');
const sendBtn = document.getElementById('sendBtn');

// ============================================================
// STATE
// ============================================================

let recordingTime = 0;
let timerInterval = null;
let fullTranscript = '';
let currentInterimElement = null;
let lastFinalText = '';

// WebSocket state
let ws = null;
let wsAI = null;
let audioContext = null;
let audioStream = null;
let systemAudioStream = null;
let audioProcessor = null;
let isReadyToStream = false;

// AI state
let lastSuggestionTime = 0;
let suggestionTimeout = null;
let lastTranscriptTime = 0;
const PAUSE_THRESHOLD = 2000;
const MIN_TRANSCRIPT_LENGTH = 10;

// Mute state (when dictation is active)
let isMuted = false;

// Speaker state
let speakerNames = { 0: "Вы" };

// API Configuration
let API_BASE_URL = 'http://localhost:4000';
let WS_BASE_URL = 'ws://localhost:4000';

// ============================================================
// TIMER
// ============================================================

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function startTimer() {
    recordingTime = 0;
    timerInterval = setInterval(() => {
        recordingTime++;
        timer.textContent = formatTime(recordingTime);
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// ============================================================
// UI HELPERS
// ============================================================

function hideEmptyState() {
    if (emptyState) {
        emptyState.style.display = 'none';
    }
}

function addMessage(text, type = 'user', speakerLabel = null) {
    hideEmptyState();

    const messageDiv = document.createElement('div');
    messageDiv.className = `message message-${type}`;

    const label = speakerLabel || (type === 'user' ? 'Вы' : 'AI');
    const renderedText = type === 'ai' && marked ? marked.parse(text) : text;

    messageDiv.innerHTML = `
        <div class="message-label">${label}</div>
        <div class="message-text">${renderedText}</div>
    `;

    messages.appendChild(messageDiv);
    messages.scrollTop = messages.scrollHeight;

    return messageDiv;
}

function updateInterimText(text) {
    if (!text || !text.trim()) {
        if (currentInterimElement) {
            currentInterimElement.remove();
            currentInterimElement = null;
        }
        return;
    }

    hideEmptyState();

    if (!currentInterimElement) {
        currentInterimElement = document.createElement('div');
        currentInterimElement.className = 'message message-interim';
        messages.appendChild(currentInterimElement);
    }

    currentInterimElement.textContent = text + '...';
    messages.scrollTop = messages.scrollHeight;
}

function showThinkingIndicator() {
    const existing = messages.querySelector('.message-thinking');
    if (existing) return;

    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'message-thinking';
    thinkingDiv.innerHTML = `
        <div class="thinking-dot"></div>
        <div class="thinking-dot"></div>
        <div class="thinking-dot"></div>
    `;
    messages.appendChild(thinkingDiv);
    messages.scrollTop = messages.scrollHeight;
}

function hideThinkingIndicator() {
    const thinking = messages.querySelector('.message-thinking');
    if (thinking) thinking.remove();
}


function updateSpeakerInfo(name, role = '') {
    if (name && name !== 'Вы') {
        speakerInfo.style.display = 'flex';
        speakerName.textContent = name;
        speakerRole.textContent = role;
        speakerAvatar.textContent = name.charAt(0).toUpperCase();
    }
}

// ============================================================
// TRANSCRIPT HANDLING
// ============================================================

function getSpeakerName(speakerId) {
    if (speakerId === null || speakerId === undefined) return null;
    return speakerNames[speakerId] || `Спикер ${speakerId}`;
}

function updateTranscript(text, isInterim = false, speakerId = null) {
    if (isInterim) {
        const speakerName = getSpeakerName(speakerId);
        const displayText = speakerName ? `${speakerName}: ${text}` : text;
        updateInterimText(displayText);
    } else {
        if (!text || !text.trim()) return;
        if (text === lastFinalText) return;

        lastFinalText = text;

        if (currentInterimElement) {
            currentInterimElement.remove();
            currentInterimElement = null;
        }

        const speakerName = getSpeakerName(speakerId);
        const textWithSpeaker = speakerName ? `${speakerName}: ${text}` : text;

        fullTranscript = fullTranscript ? fullTranscript + ' ' + textWithSpeaker : textWithSpeaker;

        addMessage(text, 'user', speakerName);
        checkForSuggestionNeed(text);

        // Update speaker info if we have a name
        if (speakerName && speakerName !== 'Вы') {
            updateSpeakerInfo(speakerName);
        }
    }
}

// ============================================================
// AI SUGGESTIONS
// ============================================================

function checkForSuggestionNeed(lastUtterance) {
    lastTranscriptTime = Date.now();

    // Check for explicit question
    const hasQuestionMark = lastUtterance.includes('?');
    const questionWords = ['что', 'где', 'когда', 'почему', 'как', 'какой', 'можно', 'можете', 'скажи', 'расскажи'];
    const hasQuestionWord = questionWords.some(word => lastUtterance.toLowerCase().includes(word));

    if (hasQuestionMark || hasQuestionWord) {
        console.log('❓ Question detected, requesting AI immediately');
        requestAISuggestion(true);
        return;
    }

    if (suggestionTimeout) clearTimeout(suggestionTimeout);

    suggestionTimeout = setTimeout(() => {
        const timeSinceLastMessage = Date.now() - lastTranscriptTime;
        if (timeSinceLastMessage >= PAUSE_THRESHOLD && fullTranscript.length >= MIN_TRANSCRIPT_LENGTH) {
            console.log('⏸️ Pause detected, requesting AI suggestion');
            requestAISuggestion();
        }
    }, PAUSE_THRESHOLD);
}

function requestAISuggestion(skipRateLimit = false) {
    const now = Date.now();

    if (!skipRateLimit && now - lastSuggestionTime < 5000) {
        console.log('⏱️ Rate limit, skipping');
        return;
    }

    if (!fullTranscript || fullTranscript.length < MIN_TRANSCRIPT_LENGTH) return;

    lastSuggestionTime = now;

    if (wsAI && wsAI.readyState === WebSocket.OPEN) {
        console.log('🚀 Requesting AI suggestion');
        showThinkingIndicator();

        wsAI.send(JSON.stringify({
            type: 'get_suggestion',
            text: fullTranscript
        }));
    }
}

// ============================================================
// WEBSOCKET - TRANSCRIPTION
// ============================================================

async function startLiveTranscription() {
    try {
        const tokenResult = await window.electronAPI.getAccessToken();

        // Token can be returned as string directly or as {success, token} object
        let token;
        if (typeof tokenResult === 'string') {
            token = tokenResult;
        } else if (tokenResult?.success && tokenResult?.token) {
            token = tokenResult.token;
        } else if (tokenResult?.token) {
            token = tokenResult.token;
        }

        if (!token) {
            console.error('No token available. User may not be logged in.');
            return;
        }

        // Get microphone audio
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 16000
            }
        });

        // Try to capture system audio
        try {
            await window.electronAPI.enableLoopbackAudio();

            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    sampleRate: 16000
                }
            });

            // Remove video tracks
            displayStream.getVideoTracks().forEach(track => {
                track.stop();
                displayStream.removeTrack(track);
            });

            systemAudioStream = displayStream;
            await window.electronAPI.disableLoopbackAudio();
        } catch (err) {
            console.warn('⚠️ System audio capture failed:', err);
            try { await window.electronAPI.disableLoopbackAudio(); } catch (e) {}
        }

        // Connect WebSocket
        const wsUrl = `${WS_BASE_URL}/ws/transcription/stream?token=${token}&language=ru`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            audioContext = new AudioContext({ sampleRate: 16000 });

            const micSource = audioContext.createMediaStreamSource(audioStream);
            const destination = audioContext.createMediaStreamDestination();

            micSource.connect(destination);

            if (systemAudioStream) {
                const systemSource = audioContext.createMediaStreamSource(systemAudioStream);
                systemSource.connect(destination);
            }

            audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
            const mixedSource = audioContext.createMediaStreamSource(destination.stream);
            mixedSource.connect(audioProcessor);
            audioProcessor.connect(audioContext.destination);

            audioProcessor.onaudioprocess = (e) => {
                // Don't send audio when muted (dictation is active)
                if (ws && ws.readyState === WebSocket.OPEN && isReadyToStream && !isMuted) {
                    const inputData = e.inputBuffer.getChannelData(0);
                    const pcmData = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                        const s = Math.max(-1, Math.min(1, inputData[i]));
                        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                    }
                    ws.send(pcmData.buffer);
                }
            };
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                switch (message.type) {
                    case 'session_start':
                        isReadyToStream = true;
                        startAIProcessing(token);
                        break;

                    case 'interim_transcript':
                        if (message.text) updateTranscript(message.text, true, message.speaker);
                        break;

                    case 'final_transcript':
                        if (message.text?.trim()) updateTranscript(message.text, false, message.speaker);
                        break;

                    case 'session_end':
                        isReadyToStream = false;
                        break;

                    case 'error':
                        console.error('❌ Transcription error:', message.error);
                        break;
                }
            } catch (err) {
                console.error('Error parsing message:', err);
            }
        };

        ws.onerror = (err) => console.error('WebSocket error:', err);
        ws.onclose = () => { isReadyToStream = false; };

    } catch (error) {
        console.error('❌ Error starting transcription:', error);
    }
}

function stopLiveTranscription() {
    isReadyToStream = false;

    if (audioProcessor) {
        audioProcessor.disconnect();
        audioProcessor = null;
    }

    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
        audioContext = null;
    }

    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }

    if (systemAudioStream) {
        systemAudioStream.getTracks().forEach(track => track.stop());
        systemAudioStream = null;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CloseStream' }));
        ws.close();
    }

    stopAIProcessing();
    stopTimer();
}

// ============================================================
// WEBSOCKET - AI
// ============================================================

async function startAIProcessing(token) {
    try {
        wsAI = new WebSocket(`${WS_BASE_URL}/ws/ainotes/stream?token=${token}`);

        wsAI.onopen = () => {
            wsAI.send(JSON.stringify({ type: 'start' }));
        };

        wsAI.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                switch (data.type) {
                    case 'live_suggestion':
                        hideThinkingIndicator();
                        enableQuickActions();
                        if (data.shouldShow && data.suggestion) {
                            addMessage(data.suggestion, 'ai');
                        }
                        break;

                    case 'quick_action_response':
                        hideThinkingIndicator();
                        enableQuickActions();
                        if (data.response) {
                            addMessage(data.response, 'ai');
                        }
                        break;

                    case 'speaker_names':
                        if (data.speakerNames) {
                            speakerNames = { ...speakerNames, ...data.speakerNames };
                            // Update speaker info if we got a name
                            const otherSpeaker = Object.entries(speakerNames).find(([id, name]) => id !== '0' && name);
                            if (otherSpeaker) {
                                updateSpeakerInfo(otherSpeaker[1]);
                            }
                        }
                        break;

                    case 'error':
                        hideThinkingIndicator();
                        enableQuickActions();
                        console.error('❌ AI error:', data.error);
                        break;
                }
            } catch (err) {
                console.error('Error parsing AI message:', err);
            }
        };

        wsAI.onerror = (err) => console.error('AI WebSocket error:', err);
        wsAI.onclose = () => console.log('AI WebSocket closed');

    } catch (error) {
        console.error('❌ Error starting AI:', error);
    }
}

function stopAIProcessing() {
    if (wsAI && wsAI.readyState === WebSocket.OPEN) {
        wsAI.close();
    }
}

// ============================================================
// EVENT HANDLERS
// ============================================================

// Finish button
finishBtn?.addEventListener('click', () => {
    console.log('⏹️ Finish clicked, transcript length:', fullTranscript?.length || 0);
    console.log('⏹️ Full transcript:', fullTranscript?.substring(0, 200) + '...');
    stopLiveTranscription();
    window.electronAPI?.finish({ transcript: fullTranscript });
});

// Minimize button
minimizeBtn?.addEventListener('click', () => {
    console.log('📌 Minimize clicked');
    window.electronAPI?.minimize();
});

// Send message
function sendMessage() {
    const message = inputField.value.trim();
    if (!message) return;

    fullTranscript = fullTranscript ? fullTranscript + ' Вы: ' + message : 'Вы: ' + message;
    addMessage(message, 'user', 'Вы');
    inputField.value = '';

    if (wsAI && wsAI.readyState === WebSocket.OPEN) {
        showThinkingIndicator();
        wsAI.send(JSON.stringify({
            type: 'get_suggestion',
            text: fullTranscript
        }));
    }
}

sendBtn?.addEventListener('click', sendMessage);
inputField?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// ============================================================
// QUICK ACTIONS
// ============================================================

function enableQuickActions() {
    document.querySelectorAll('.quick-action-btn').forEach(btn => {
        btn.classList.remove('loading');
    });
}

const quickActionPrompts = {
    next: 'На основе разговора, что мне лучше сказать дальше? Дай 2-3 варианта коротких фраз.',
    questions: 'Какие уточняющие вопросы я могу задать собеседнику? Дай 3-4 конкретных вопроса.',
    recap: 'Сделай краткое резюме разговора: о чём говорили, какие ключевые моменты, что решили.',
    objection: 'Если собеседник выразил сомнение или возражение, как мне лучше на это ответить? Дай убедительный ответ.'
};

function handleQuickAction(action) {
    if (!fullTranscript || fullTranscript.length < 20) {
        addMessage('Недостаточно контекста. Продолжите разговор.', 'ai');
        return;
    }

    const prompt = quickActionPrompts[action];
    if (!prompt) return;

    // Disable all quick action buttons
    document.querySelectorAll('.quick-action-btn').forEach(btn => {
        btn.classList.add('loading');
    });

    if (wsAI && wsAI.readyState === WebSocket.OPEN) {
        showThinkingIndicator();
        wsAI.send(JSON.stringify({
            type: 'quick_action',
            action: action,
            prompt: prompt,
            text: fullTranscript
        }));
    }
}

// Quick action buttons
document.querySelectorAll('.quick-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action) handleQuickAction(action);
    });
});

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
    // Load API config
    try {
        const result = await window.electronAPI.getApiUrl();
        if (typeof result === 'string') {
            API_BASE_URL = result;
        } else if (result?.apiUrl) {
            API_BASE_URL = result.apiUrl;
        }
        WS_BASE_URL = API_BASE_URL.replace('http://', 'ws://').replace('https://', 'wss://');
    } catch (e) {
        console.error('Error getting API URL:', e);
    }

    // Listen for meeting info
    window.electronAPI?.onMeetingInfo((info) => {
        if (info?.platform) {
            platform.textContent = info.platform;
        }
    });

    // Listen for auto-start
    window.electronAPI?.onAutoStart(async () => {
        startTimer();
        await startLiveTranscription();
    });

    // Listen for mute/unmute (when dictation is active)
    window.electronAPI?.onMute(() => {
        isMuted = true;
    });

    window.electronAPI?.onUnmute(() => {
        isMuted = false;
    });
}

// Prevent context menu
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Start
init();
