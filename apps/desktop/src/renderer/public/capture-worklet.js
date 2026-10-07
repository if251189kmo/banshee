// AudioWorklet вікна звуку (.claude/logic/02-voice.md): звук мікрофона кроками по 1280 відліків —
// 80 мс при 16 кГц, як чекає процес voice. Контекст створено з частотою 16 кГц, тож перетворення
// частоти робить Chromium. Вхід без каналів (потік мікрофона нічого не дає) — тиша, а не пропуск:
// процес voice бачить, що мікрофон мовчить, а не що звук не надходить.

const STEP = 1280;
/** Блок рендерингу Web Audio — 128 відліків. */
const QUANTUM = 128;

class BansheeCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(STEP);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    const frames = channel ? channel.length : QUANTUM;
    let offset = 0;
    while (offset < frames) {
      const count = Math.min(STEP - this.filled, frames - offset);
      if (channel) this.buffer.set(channel.subarray(offset, offset + count), this.filled);
      else this.buffer.fill(0, this.filled, this.filled + count);
      this.filled += count;
      offset += count;
      if (this.filled === STEP) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(STEP);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('banshee-capture', BansheeCapture);
