// Мікрофон для записувача: getUserMedia → AudioContext 16 кГц → AudioWorklet → блоки по 100 мс.
// Обробка браузера (ехоподавлення, шумозаглушення, автопідсилення) вмикається, як у продукті.
import { SAMPLE_RATE } from './wav.js';

/** @returns {Promise<{ id: string, label: string }[]>} */
export async function listMicrophones() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || `Мікрофон ${String(index + 1)}`,
    }));
}

/**
 * @param {{ deviceId?: string, processing: boolean, onFrame: (frame: Float32Array) => void }} options
 */
export async function openMicrophone({ deviceId, processing, onFrame }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1,
      echoCancellation: processing,
      noiseSuppression: processing,
      autoGainControl: processing,
    },
  });
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  if (context.sampleRate !== SAMPLE_RATE) {
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
    throw new Error(`Браузер не дав частоту ${String(SAMPLE_RATE)} Гц. Потрібен Chrome або Edge.`);
  }
  await context.audioWorklet.addModule('capture-worklet.js');
  const source = context.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(context, 'capture');
  // Вузол має бути з'єднаний з виходом, інакше браузер може його не обробляти; гучність 0.
  const silence = context.createGain();
  silence.gain.value = 0;
  source.connect(capture);
  capture.connect(silence);
  silence.connect(context.destination);
  capture.port.onmessage = (event) => {
    onFrame(event.data);
  };

  const track = stream.getAudioTracks()[0];
  return {
    label: track?.label ?? '',
    deviceId: track?.getSettings().deviceId ?? '',
    sampleRate: context.sampleRate,
    async close() {
      capture.port.onmessage = null;
      stream.getTracks().forEach((item) => item.stop());
      await context.close();
    },
  };
}
