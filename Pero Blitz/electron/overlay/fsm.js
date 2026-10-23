/**
 * Overlay Finite State Machine (FSM)
 *
 * Manages overlay mode transitions (COMPACT <-> FULL).
 * Ensures only valid state transitions are allowed.
 *
 * State Diagram:
 *   COMPACT -----> FULL (on mouse enter, recording start)
 *   FULL -------> COMPACT (on inactivity timeout, recording end)
 */

const { MODES, MODE_TRANSITIONS } = require('./config');

class OverlayFSM {
  /**
   * Create FSM instance
   * @param {string} initialMode - Starting mode (COMPACT or FULL)
   */
  constructor(initialMode = MODES.COMPACT) {
    this.currentMode = initialMode;
  }

  /**
   * Get current mode
   * @returns {string} Current mode (COMPACT or FULL)
   */
  getCurrentMode() {
    return this.currentMode;
  }

  /**
   * Check if mode is COMPACT
   * @returns {boolean}
   */
  isCompact() {
    return this.currentMode === MODES.COMPACT;
  }

  /**
   * Check if mode is FULL
   * @returns {boolean}
   */
  isFull() {
    return this.currentMode === MODES.FULL;
  }

  /**
   * Check if transition to new mode is valid
   * @param {string} newMode - Target mode
   * @returns {boolean} True if transition is allowed
   */
  canTransitionTo(newMode) {
    const allowedTransitions = MODE_TRANSITIONS[this.currentMode];
    return allowedTransitions && allowedTransitions.includes(newMode);
  }

  /**
   * Attempt to transition to new mode
   * @param {string} newMode - Target mode
   * @returns {boolean} True if transition succeeded
   */
  transitionTo(newMode) {
    if (this.canTransitionTo(newMode)) {
      console.log(`[Overlay FSM] ${this.currentMode} -> ${newMode}`);
      this.currentMode = newMode;
      return true;
    }

    console.warn(`[Overlay FSM] Invalid transition: ${this.currentMode} -> ${newMode}`);
    return false;
  }

  /**
   * Force set mode (bypass validation)
   * Use only for initialization or error recovery
   * @param {string} mode - Mode to set
   */
  forceMode(mode) {
    console.log(`[Overlay FSM] Force set mode: ${mode}`);
    this.currentMode = mode;
  }

  /**
   * Reset to initial state
   * @param {string} mode - Mode to reset to (default: COMPACT)
   */
  reset(mode = MODES.COMPACT) {
    this.currentMode = mode;
  }
}

module.exports = OverlayFSM;
