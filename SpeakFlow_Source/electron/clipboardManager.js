const { clipboard, app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const clipboardWatcher = require('electron-clipboard-watcher');

/**
 * Clipboard Manager Module
 * Handles clipboard operations including text and image management
 * Uses electron-clipboard-watcher for native OS clipboard events (no polling)
 */

class ClipboardManager {
  constructor() {
    this.tempDir = path.join(app.getPath('temp'), 'echo-clipboard');
    this.historyDir = path.join(app.getPath('userData'), 'clipboard-images');
    this.ensureTempDir();
    this.ensureHistoryDir();
    this.startCleanupInterval();

    // Monitoring state
    this.watcher = null;
    this.lastClipboardText = '';
    this.lastClipboardImageHash = '';
    this.onClipboardChange = null; // Callback function
  }

  /**
   * Ensure history directory exists
   */
  ensureHistoryDir() {
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }
  }

  /**
   * Ensure temp directory exists
   */
  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Read text from clipboard
   */
  readText() {
    try {
      const text = clipboard.readText();
      return { success: true, text };
    } catch (error) {
      console.error('Error reading text from clipboard:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Write text to clipboard
   */
  writeText(text) {
    try {
      clipboard.writeText(text);
      return { success: true };
    } catch (error) {
      console.error('Error writing text to clipboard:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if clipboard contains an image
   */
  hasImage() {
    try {
      const image = clipboard.readImage();
      return { success: true, hasImage: !image.isEmpty() };
    } catch (error) {
      console.error('Error checking clipboard for image:', error);
      return { success: false, hasImage: false, error: error.message };
    }
  }

  /**
   * Read image from clipboard and save to temp file
   * Returns local file path for AI model
   */
  readImage() {
    try {
      const image = clipboard.readImage();

      if (image.isEmpty()) {
        return { success: false, error: 'No image in clipboard' };
      }

      // Generate unique filename
      const timestamp = Date.now();
      const randomId = crypto.randomBytes(8).toString('hex');
      const filename = `clipboard-${timestamp}-${randomId}.png`;
      const filePath = path.join(this.tempDir, filename);

      // Save image as PNG
      const pngBuffer = image.toPNG();
      fs.writeFileSync(filePath, pngBuffer);

      // Get image size for metadata
      const size = image.getSize();

      return {
        success: true,
        path: filePath,
        url: `file:///${filePath.replace(/\\/g, '/')}`,
        size: {
          width: size.width,
          height: size.height
        },
        format: 'png'
      };
    } catch (error) {
      console.error('Error reading image from clipboard:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Read image from clipboard, compress and return as base64
   * Compresses image to max 1024px and 85% quality
   * Returns data URI format ready for AI models
   */
  readImageAsBase64() {
    try {
      const image = clipboard.readImage();

      if (image.isEmpty()) {
        return { success: false, error: 'No image in clipboard' };
      }

      // Get original size
      const originalSize = image.getSize();
      let processedImage = image;

      // Resize if image is too large (max dimension 1024px)
      const MAX_DIMENSION = 1024;
      if (originalSize.width > MAX_DIMENSION || originalSize.height > MAX_DIMENSION) {
        const aspectRatio = originalSize.width / originalSize.height;
        let newWidth, newHeight;

        if (originalSize.width > originalSize.height) {
          newWidth = MAX_DIMENSION;
          newHeight = Math.round(MAX_DIMENSION / aspectRatio);
        } else {
          newHeight = MAX_DIMENSION;
          newWidth = Math.round(MAX_DIMENSION * aspectRatio);
        }

        processedImage = image.resize({ width: newWidth, height: newHeight });
      }

      // Convert to JPEG with 85% quality for better compression
      const jpegBuffer = processedImage.toJPEG(85);
      const base64String = jpegBuffer.toString('base64');
      const dataUri = `data:image/jpeg;base64,${base64String}`;

      // Get final size info
      const finalSize = processedImage.getSize();
      const originalSizeKB = Math.round(image.toPNG().length / 1024);
      const compressedSizeKB = Math.round(jpegBuffer.length / 1024);

      return {
        success: true,
        base64: dataUri,
        originalSize: {
          width: originalSize.width,
          height: originalSize.height,
          sizeKB: originalSizeKB
        },
        compressedSize: {
          width: finalSize.width,
          height: finalSize.height,
          sizeKB: compressedSizeKB
        },
        format: 'jpeg',
        compressionRatio: Math.round((compressedSizeKB / originalSizeKB) * 100)
      };
    } catch (error) {
      console.error('Error reading image as base64:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Write image to clipboard from file path
   */
  writeImage(imagePath) {
    try {
      console.log('[ClipboardManager] Writing image to clipboard:', imagePath);

      if (!fs.existsSync(imagePath)) {
        console.error('[ClipboardManager] Image file not found:', imagePath);
        return { success: false, error: 'Image file not found' };
      }

      const image = nativeImage.createFromPath(imagePath);

      // Check if image is empty
      if (image.isEmpty()) {
        console.error('[ClipboardManager] Created image is empty:', imagePath);
        return { success: false, error: 'Failed to load image from path' };
      }

      const size = image.getSize();
      console.log('[ClipboardManager] Image loaded successfully:', size);

      // Write both image and file path to clipboard
      // This allows pasting as image in image editors and as path in text editors
      clipboard.write({
        image: image,
        text: imagePath
      });

      console.log('[ClipboardManager] Image and path written to clipboard');

      return { success: true };
    } catch (error) {
      console.error('[ClipboardManager] Error writing image to clipboard:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clean up old temporary files (older than 1 hour)
   */
  cleanupOldFiles() {
    try {
      if (!fs.existsSync(this.tempDir)) {
        return;
      }

      const files = fs.readdirSync(this.tempDir);
      const now = Date.now();
      const ONE_HOUR = 60 * 60 * 1000;

      files.forEach(file => {
        const filePath = path.join(this.tempDir, file);
        try {
          const stats = fs.statSync(filePath);
          const fileAge = now - stats.mtimeMs;

          if (fileAge > ONE_HOUR) {
            fs.unlinkSync(filePath);
            console.log(`Cleaned up old clipboard file: ${file}`);
          }
        } catch (err) {
          console.error(`Error processing file ${file}:`, err);
        }
      });
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  /**
   * Start automatic cleanup interval (every 30 minutes)
   */
  startCleanupInterval() {
    // Run cleanup immediately
    this.cleanupOldFiles();

    // Run cleanup every 30 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldFiles();
    }, 30 * 60 * 1000);
  }

  /**
   * Stop cleanup interval
   */
  stopCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get all clipboard formats available
   */
  getAvailableFormats() {
    try {
      const formats = clipboard.availableFormats();
      const hasText = clipboard.readText() !== '';
      const hasImage = !clipboard.readImage().isEmpty();
      const hasHTML = clipboard.readHTML() !== '';

      return {
        success: true,
        formats,
        hasText,
        hasImage,
        hasHTML
      };
    } catch (error) {
      console.error('Error getting available formats:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start monitoring clipboard for changes using native OS events
   * @param {Function} callback - Callback function (type, data)
   * @param {number} watchDelayMs - Debounce delay in ms (default: 500)
   */
  startMonitoring(callback, watchDelayMs = 500) {
    if (this.watcher) {
      console.log('Clipboard monitoring already active');
      return { success: false, error: 'Already monitoring' };
    }

    this.onClipboardChange = callback;

    // Get initial state
    this.lastClipboardText = clipboard.readText() || '';
    const initialImage = clipboard.readImage();
    this.lastClipboardImageHash = !initialImage.isEmpty()
      ? crypto.createHash('md5').update(initialImage.toPNG()).digest('hex')
      : '';

    console.log('[ClipboardManager] Starting native clipboard monitoring (no polling)...');

    try {
      // Start native clipboard watcher
      this.watcher = clipboardWatcher({
        watchDelayMs, // Debounce to avoid rapid-fire events
        onTextChange: (text) => {
          this.handleTextChange(text);
        },
        onImageChange: () => {
          this.handleImageChange();
        }
      });

      console.log('[ClipboardManager] Native clipboard watcher started successfully');
      return { success: true, message: 'Monitoring started' };
    } catch (error) {
      console.error('[ClipboardManager] Failed to start clipboard watcher:', error);
      this.watcher = null;
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle text change event from native clipboard watcher
   */
  handleTextChange(text) {
    try {
      // Avoid duplicate events
      if (text && text !== this.lastClipboardText) {
        this.lastClipboardText = text;
        console.log('[ClipboardManager] Text change detected');

        // Trigger callback
        if (this.onClipboardChange) {
          this.onClipboardChange('TEXT', { content: text });
        }
      }
    } catch (error) {
      console.error('[ClipboardManager] Error handling text change:', error);
    }
  }

  /**
   * Handle image change event from native clipboard watcher
   */
  handleImageChange() {
    try {
      const currentImage = clipboard.readImage();

      if (currentImage.isEmpty()) {
        return;
      }

      const currentHash = crypto.createHash('md5')
        .update(currentImage.toPNG())
        .digest('hex');

      // Avoid duplicate events
      if (currentHash !== this.lastClipboardImageHash) {
        this.lastClipboardImageHash = currentHash;
        console.log('[ClipboardManager] Image change detected');

        // Save image to history directory
        const timestamp = Date.now();
        const randomId = crypto.randomBytes(8).toString('hex');
        const filename = `clipboard-${timestamp}-${randomId}.png`;
        const filePath = path.join(this.historyDir, filename);

        const pngBuffer = currentImage.toPNG();
        fs.writeFileSync(filePath, pngBuffer);

        const size = currentImage.getSize();

        // Trigger callback
        if (this.onClipboardChange) {
          this.onClipboardChange('IMAGE', {
            localPath: filePath,
            metadata: {
              width: size.width,
              height: size.height,
              format: 'png'
            }
          });
        }
      }
    } catch (error) {
      console.error('[ClipboardManager] Error handling image change:', error);
    }
  }

  /**
   * Stop monitoring clipboard
   */
  stopMonitoring() {
    if (this.watcher) {
      try {
        this.watcher.stop();
        this.watcher = null;
        this.onClipboardChange = null;
        console.log('[ClipboardManager] Clipboard monitoring stopped');
        return { success: true, message: 'Monitoring stopped' };
      } catch (error) {
        console.error('[ClipboardManager] Error stopping watcher:', error);
        return { success: false, error: error.message };
      }
    }
    return { success: false, error: 'Not monitoring' };
  }

  /**
   * Check if monitoring is active
   */
  isMonitoring() {
    return this.watcher !== null;
  }
}

module.exports = ClipboardManager;