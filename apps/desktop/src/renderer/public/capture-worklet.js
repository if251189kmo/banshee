// AudioWorklet вікна звуку (.claude/logic/02-voice.md): звук мікрофона кроками по 1280 відліків —
// 80 мс при 16 кГц, як чекає процес voice. Контекст створено з частотою 16 кГц, тож перетворення
// частоти робить Chromium.

const STEP = 1280;

class BansheeCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(STEP);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const count = Math.min(STEP - this.filled, channel.length - offset);
        this.buffer.set(channel.subarray(offset, offset + count), this.filled);
        this.filled += count;
        offset += count;
        if (this.filled === STEP) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(STEP);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('banshee-capture', BansheeCapture);
