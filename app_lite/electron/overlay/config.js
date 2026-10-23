/**
 * Overlay Configuration
 *
 * All constants and configuration for the Recording Overlay.
 * Modify these values to customize overlay behavior.
 */

// ============================================================
// OVERLAY MODES
// ============================================================

/**
 * FSM states for overlay visibility
 * - COMPACT: Minimized view (just status dot)
 * - FULL: Expanded view with timer and controls
 */
const MODES = {
  COMPACT: 'compact',
  FULL: 'full'
};

/**
 * Valid transitions between modes
 * Used by FSM to validate state changes
 */
const MODE_TRANSITIONS = {
  [MODES.COMPACT]: [MODES.FULL],
  [MODES.FULL]: [MODES.COMPACT]
};

// ============================================================
// WINDOW CONFIGURATION
// ============================================================

/**
 * Window sizes in pixels
 */
const WINDOW = {
  // Default compact size
  WIDTH: 180,
  HEIGHT: 44,
  // Expanded size for meeting recording
  WIDTH_EXPANDED: 260,
  HEIGHT_EXPANDED: 44
};

/**
 * Window positioning
 * Overlay appears at bottom center of screen
 */
const POSITION = {
  // Distance from bottom of screen
  BOTTOM_OFFSET: 85
};

// ============================================================
// TIMERS
// ============================================================

/**
 * Inactivity timeout in milliseconds
 * After this time without activity, overlay switches to compact mode
 */
const INACTIVITY_TIMEOUT = 3000;

/**
 * Recording timer limits (in seconds)
 */
const RECORDING = {
  // Maximum recording duration (5 minutes)
  MAX_TIME: 300,
  // Warning threshold (10 seconds before limit)
  WARNING_TIME: 290,
  // Danger threshold (5 seconds before limit)
  DANGER_TIME: 295
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  MODES,
  MODE_TRANSITIONS,
  WINDOW,
  POSITION,
  INACTIVITY_TIMEOUT,
  RECORDING
};
