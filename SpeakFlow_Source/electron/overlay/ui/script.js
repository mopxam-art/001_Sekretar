/**
 * Recording Overlay UI Script
 *
 * Handles all UI interactions and IPC communication.
 * Responds to events from main process and updates display.
 */

// ============================================================
// DOM ELEMENTS
// ============================================================
const statusDot = document.getElementById('statusDot');
const audioBars = document.getElementById('audioBars');
const overlay = document.getElementById('overlay');
const streamingText = document.getElementById('streamingText');
const timerText = document.getElementById('timerText');
const meetingIndicator = document.getElementById('meetingIndicator');
const meetingTime = document.getElementById('meetingTime');
const tabCompleteIndicator = document.getElementById('tabCompleteIndicator');
const closeBtn = document.getElementById('closeBtn');
const stopBtn = document.getElementById('stopBtn');

// ============================================================
// STATE
// ============================================================
let isCurrentlyRecording = false;
let isCurrentlyProcessing = false;
let isTabCompleteProcessing = false;
let currentRecordingTime = 0;
let hasPlayedWarning = false;
let meetingRecordingTime = 0;

/**
 * Check if overlay should collapse and collapse it
 */
function tryCollapseOverlay() {
  if (!isCurrentlyRecording && !isCurrentlyProcessing && !isTabCompleteProcessing) {
    overlay.classList.remove('expanded');
  }
}

// Timer limits (in seconds)
const MAX_RECORDING_TIME = 300; // 5 minutes
const WARNING_TIME = 290; // Warning at 10 seconds left

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Format seconds to MM:SS display
 * @param {number} seconds - Total seconds
 * @returns {string} Formatted time string
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Play warning sound when approaching time limit
 */
function playWarningSound() {
  try {
    const audio = new Audio('/sounds/warning.wav');
    audio.volume = 0.5;
    audio.play().catch(err => console.warn('[Overlay] Failed to play warning:', err));
  } catch (error) {
    console.warn('[Overlay] Error creating audio:', error);
  }
}

// ============================================================
// RECORDING STATE HANDLERS
// ============================================================

/**
 * Handle recording state changes from main process
 */
window.electronAPI.onRecordingStateChanged((isRecording) => {
  console.log('[Overlay UI] Recording state:', isRecording);
  isCurrentlyRecording = isRecording;

  if (isRecording) {
    // Expand overlay
    overlay.classList.add('expanded');

    // Start recording - update UI
    statusDot.classList.remove('processing');
    statusDot.classList.add('recording');
    audioBars.classList.remove('processing');
    audioBars.classList.add('recording');
    overlay.classList.remove('processing');
    overlay.classList.add('recording');

    // Reset and show timer
    timerText.textContent = '0:00';
    timerText.style.display = 'inline';
    timerText.classList.remove('warning', 'danger');

    currentRecordingTime = 0;
    hasPlayedWarning = false;
  } else {
    // Stop recording - update UI
    statusDot.classList.remove('recording');
    audioBars.classList.remove('recording');
    overlay.classList.remove('recording');

    // Hide timer
    timerText.style.display = 'none';
    timerText.classList.remove('warning', 'danger');

    currentRecordingTime = 0;
    hasPlayedWarning = false;

    // Try to collapse after short delay
    setTimeout(tryCollapseOverlay, 300);
  }
});

/**
 * Handle processing state changes from main process
 */
window.electronAPI.onProcessingStateChanged((isProcessing) => {
  isCurrentlyProcessing = isProcessing;

  if (isProcessing) {
    // Keep expanded during processing
    overlay.classList.add('expanded');
    overlay.classList.add('processing');

    // Don't override recording state
    if (!isCurrentlyRecording) {
      statusDot.classList.remove('recording');
      statusDot.classList.add('processing');
      audioBars.classList.remove('recording');
      audioBars.classList.add('processing');

      // Show processing indicator
      timerText.textContent = '...';
      timerText.style.display = 'inline';
    }
  } else {
    overlay.classList.remove('processing');

    // Don't override recording state
    if (!isCurrentlyRecording) {
      statusDot.classList.remove('processing');
      audioBars.classList.remove('processing');
      timerText.style.display = 'none';
    }

    // Try to collapse immediately when processing stops
    tryCollapseOverlay();
  }
});

/**
 * Handle Tab-Complete state changes from main process
 */
if (window.electronAPI.onTabCompleteStateChanged) {
  window.electronAPI.onTabCompleteStateChanged((isProcessing) => {
    isTabCompleteProcessing = isProcessing;

    if (isProcessing) {
      // Show Tab-Complete indicator
      overlay.classList.add('expanded');
      tabCompleteIndicator.classList.add('active');
    } else {
      // Hide Tab-Complete indicator
      tabCompleteIndicator.classList.remove('active');
      setTimeout(tryCollapseOverlay, 300);
    }
  });
}

/**
 * Handle recording time updates from main process
 */
if (window.electronAPI.onRecordingTimeUpdate) {
  window.electronAPI.onRecordingTimeUpdate((seconds) => {
    currentRecordingTime = seconds;
    timerText.textContent = formatTime(seconds);

    // Remove previous warning classes
    timerText.classList.remove('warning', 'danger');

    // Check for warnings
    if (seconds >= WARNING_TIME && seconds < MAX_RECORDING_TIME) {
      // Warning: 10 seconds left
      timerText.classList.add('warning');
      if (!hasPlayedWarning) {
        playWarningSound();
        hasPlayedWarning = true;
      }
    } else if (seconds >= MAX_RECORDING_TIME - 5 && seconds < MAX_RECORDING_TIME) {
      // Danger: 5 seconds left
      timerText.classList.add('danger');
    }
  });
}

// ============================================================
// MEETING RECORDING HANDLERS
// ============================================================

if (window.electronAPI.onMeetingRecordingStateChanged) {
  window.electronAPI.onMeetingRecordingStateChanged((isRecording, duration) => {
    console.log('[Overlay UI] Meeting recording:', isRecording, 'duration:', duration);

    if (isRecording) {
      meetingIndicator.classList.add('active');
      overlay.classList.add('meeting-active');
      meetingRecordingTime = duration || 0;
      meetingTime.textContent = formatTime(meetingRecordingTime);
    } else {
      meetingIndicator.classList.remove('active');
      overlay.classList.remove('meeting-active');
      meetingRecordingTime = 0;
    }
  });
}

if (window.electronAPI.onMeetingRecordingTimeUpdate) {
  window.electronAPI.onMeetingRecordingTimeUpdate((duration) => {
    meetingRecordingTime = duration;
    meetingTime.textContent = formatTime(duration);
  });
}

// ============================================================
// STREAMING TEXT HANDLER
// ============================================================

window.electronAPI.onStreamingTextUpdate((text) => {
  if (text && text.trim()) {
    streamingText.textContent = text;
    streamingText.classList.add('visible');
  } else {
    streamingText.textContent = '';
    streamingText.classList.remove('visible');
  }
});

// ============================================================
// MODE CHANGE HANDLER (legacy, kept for compatibility)
// ============================================================

window.electronAPI.onOverlayModeChanged((mode) => {
  // Currently no compact mode - just log
  console.log('[Overlay UI] Mode change:', mode);
});

// ============================================================
// FADE HANDLERS (legacy, kept for compatibility)
// ============================================================

window.electronAPI.onOverlayFadedOut(() => {
  overlay.style.opacity = '0.5';
});

window.electronAPI.onOverlayFadedIn(() => {
  overlay.style.opacity = '1';
});

// ============================================================
// USER INTERACTIONS
// ============================================================

// Click on overlay (minimized state only - start recording)
overlay.addEventListener('click', (e) => {
  // Only trigger if minimized (not expanded)
  if (!overlay.classList.contains('expanded')) {
    console.log('[Overlay UI] Minimized overlay clicked - starting recording');
    if (window.electronAPI.startRecording) {
      window.electronAPI.startRecording();
    }
  }
  // When expanded, do nothing on background click (use stop button instead)
});

// Click stop button - stop recording
stopBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  console.log('[Overlay UI] Stop button clicked - stopping recording');
  if (window.electronAPI.stopRecording) {
    window.electronAPI.stopRecording();
  }
});

// Click close button - hide overlay
closeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.electronAPI.hideOverlay();
});

// Prevent right-click context menu
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

// ============================================================
// U6 (28.04.2026): first-run drag hint
// ============================================================
// Показываем tooltip «Перетащите в удобное место» один раз на 5 секунд при
// первом запуске. Юзер часто не знает что overlay перетаскиваемый — кнопок
// нет, hint нет, он мучается месяц прежде чем случайно обнаружит.
(function showDragHintOnce() {
  try {
    const HINT_KEY = 'overlay_drag_hint_shown';
    if (localStorage.getItem(HINT_KEY) === 'true') return;

    const hint = document.getElementById('dragHint');
    if (!hint) return;

    // Показываем через 1.5 сек после старта (даём overlay прорисоваться)
    setTimeout(() => {
      hint.style.display = 'block';
      // Маленькая задержка для CSS transition opacity
      setTimeout(() => hint.classList.add('visible'), 50);

      // Скрываем через 5 секунд
      setTimeout(() => {
        hint.classList.remove('visible');
        setTimeout(() => {
          hint.style.display = 'none';
          localStorage.setItem(HINT_KEY, 'true');
        }, 300);
      }, 5000);
    }, 1500);
  } catch (err) {
    console.warn('[Overlay UI] Drag hint failed:', err);
  }
})();

// ============================================================
// INITIALIZATION
// ============================================================

console.log('[Overlay UI] Script loaded');
