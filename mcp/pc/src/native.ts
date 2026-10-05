// Нативні виклики Windows для PowerShell через Add-Type: гучність (Core Audio), медіаклавіші й вікна
// (user32). Компілюються один раз на процес PowerShell; Build Tools не потрібні — компілятор C#
// є в .NET Framework кожної Windows 10 і 11.

/** Гучність і вимкнення звуку типових динаміків (IAudioEndpointVolume). */
export const AUDIO_TYPE = String.raw`
if (-not ('BansheeAudio' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr notify);
  int UnregisterControlChangeNotify(IntPtr notify);
  int GetChannelCount(out int count);
  int SetMasterVolumeLevel(float level, Guid context);
  int SetMasterVolumeLevelScalar(float level, Guid context);
  int GetMasterVolumeLevel(out float level);
  int GetMasterVolumeLevelScalar(out float level);
  int SetChannelVolumeLevel(uint channel, float level, Guid context);
  int SetChannelVolumeLevelScalar(uint channel, float level, Guid context);
  int GetChannelVolumeLevel(uint channel, out float level);
  int GetChannelVolumeLevelScalar(uint channel, out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid context);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object endpoint);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
public static class BansheeAudio {
  static IAudioEndpointVolume Endpoint() {
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
    Guid id = typeof(IAudioEndpointVolume).GUID;
    object endpoint;
    Marshal.ThrowExceptionForHR(device.Activate(ref id, 23, IntPtr.Zero, out endpoint));
    return (IAudioEndpointVolume)endpoint;
  }
  public static float Level {
    get { float level; Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out level)); return level; }
    set { Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(value, Guid.Empty)); }
  }
  public static bool Muted {
    get { bool muted; Marshal.ThrowExceptionForHR(Endpoint().GetMute(out muted)); return muted; }
    set { Marshal.ThrowExceptionForHR(Endpoint().SetMute(value, Guid.Empty)); }
  }
}
'@
}`;

/** Медіаклавіші й вікна через user32. */
export const USER32_TYPE = String.raw`
if (-not ('BansheeUser32' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BansheeUser32 {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static void Press(byte vk) { keybd_event(vk, 0, 1, UIntPtr.Zero); keybd_event(vk, 0, 3, UIntPtr.Zero); }
}
'@
}`;

/** Віртуальні коди медіаклавіш. Відтворення й пауза — одна клавіша-перемикач. */
export const MEDIA_KEYS = { play: 0xb3, pause: 0xb3, next: 0xb0, previous: 0xb1 } as const;

/** Команди ShowWindow. */
export const SHOW_WINDOW = { show: 9, minimize: 6, maximize: 3 } as const;

/** Системні програми за сталими AppID: на українській Windows їхні назви в «Пуску» перекладені. */
export const SYSTEM_APPS: Readonly<Record<string, string>> = {
  calculator: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',
  notepad: String.raw`{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\notepad.exe`,
  paint: String.raw`{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\mspaint.exe`,
  'file explorer': 'Microsoft.Windows.Explorer',
  explorer: 'Microsoft.Windows.Explorer',
  'task manager': String.raw`{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\Taskmgr.exe`,
  settings: 'windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel',
  'command prompt': String.raw`{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\cmd.exe`,
  'windows powershell': String.raw`{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe`,
};

/** Процеси, які Banshee не закриває: без них зникне робочий стіл або впаде сесія. */
export const PROTECTED_PROCESSES: ReadonlySet<string> = new Set([
  'explorer',
  'dwm',
  'csrss',
  'winlogon',
  'wininit',
  'lsass',
  'services',
  'svchost',
  'smss',
  'system',
  'fontdrvhost',
  'sihost',
  'ctfmon',
]);
