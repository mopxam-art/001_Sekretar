/**
 * Timer Manager
 *
 * Manages recording timer with start/stop/tick functionality.
 * Sends time updates to overlay UI every second.
 */

class TimerManager {
  constructor() {
    /** @type {NodeJS.Timeout|null} Timer interval reference */
    this.interval = null;

    /** @type {number|null} Recording start timestamp */
    this.startTime = null;

    /** @type {boolean} Is timer currently running */
    this.running = false;
  }

  /**
   * Start the timer
   * @param {Function} onTick - Callback called every second with elapsed seconds
   * @returns {void}
   */
  start(onTick) {
    // Clear any existing timer
    this.stop();

    this.startTime = Date.now();
    this.running = true;

    console.log('[TimerManager] Started at:', this.startTime);

    // Update every second
    this.interval = setInterval(() => {
      if (this.running && this.startTime) {
        const seconds = Math.floor((Date.now() - this.startTime) / 1000);
        onTick(seconds);
      }
    }, 1000);
  }

  /**
   * Stop the timer
   * @returns {void}
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (this.running) {
      console.log('[TimerManager] Stopped');
    }

    this.running = false;
    this.startTime = null;
  }

  /**
   * Get elapsed time in seconds
   * @returns {number} Elapsed seconds (0 if not running)
   */
  getElapsed() {
    if (!this.running || !this.startTime) {
      return 0;
    }
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * Check if timer is running
   * @returns {boolean}
   */
  isRunning() {
    return this.running;
  }

  /**
   * Reset timer to initial state
   * @returns {void}
   */
  reset() {
    this.stop();
  }
}

module.exports = TimerManager;
