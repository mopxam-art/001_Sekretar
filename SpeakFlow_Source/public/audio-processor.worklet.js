/**
 * AudioWorklet Processor for streaming audio to WebSocket
 * Runs in a separate audio thread - much more performant than ScriptProcessorNode
 */

class AudioStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) {
      return true; // Keep processor alive
    }

    const inputChannel = input[0];

    // Accumulate samples into buffer
    for (let i = 0; i < inputChannel.length; i++) {
      this.buffer[this.bufferIndex++] = inputChannel[i];

      // When buffer is full, send it
      if (this.bufferIndex >= this.bufferSize) {
        // Convert Float32Array to Int16Array (linear16 PCM)
        const pcmData = new Int16Array(this.bufferSize);
        for (let j = 0; j < this.bufferSize; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          pcmData[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Send to main thread
        this.port.postMessage({
          type: 'audio',
          buffer: pcmData.buffer
        }, [pcmData.buffer]); // Transfer ownership for performance

        // Reset buffer
        this.bufferIndex = 0;
        this.buffer = new Float32Array(this.bufferSize);
      }
    }

    return true; // Keep processor running
  }
}

registerProcessor('audio-stream-processor', AudioStreamProcessor);
