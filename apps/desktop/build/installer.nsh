; Встановлювач Banshee (.claude/logic/01-architecture.md, «Встановлення й оновлення»).
; Макроси electron-builder: тека Banshee за замовчуванням — %LOCALAPPDATA%\Banshee, програма — у її
; підтеці app\, поруч data\, models\, logs\; Program Files, тека Windows і хмарні теки не приймаються;
; системні вимоги — попередження, а не заборона. Видалення лишає дані й моделі.
; Файл — UTF-8 з BOM: так makensis читає українські рядки.

!define MUI_DIRECTORYPAGE_TEXT_TOP "Banshee зберігає все в одній теці: програму, пам'ять, моделі голосу (≈ 0,7 ГБ) і журнали. Підійде будь-який диск, наприклад D:\Banshee.$\r$\n$\r$\nНе підходять: Program Files і тека Windows — туди без прав адміністратора не записати; теки OneDrive, Google Drive, Dropbox — база пам'яті там псується. Для них кнопка «Далі» неактивна."

!macro preInit
  ; Тека за замовчуванням — %LOCALAPPDATA%\Banshee. На сторінці вибору — сама тека Banshee, без app.
  ; Не під час збирання деінсталятора: electron-builder запускає його на ПК розробника.
  !ifndef BUILD_UNINSTALLER
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\${APP_FILENAME}"
  ${Else}
    StrCpy $1 $0 "" -4
    ${If} $1 == "\app"
      StrCpy $0 $0 -4
      WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation $0
    ${EndIf}
  ${EndIf}
  !endif
!macroend

!macro customInstallMode
  ; Лише для поточного користувача: без прав адміністратора.
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  ; Системні вимоги: Windows 10 22H2, 4 ядра, 8 ГБ RAM. Слабший ПК — попередження.
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  ReadEnvStr $1 "NUMBER_OF_PROCESSORS"
  System::Alloc 64
  Pop $2
  System::Call "*$2(i 64)"
  System::Call "kernel32::GlobalMemoryStatusEx(p r2)"
  System::Call "*$2(i, i, l .r3)"
  System::Free $2
  System::Int64Op $3 / 1048576
  Pop $3
  StrCpy $4 ""
  ${If} $0 < 19045
    StrCpy $4 "$4$\r$\n• Windows 10 22H2 (збірка 19045) або новіша — тут збірка $0"
  ${EndIf}
  ${If} $1 < 4
    StrCpy $4 "$4$\r$\n• процесор з 4 ядрами — тут $1"
  ${EndIf}
  ${If} $3 < 7168
    StrCpy $4 "$4$\r$\n• 8 ГБ оперативної пам'яті — тут $3 МБ"
  ${EndIf}
  ; Тихе встановлення (/S, оновлення) сторінок не показує: підтеку app дописуємо тут.
  ${If} ${Silent}
    StrCpy $0 $INSTDIR "" -4
    ${If} $0 != "\app"
      ${StrContains} $1 "${APP_FILENAME}" $INSTDIR
      ${If} $1 == ""
        StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
      ${EndIf}
      StrCpy $INSTDIR "$INSTDIR\app"
    ${EndIf}
  ${EndIf}
  ${If} $4 != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "Цей ПК слабший за мінімальні вимоги Banshee:$4$\r$\n$\r$\nBanshee встановиться, але може працювати повільно." /SD IDOK
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  ; Після вибору теки: програма — у підтеці app теки Banshee. Сторінку не показуємо.
  Page custom bansheeAppDir

  Function bansheeAppDir
    StrCpy $0 $INSTDIR "" -4
    ${If} $0 != "\app"
      ${StrContains} $1 "${APP_FILENAME}" $INSTDIR
      ${If} $1 == ""
        StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
      ${EndIf}
      StrCpy $INSTDIR "$INSTDIR\app"
    ${EndIf}
    Abort
  FunctionEnd

  Function .onVerifyInstDir
    ; Program Files, тека Windows і хмарні теки — «Далі» неактивна (пояснення — над полем).
    StrLen $1 $PROGRAMFILES64
    StrCpy $0 $INSTDIR $1
    ${If} $0 == $PROGRAMFILES64
      Abort
    ${EndIf}
    StrLen $1 $PROGRAMFILES32
    StrCpy $0 $INSTDIR $1
    ${If} $0 == $PROGRAMFILES32
      Abort
    ${EndIf}
    StrLen $1 $WINDIR
    StrCpy $0 $INSTDIR $1
    ${If} $0 == $WINDIR
      Abort
    ${EndIf}
    ${StrContains} $0 "\OneDrive" $INSTDIR
    ${If} $0 != ""
      Abort
    ${EndIf}
    ${StrContains} $0 "\Google Drive" $INSTDIR
    ${If} $0 != ""
      Abort
    ${EndIf}
    ${StrContains} $0 "\My Drive" $INSTDIR
    ${If} $0 != ""
      Abort
    ${EndIf}
    ${StrContains} $0 "\Dropbox" $INSTDIR
    ${If} $0 != ""
      Abort
    ${EndIf}
    ${StrContains} $0 "\iCloudDrive" $INSTDIR
    ${If} $0 != ""
      Abort
    ${EndIf}
  FunctionEnd
!macroend

!macro customUnInstall
  ; Автозапуск прибираємо разом із програмою. Пам'ять, моделі й журнали лишаються в теці Banshee:
  ; перевстановлення їх не стирає й не качає моделі вдруге. Повне видалення — «Про програму».
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Banshee"
!macroend
