// AudioWorklet: збирає звук мікрофона блоками по 100 мс і передає їх сторінці.
// Контекст створено з частотою 16 кГц, тож перетворення частоти робить браузер.

const BLOCK = 1600;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BLOCK);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const count = Math.min(BLOCK - this.filled, channel.length - offset);
        this.buffer.set(channel.subarray(offset, offset + count), this.filled);
        this.filled += count;
        offset += count;
        if (this.filled === BLOCK) {
          this.port.postMessage(this.buffer);
          this.buffer = new Float32Array(BLOCK);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
