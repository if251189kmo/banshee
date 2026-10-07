import { describe, expect, it } from 'vitest';
import { deviceNames, plainName, resolveDevice, type DeviceInfo } from './audio-devices.ts';

const JBL = 'Headset (JBL TUNE710BT Hands-Free AG Audio) (Bluetooth)';
const REALTEK = 'Microphone (Realtek High Definition Audio)';
const MONITOR = '24G2W1G4 (NVIDIA High Definition Audio)';

/** Як дає enumerateDevices у Chromium на Windows: «типовий», «для зв'язку», далі справжні. */
const DEVICES: DeviceInfo[] = [
  { deviceId: 'default', kind: 'audioinput', label: `Default - ${JBL}`, groupId: 'g-jbl' },
  { deviceId: 'communications', kind: 'audioinput', label: `Communications - ${JBL}`, groupId: 'g-jbl' },
  { deviceId: 'id-jbl', kind: 'audioinput', label: JBL, groupId: 'g-jbl' },
  { deviceId: 'id-realtek', kind: 'audioinput', label: REALTEK, groupId: 'g-realtek' },
  { deviceId: 'default', kind: 'audiooutput', label: `Default - ${MONITOR}`, groupId: 'g-mon' },
  { deviceId: 'id-mon', kind: 'audiooutput', label: MONITOR, groupId: 'g-mon' },
];

describe('пристрої звуку', () => {
  it('назви без псевдозаписів Chromium і типовий пристрій Windows', () => {
    expect(deviceNames(DEVICES, 'audioinput')).toEqual({ names: [JBL, REALTEK], defaultName: JBL });
    expect(deviceNames(DEVICES, 'audiooutput')).toEqual({ names: [MONITOR], defaultName: MONITOR });
  });

  it('типовий — за назвою, коли groupId не збігся; префікс будь-якою мовою', () => {
    const localized = DEVICES.map((device) =>
      device.deviceId === 'default' && device.kind === 'audioinput'
        ? { ...device, label: `За замовчуванням – ${REALTEK}`, groupId: '' }
        : device,
    );
    expect(deviceNames(localized, 'audioinput').defaultName).toBe(REALTEK);
    expect(plainName(`За замовчуванням – ${REALTEK}`, localized, 'audioinput')).toBe(REALTEK);
  });

  it('без дозволу Chromium не дає назв — списку немає', () => {
    const hidden = DEVICES.map((device) => ({ ...device, label: '' }));
    expect(deviceNames(hidden, 'audioinput')).toEqual({ names: [], defaultName: null });
  });

  it('обраний мікрофон — за назвою; старе значення — за id; немає — типовий Windows', () => {
    expect(resolveDevice('default', DEVICES, 'audioinput')).toEqual({
      deviceId: null,
      fallback: false,
    });
    expect(resolveDevice(REALTEK, DEVICES, 'audioinput')).toEqual({
      deviceId: 'id-realtek',
      fallback: false,
    });
    expect(resolveDevice('id-jbl', DEVICES, 'audioinput')).toEqual({
      deviceId: 'id-jbl',
      fallback: false,
    });
    expect(resolveDevice('USB Microphone', DEVICES, 'audioinput')).toEqual({
      deviceId: null,
      fallback: true,
    });
    expect(resolveDevice(MONITOR, DEVICES, 'audioinput').fallback).toBe(true);
    expect(resolveDevice(MONITOR, DEVICES, 'audiooutput').deviceId).toBe('id-mon');
  });
});
