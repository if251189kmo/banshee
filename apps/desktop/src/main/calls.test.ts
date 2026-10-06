import { describe, expect, it } from 'vitest';
import { inCall, micUsers } from './calls.ts';

const ROOT =
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

const OUTPUT = [
  ROOT,
  '    Value    REG_SZ    Allow',
  '',
  `${ROOT}\\MSTeams_8wekyb3d8bbwe`,
  '    Value    REG_SZ    Allow',
  '    LastUsedTimeStart    REG_QWORD    0x1dd5387583f8398',
  '    LastUsedTimeStop    REG_QWORD    0x0',
  '',
  `${ROOT}\\NonPackaged\\C:#Program Files (x86)#Steam#steam.exe`,
  '    LastUsedTimeStart    REG_QWORD    0x1db858cd2c7e722',
  '    LastUsedTimeStop    REG_QWORD    0x1db858cd3151d96',
  '',
  `${ROOT}\\NonPackaged\\D:#Banshee#app#Banshee.exe`,
  '    LastUsedTimeStart    REG_QWORD    0x1dd5387583f8398',
  '    LastUsedTimeStop    REG_QWORD    0x0',
  '',
].join('\r\n');

describe('дзвінки', () => {
  it('бачить, хто тримає мікрофон зараз', () => {
    expect(micUsers(OUTPUT)).toEqual(['msteams_8wekyb3d8bbwe', 'banshee.exe']);
  });

  it('дзвінок — програма зв’язку, а не сам Banshee', () => {
    expect(inCall(micUsers(OUTPUT))).toBe(true);
    expect(inCall(['banshee.exe'])).toBe(false);
    expect(inCall(['electron.exe', 'steam.exe'])).toBe(false);
    expect(inCall(['discord.exe'])).toBe(true);
  });
});
