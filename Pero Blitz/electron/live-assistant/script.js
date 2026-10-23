// ============================================================
// LIVE ASSISTANT OVERLAY - CLIENT SCRIPT
// Real-time transcription + AI suggestions with expandable UI
// ============================================================

// ============================================================
// MARKDOWN SUPPORT
// ============================================================

let marked;
try {
    // Try to load marked - will be null if not available
    marked = window.require ? window.require('marked').marked : null;

    if (marked) {
        // Configure marked for inline rendering (no <p> tags for single lines)
        marked.setOptions({
            breaks: true, // Convert \n to <br>
            gfm: true, // GitHub Flavored Markdown
            headerIds: false,
            mangle: false
        });
        console.log('✅ Markdown support enabled');
    } else {
        console.warn('⚠️ Markdown library not available, using plain text');
    }
} catch (err) {
    console.warn('⚠️ Failed to load markdown library:', err.message);
    marked = null;
}

// ============================================================
// DOM ELEMENTS
// ============================================================

const assistantContainer = document.getElementById('assistantContainer');
const compactView = document.getElementById('compactView');
const expandedView = document.getElementById('expandedView');
const startBtn = document.getElementById('startBtn');
const finishBtn = document.getElementById('finishBtn');
const saveNoteBtn = document.getElementById('saveNoteBtn');
const timer = document.getElementById('timer');
const chatContent = document.getElementById('chatContent');
const assistInput = document.getElementById('assistInput');
const systemAudioToggle = document.getElementById('systemAudioToggle');

// DEBUG: Check if elements are found
console.log('🔍 DOM Elements check:');
console.log('  assistantContainer:', !!assistantContainer);
console.log('  startBtn:', !!startBtn);
console.log('  finishBtn:', !!finishBtn);
console.log('  saveNoteBtn:', !!saveNoteBtn);
console.log('  assistInput:', !!assistInput);
console.log('  systemAudioToggle:', !!systemAudioToggle);
console.log('  chatContent:', !!chatContent);

// System audio state - enabled by default
let systemAudioEnabled = true;

// ============================================================
// STATE
// ============================================================

let isExpanded = false;
let recordingTime = 0;
let timerInterval = null;
let fullTranscript = '';
let messageHistory = [];
let currentInterimElement = null;
let lastFinalText = '';

// WebSocket and Audio state
let ws = null;
let wsAI = null;
let audioContext = null;
let audioStream = null;
let systemAudioStream = null;
let audioProcessor = null;
let aiProcessingInterval = null;
let isReadyToStream = false;

// Live suggestion state
let lastSuggestionTime = 0;

// Speaker diarization state (МАГИЯ!)
let speakerNames = { 0: "Вы" }; // Speaker 0 всегда = "Вы"
let lastSpeakerNamesUpdate = 0;
let speakerNamesInterval = null;
let suggestionTimeout = null;
let lastTranscriptTime = 0; // Время последнего сообщения
const PAUSE_THRESHOLD = 2000; // 2 секунды паузы перед AI ответом
const MIN_TRANSCRIPT_LENGTH = 10; // Минимум 10 символов для AI ответа

// API Configuration
let API_BASE_URL = 'http://localhost:4000'; // Default fallback
let WS_BASE_URL = 'ws://localhost:4000'; // Default fallback

// ============================================================
// UI STATE MANAGEMENT
// ============================================================

function expandView() {
    isExpanded = true;
    assistantContainer.classList.remove('compact');
    assistantContainer.classList.add('expanded');
    compactView.style.display = 'none';
    expandedView.style.display = 'flex';
}

function compactViewCollapse() {
    isExpanded = false;
    assistantContainer.classList.remove('expanded');
    assistantContainer.classList.add('compact');
    expandedView.style.display = 'none';
    compactView.style.display = 'flex';
}

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
        if (timer) {
            timer.textContent = formatTime(recordingTime);
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// ============================================================
// CHAT UI
// ============================================================

function addUserMessage(text, speakerName = null) {
    console.log('💬 Adding user message:', text, 'Speaker:', speakerName);

    const displayName = speakerName || 'Вы';

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-user highlight';
    messageDiv.innerHTML = `
        <div class="message-label">${displayName}</div>
        <div class="message-text">${text}</div>
    `;

    chatContent.appendChild(messageDiv);

    messageHistory.push({
        type: 'user',
        text: text,
        speaker: speakerName,
        timestamp: Date.now()
    });

    chatContent.scrollTop = chatContent.scrollHeight;

    setTimeout(() => {
        messageDiv.classList.remove('highlight');
    }, 1000);
}

function addAIMessage(suggestion) {
    console.log('💡 Adding AI response:', suggestion);

    // Hide thinking indicator
    hideThinkingIndicator();

    if (!suggestion || !suggestion.trim()) {
        console.warn('⚠️ Empty response received');
        return;
    }

    // Render Markdown to HTML (if available)
    const renderedHTML = marked ? marked.parse(suggestion) : suggestion;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-ai highlight';
    messageDiv.innerHTML = `
        <div class="message-label">AI</div>
        <div class="message-text">${renderedHTML}</div>
    `;

    chatContent.appendChild(messageDiv);

    messageHistory.push({
        type: 'ai',
        text: suggestion,
        timestamp: Date.now()
    });

    chatContent.scrollTop = chatContent.scrollHeight;

    setTimeout(() => {
        messageDiv.classList.remove('highlight');
    }, 1000);

    console.log('✅ AI Response added to chat (with Markdown rendering)');
}

function updateInterimText(text, speakerId = null) {
    if (!text || !text.trim()) {
        if (currentInterimElement) {
            currentInterimElement.remove();
            currentInterimElement = null;
        }
        return;
    }

    if (!currentInterimElement) {
        currentInterimElement = document.createElement('div');
        currentInterimElement.className = 'interim-text';
        chatContent.appendChild(currentInterimElement);
    }

    const speakerName = getSpeakerName(speakerId);
    const displayText = speakerName ? `${speakerName}: ${text}...` : `${text}...`;

    currentInterimElement.textContent = displayText;
    chatContent.scrollTop = chatContent.scrollHeight;
}

// Получить имя спикера (МАГИЯ!)
function getSpeakerName(speakerId) {
    if (speakerId === null || speakerId === undefined) {
        return null; // Нет speaker ID
    }
    return speakerNames[speakerId] || `Спикер ${speakerId}`;
}

// Запросить извлечение имен спикеров (автоматически)
async function extractSpeakerNames() {
    if (!wsAI || wsAI.readyState !== WebSocket.OPEN) {
        console.log('🔇 AI WebSocket not ready for speaker names extraction');
        return;
    }

    if (!fullTranscript || fullTranscript.length < 50) {
        return; // Недостаточно текста
    }

    const now = Date.now();
    if (now - lastSpeakerNamesUpdate < 30000) {
        return; // Обновляем раз в 30 секунд
    }

    console.log('✨ Requesting speaker names extraction...');
    lastSpeakerNamesUpdate = now;

    wsAI.send(JSON.stringify({
        type: 'extract_speaker_names',
        text: fullTranscript
    }));
}

function updateTranscript(text, isInterim = false, speakerId = null) {
    if (isInterim) {
        updateInterimText(text, speakerId);
    } else {
        if (!text || !text.trim()) {
            console.log('⚠️ Skipping empty transcript');
            return;
        }

        if (text === lastFinalText) {
            console.log('⚠️ Skipping duplicate transcript:', text);
            return;
        }

        lastFinalText = text;

        if (currentInterimElement) {
            currentInterimElement.remove();
            currentInterimElement = null;
        }

        // Добавляем спикера к транскрипту
        const speakerName = getSpeakerName(speakerId);
        const textWithSpeaker = speakerName ? `${speakerName}: ${text}` : text;

        if (fullTranscript) {
            fullTranscript += ' ' + textWithSpeaker;
        } else {
            fullTranscript = textWithSpeaker;
        }

        addUserMessage(text, speakerName);
        checkForSuggestionNeed(text);

        // Периодически извлекаем имена спикеров (МАГИЯ!)
        if (speakerId !== null && speakerId !== undefined) {
            extractSpeakerNames();
        }
    }
}

// ============================================================
// AI SUGGESTIONS
// ============================================================

function checkForSuggestionNeed(lastUtterance) {
    // Обновляем время последнего транскрипта
    lastTranscriptTime = Date.now();

    // Проверяем на явный вопрос
    const hasQuestionMark = lastUtterance.includes('?');
    const questionWords = ['что', 'где', 'когда', 'почему', 'как', 'какой', 'можно', 'можете', 'скажи', 'расскажи', 'объясни'];
    const hasQuestionWord = questionWords.some(word =>
        lastUtterance.toLowerCase().includes(word)
    );

    // Если явный вопрос - отвечаем сразу (обход rate limit)
    if (hasQuestionMark || hasQuestionWord) {
        console.log('❓ Detected question, requesting AI immediately (skip rate limit)');
        requestAISuggestion(true); // skipRateLimit = true
        return;
    }

    // Отменяем предыдущий таймер
    if (suggestionTimeout) {
        clearTimeout(suggestionTimeout);
    }

    // Устанавливаем новый таймер - AI ответит только после паузы
    suggestionTimeout = setTimeout(() => {
        const timeSinceLastMessage = Date.now() - lastTranscriptTime;

        // Проверяем что прошло достаточно времени и есть достаточно текста
        if (timeSinceLastMessage >= PAUSE_THRESHOLD && fullTranscript.length >= MIN_TRANSCRIPT_LENGTH) {
            console.log(`⏸️ Pause detected (${timeSinceLastMessage}ms), requesting AI suggestion`);
            requestAISuggestion();
        } else {
            console.log(`⏭️ Skipping AI - pause too short (${timeSinceLastMessage}ms) or text too short (${fullTranscript.length} chars)`);
        }
    }, PAUSE_THRESHOLD);
}

let thinkingIndicator = null;

function showThinkingIndicator() {
    // Remove any existing thinking indicator
    if (thinkingIndicator) {
        thinkingIndicator.remove();
    }

    // Create new thinking indicator
    thinkingIndicator = document.createElement('div');
    thinkingIndicator.className = 'message-ai-thinking';
    thinkingIndicator.innerHTML = `
        <div class="thinking-dots">
            <div class="thinking-dot"></div>
            <div class="thinking-dot"></div>
            <div class="thinking-dot"></div>
        </div>
    `;

    chatContent.appendChild(thinkingIndicator);
    chatContent.scrollTop = chatContent.scrollHeight;
}

function hideThinkingIndicator() {
    if (thinkingIndicator) {
        thinkingIndicator.remove();
        thinkingIndicator = null;
    }
}

function requestAISuggestion(skipRateLimit = false) {
    const now = Date.now();

    // Rate limiting - не чаще раза в 5 секунд (но можно обойти для явных вопросов)
    if (!skipRateLimit && now - lastSuggestionTime < 5000) {
        console.log('⏱️ Rate limit: waiting', Math.ceil((5000 - (now - lastSuggestionTime)) / 1000), 'seconds');
        return;
    }

    // Проверяем минимальную длину транскрипта
    if (!fullTranscript || fullTranscript.length < MIN_TRANSCRIPT_LENGTH) {
        console.log('⚠️ Not enough context for suggestion:', fullTranscript.length, 'chars (need', MIN_TRANSCRIPT_LENGTH, ')');
        return;
    }

    lastSuggestionTime = now;

    if (wsAI && wsAI.readyState === WebSocket.OPEN) {
        console.log('🚀 Requesting AI suggestion for:', fullTranscript.substring(0, 100) + '...');

        // Show thinking animation
        showThinkingIndicator();

        wsAI.send(JSON.stringify({
            type: 'get_suggestion',
            text: fullTranscript
        }));
    } else {
        console.error('❌ AI WebSocket not ready:', wsAI ? wsAI.readyState : 'null');
    }
}

// ============================================================
// BUTTON HANDLERS
// ============================================================

if (startBtn) {
    console.log('✅ Start button found, attaching click handler');
    startBtn.addEventListener('click', async () => {
        console.log('🚀 Start button clicked');
        expandView();
        startTimer();
        await startLiveTranscription();
    });
} else {
    console.error('❌ Start button not found!');
}

// Finish button handler (Stop recording)
if (finishBtn) {
    console.log('✅ Finish button found, attaching click handler');
    finishBtn.addEventListener('click', () => {
        console.log('⏹️ Finish button clicked');
        stopTimer();
        stopLiveTranscription();
        if (window.electronAPI && window.electronAPI.finishLiveAssistant) {
            window.electronAPI.finishLiveAssistant(fullTranscript);
        }
    });
} else {
    console.error('❌ Finish button not found!');
}

// Save note button handler
if (saveNoteBtn) {
    console.log('✅ Save note button found, attaching click handler');
    saveNoteBtn.addEventListener('click', async () => {
        console.log('💾 Save note button clicked');

        if (!fullTranscript || fullTranscript.trim().length === 0) {
            console.warn('⚠️ No transcript to save');
            return;
        }

        // Stop recording first
        stopTimer();
        stopLiveTranscription();

        // Call API to create note
        if (window.electronAPI && window.electronAPI.saveAsNote) {
            try {
                const result = await window.electronAPI.saveAsNote(fullTranscript);
                if (result.success) {
                    console.log('✅ Note saved successfully:', result.noteId);
                    // Close overlay after saving
                    if (window.electronAPI.hideOverlay) {
                        window.electronAPI.hideOverlay();
                    }
                } else {
                    console.error('❌ Failed to save note:', result.error);
                }
            } catch (error) {
                console.error('❌ Error saving note:', error);
            }
        }
    });
} else {
    console.error('❌ Save note button not found!');
}

// System audio toggle handler
if (systemAudioToggle) {
    console.log('✅ System audio toggle found, attaching click handler');

    // Set active by default
    systemAudioToggle.classList.add('active');

    systemAudioToggle.addEventListener('click', () => {
        systemAudioEnabled = !systemAudioEnabled;
        systemAudioToggle.classList.toggle('active', systemAudioEnabled);
        console.log('🔊 System audio:', systemAudioEnabled ? 'ENABLED' : 'DISABLED');
    });

    // Listen for auto-enable from meeting detection
    if (window.electronAPI && window.electronAPI.onEnableSystemAudio) {
        window.electronAPI.onEnableSystemAudio(() => {
            console.log('🔊 Auto-enabling system audio for meeting');
            systemAudioEnabled = true;
            systemAudioToggle.classList.add('active');
        });
    }
} else {
    console.error('❌ System audio toggle not found!');
}

// Enter key handler for input (send button removed - use Enter instead)
if (assistInput) {
    console.log('✅ Input field found, attaching Enter handler');
    assistInput.addEventListener('keypress', (e) => {
        console.log('⌨️ Key pressed:', e.key);
        if (e.key === 'Enter') {
            console.log('↩️ Enter pressed!');
            sendMessage();
        }
    });
} else {
    console.error('❌ Input field not found!');
}

function sendMessage() {
    console.log('🔵 sendMessage() called');
    console.log('📍 assistInput exists:', !!assistInput);

    if (!assistInput) {
        console.error('❌ CRITICAL: assistInput is null!');
        return;
    }

    console.log('📍 Input value:', assistInput.value);

    const message = assistInput.value.trim();
    console.log('📍 Trimmed message:', message, 'Length:', message.length);

    if (!message) {
        console.warn('⚠️ Empty message, returning');
        return;
    }

    console.log('💬 Processing message:', message);

    // Expand to chat view if in compact mode
    if (!isExpanded) {
        console.log('📍 Expanding view...');
        expandView();
    }

    // Add to transcript
    if (fullTranscript) {
        fullTranscript += ' ' + message;
    } else {
        fullTranscript = message;
    }
    console.log('📍 Updated transcript length:', fullTranscript.length);

    // Add user message to chat
    console.log('📍 Adding user message to chat...');
    addUserMessage(message);

    // Clear input
    assistInput.value = '';
    console.log('📍 Input cleared');

    // Request AI suggestion for the message
    console.log('📍 Checking AI WebSocket... wsAI:', !!wsAI, 'readyState:', wsAI?.readyState);
    if (wsAI && wsAI.readyState === WebSocket.OPEN) {
        console.log('🚀 Requesting AI response for message');

        // Show thinking indicator
        showThinkingIndicator();

        wsAI.send(JSON.stringify({
            type: 'get_suggestion',
            text: fullTranscript
        }));
        console.log('✅ AI request sent');
    } else {
        console.error('❌ AI WebSocket not ready. State:', wsAI?.readyState);
    }
}

// ============================================================
// TRANSCRIPTION WEBSOCKET
// ============================================================

async function startLiveTranscription() {
    try {
        const tokenResult = await window.electronAPI.getAccessToken();

        if (!tokenResult || !tokenResult.success || !tokenResult.token) {
            console.error('❌ No token available');
            return;
        }
        const token = tokenResult.token;

        // Get microphone audio
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 16000
            }
        });

        // Check if system audio should be captured
        if (systemAudioEnabled) {
            try {
                console.log('🔊 Enabling loopback audio...');

                // Enable loopback audio mode
                await window.electronAPI.enableLoopbackAudio();

                // Capture system audio using getDisplayMedia
                // Note: We need to request video=true for the API to work
                const displayStream = await navigator.mediaDevices.getDisplayMedia({
                    video: true,
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                        sampleRate: 16000
                    }
                });

                // Remove video tracks (we only need audio)
                const videoTracks = displayStream.getVideoTracks();
                videoTracks.forEach(track => {
                    track.stop();
                    displayStream.removeTrack(track);
                });

                // Extract only audio tracks
                systemAudioStream = displayStream;

                // Disable loopback audio mode (restore normal getDisplayMedia)
                await window.electronAPI.disableLoopbackAudio();

                console.log('✅ System audio captured via loopback');
            } catch (err) {
                console.warn('⚠️ System audio capture failed:', err);
                systemAudioStream = null;
                // Try to disable loopback even on error
                try {
                    await window.electronAPI.disableLoopbackAudio();
                } catch (e) {
                    console.error('Failed to disable loopback:', e);
                }
            }
        }

        ws = new WebSocket(`${WS_BASE_URL}/ws/transcription/stream?token=${token}&language=ru`);

        ws.onopen = () => {
            audioContext = new AudioContext({ sampleRate: 16000 });

            // Create sources for both microphone and system audio
            const micSource = audioContext.createMediaStreamSource(audioStream);

            // Create mixer destination
            const destination = audioContext.createMediaStreamDestination();

            // Connect microphone
            micSource.connect(destination);

            // Connect system audio if available
            if (systemAudioStream) {
                const systemSource = audioContext.createMediaStreamSource(systemAudioStream);
                systemSource.connect(destination);
                console.log('✅ System audio mixed with microphone');
            }

            // Create processor for mixed audio
            audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);

            // Connect the mixed stream to the processor
            const mixedSource = audioContext.createMediaStreamSource(destination.stream);
            mixedSource.connect(audioProcessor);
            audioProcessor.connect(audioContext.destination);

            audioProcessor.onaudioprocess = (e) => {
                if (ws && ws.readyState === WebSocket.OPEN && isReadyToStream) {
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
                console.log('🔵 Transcription WS message:', message.type, message);

                switch (message.type) {
                    case 'session_start':
                        isReadyToStream = true;
                        console.log('✅ Transcription session started');

                        // Start AI processing
                        startAIProcessing(token);
                        break;

                    case 'interim_transcript':
                        console.log('📝 Interim:', message.text, 'Speaker:', message.speaker);
                        if (message.text) {
                            updateTranscript(message.text, true, message.speaker);
                        }
                        break;

                    case 'final_transcript':
                        console.log('✅ Final transcript:', message.text, 'Speaker:', message.speaker);
                        if (message.text && message.text.trim()) {
                            updateTranscript(message.text, false, message.speaker);
                        }
                        break;

                    case 'utterance_end':
                        console.log('🔚 Utterance end (ignored):', message.fullText || message.text);
                        break;

                    case 'session_end':
                        isReadyToStream = false;
                        console.log('🛑 Transcription session ended');
                        break;

                    case 'error':
                        console.error('❌ Transcription error:', message.error);
                        isReadyToStream = false;
                        break;
                }
            } catch (err) {
                console.error('Error parsing message:', err);
            }
        };

        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
            isReadyToStream = false;
        };

        ws.onclose = (event) => {
            if (event.code !== 1000) {
                console.error(`❌ WebSocket closed with code ${event.code}`);
            }
            isReadyToStream = false;
        };

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

    // Stop system audio stream if it exists
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
// AI WEBSOCKET
// ============================================================

async function startAIProcessing(token) {
    try {
        console.log('🚀 Starting AI WebSocket connection...');
        const wsUrl = `${WS_BASE_URL}/ws/ainotes/stream?token=${token}`;
        console.log('📍 AI WebSocket URL:', wsUrl);

        wsAI = new WebSocket(wsUrl);
        console.log('📍 AI WebSocket created, readyState:', wsAI.readyState);

        wsAI.onopen = () => {
            console.log('✅ AI WebSocket CONNECTED! Sending start message...');
            wsAI.send(JSON.stringify({ type: 'start' }));
            console.log('📍 AI WebSocket readyState after start:', wsAI.readyState);

            aiProcessingInterval = setInterval(() => {
                if (fullTranscript && wsAI && wsAI.readyState === WebSocket.OPEN) {
                    sendToAI(fullTranscript);
                }
            }, 30000);
        };

        wsAI.onmessage = (event) => {
            try {
                console.log('📥 AI WebSocket message:', event.data);
                const data = JSON.parse(event.data);

                switch (data.type) {
                    case 'session_start':
                        console.log('✅ AI session started');
                        break;

                    case 'live_suggestion':
                        console.log('💡 Live suggestion received:', data.suggestion, 'shouldShow:', data.shouldShow);

                        // Проверяем shouldShow флаг от backend
                        if (data.shouldShow && data.suggestion) {
                            addAIMessage(data.suggestion);
                        } else {
                            // Passive mode - просто скрываем "думает" анимацию
                            hideThinkingIndicator();
                            console.log('🔇 Passive mode, not showing suggestion');
                        }
                        break;

                    case 'speaker_names':
                        console.log('✨ Speaker names updated:', data.speakerNames);
                        // Обновляем словарь имен спикеров
                        if (data.speakerNames) {
                            speakerNames = { ...speakerNames, ...data.speakerNames };
                            console.log('✅ Current speaker names:', speakerNames);
                        }
                        break;

                    case 'error':
                        console.error('❌ AI error:', data.error);
                        break;

                    default:
                        console.log('ℹ️ Unknown AI message type:', data.type);
                }
            } catch (err) {
                console.error('❌ Error parsing AI message:', err);
            }
        };

        wsAI.onerror = (err) => {
            console.error('❌ AI WebSocket ERROR:', err);
            console.error('📍 Error details:', {
                readyState: wsAI?.readyState,
                url: wsUrl
            });
        };

        wsAI.onclose = (event) => {
            console.log('🔌 AI WebSocket CLOSED');
            console.log('📍 Close details:', {
                code: event.code,
                reason: event.reason,
                wasClean: event.wasClean
            });
        };

    } catch (error) {
        console.error('❌ Error starting AI processing:', error);
    }
}

function sendToAI(text) {
    if (!wsAI || wsAI.readyState !== WebSocket.OPEN) return;

    wsAI.send(JSON.stringify({
        type: 'text_chunk',
        text: text
    }));

    wsAI.send(JSON.stringify({
        type: 'end'
    }));
}

function stopAIProcessing() {
    if (aiProcessingInterval) {
        clearInterval(aiProcessingInterval);
        aiProcessingInterval = null;
    }

    if (wsAI && wsAI.readyState === WebSocket.OPEN) {
        wsAI.close();
    }
}

// ============================================================
// INITIALIZATION
// ============================================================

// Load API configuration from Electron
async function loadApiConfig() {
    try {
        const result = await window.electronAPI.getApiUrl();
        if (result && result.success && result.apiUrl) {
            API_BASE_URL = result.apiUrl;
            // Convert HTTP URL to WebSocket URL
            WS_BASE_URL = API_BASE_URL.replace('http://', 'ws://').replace('https://', 'wss://');
        }
    } catch (error) {
        // Silent fallback to default
    }
}

// Prevent context menu
document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

// Initialize AI connection on page load
async function initializeAI() {
    try {
        console.log('🔧 Initializing AI connection...');
        const tokenResult = await window.electronAPI.getAccessToken();
        console.log('📍 Token result:', tokenResult ? 'SUCCESS' : 'FAILED');

        if (tokenResult && tokenResult.success && tokenResult.token) {
            console.log('✅ Token obtained, starting AI processing...');
            await startAIProcessing(tokenResult.token);
        } else {
            console.error('❌ Failed to get token:', tokenResult);
        }
    } catch (error) {
        console.error('❌ Error initializing AI:', error);
    }
}

// Initialize when page loads
(async () => {
    await loadApiConfig(); // Load API config first
    await initializeAI(); // Then initialize AI
})();
