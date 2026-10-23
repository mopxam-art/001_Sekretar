/**
 * Screen Capture IPC Handlers
 * Скриншоты для Vision AI, desktop capturer
 */

const { ipcMain, desktopCapturer } = require('electron');

// Lazy loading - модули загружаются только при первом использовании
let nodeScreenshots = null;
let sharp = null;

function registerScreenCaptureHandlers(deps) {
  // ============ DESKTOP CAPTURER ============
  ipcMain.handle('get-desktop-sources', async (event, options) => {
    try {
      const sources = await desktopCapturer.getSources(options);
      return sources;
    } catch (error) {
      console.error('[IPC] Error getting desktop sources:', error);
      throw error;
    }
  });

  // ============ SCREEN CAPTURE (Vision AI) ============
  ipcMain.handle('capture-screen', async (event, mode, options = {}) => {
    // Lazy load node-screenshots только когда реально нужно
    if (!nodeScreenshots) {
      try {
        nodeScreenshots = require('node-screenshots');
        console.log('[IPC] node-screenshots loaded on demand');
      } catch (error) {
        console.error('[IPC] Failed to load node-screenshots:', error.message);
        throw new Error('node-screenshots not available');
      }
    }

    try {
      const { Monitor, Window } = nodeScreenshots;
      let buffer;

      switch (mode) {
        case 'active-window': {
          const windows = Window.all();

          console.log('[IPC] All windows:', windows.map((w, i) => ({
            index: i,
            title: w.title,
            isMinimized: w.isMinimized,
            id: w.id
          })));

          const activeWindow = windows.find(w =>
            !w.isMinimized &&
            !w.title.includes('SpeakFlow') &&
            !w.title.includes('Echo')
          ) || windows.find(w => !w.isMinimized);

          if (!activeWindow) {
            throw new Error('No active window found');
          }
          console.log(`[IPC] Capturing active window: "${activeWindow.title}"`);
          const image = activeWindow.captureImageSync();
          buffer = image.toPngSync();
          break;
        }

        case 'fullscreen': {
          const monitor = Monitor.fromPoint(0, 0);
          console.log('[IPC] Capturing fullscreen (primary monitor)');
          const image = monitor.captureImageSync();
          buffer = image.toPngSync();
          break;
        }

        case 'region': {
          const { x, y, width, height } = options;
          const monitor = Monitor.fromPoint(x, y);
          const fullImage = monitor.captureImageSync();
          const croppedImage = await fullImage.crop(x, y, width, height);
          buffer = croppedImage.toPngSync();
          console.log(`[IPC] Captured region: ${x},${y} ${width}x${height}`);
          break;
        }

        default:
          throw new Error(`Unknown capture mode: ${mode}`);
      }

      // Compress image for faster Vision AI processing
      const compress = options.compress !== false;
      let finalBuffer = buffer;

      if (compress) {
        // Lazy load sharp
        if (!sharp) {
          try {
            sharp = require('sharp');
            console.log('[IPC] sharp loaded on demand');
          } catch (error) {
            console.warn('[IPC] sharp not available, using uncompressed image');
          }
        }

        if (sharp) {
          try {
            const originalSize = buffer.length;
            finalBuffer = await sharp(buffer)
              .resize(1920, null, { withoutEnlargement: true })
              .jpeg({ quality: 80 })
              .toBuffer();
            const compressedSize = finalBuffer.length;
            console.log(`[IPC] Compressed: ${(originalSize / 1024).toFixed(0)} KB -> ${(compressedSize / 1024).toFixed(0)} KB (${((1 - compressedSize / originalSize) * 100).toFixed(0)}% reduction)`);
          } catch (compressError) {
            console.warn('[IPC] Compression failed, using original:', compressError.message);
            finalBuffer = buffer;
          }
        }
      }

      const base64 = finalBuffer.toString('base64');
      console.log(`[IPC] Screenshot captured, size: ${(base64.length / 1024).toFixed(2)} KB`);
      return base64;
    } catch (error) {
      console.error('[IPC] Screen capture failed:', error);
      throw error;
    }
  });

  console.log('[IPC:ScreenCapture] Handlers registered');
}

module.exports = { registerScreenCaptureHandlers };
