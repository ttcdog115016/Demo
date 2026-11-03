; Open-PETs 單機版安裝程式（Inno Setup 6）
; 由 build_exe.ps1 呼叫：ISCC /DAppVersion=<版本> /DSourceDir=<dist\OpenPETs> /DOutputDir=<dist> OpenPETs.iss
; 只裝給目前使用者（%LOCALAPPDATA%\Programs\OpenPETs），不需要系統管理員權限。
; 資料（.env、帳號、稽核紀錄）由程式寫到 %LOCALAPPDATA%\OpenPETs，解除安裝不刪，避免鹽值與帳號遺失。

#ifndef AppVersion
  #define AppVersion "2.0.1"
#endif
#ifndef SourceDir
  #define SourceDir "dist\OpenPETs"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#define AppName "Open-PETs 資料隱私保護工具"

[Setup]
; AppId 固定不變：升級安裝時才會覆蓋同一份
AppId={{C6B6B812-0898-430D-B713-CFDF9B837F8E}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=TTC
DefaultDirName={autopf}\OpenPETs
DefaultGroupName=Open-PETs
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=OpenPETs_Setup_{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\OpenPETs.exe
UninstallDisplayName={#AppName}
; 安裝／解除安裝時若 Open-PETs 正在執行，提示關閉
CloseApplications=yes

[Languages]
#if FileExists(AddBackslash(CompilerPath) + "Languages\ChineseTraditional.isl")
Name: "zh"; MessagesFile: "compiler:Languages\ChineseTraditional.isl"
#else
Name: "en"; MessagesFile: "compiler:Default.isl"
#endif

[Tasks]
Name: "desktopicon"; Description: "建立桌面捷徑"; GroupDescription: "其他選項："

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Open-PETs\Open-PETs 資料隱私保護工具"; Filename: "{app}\OpenPETs.exe"
Name: "{autoprograms}\Open-PETs\重設帳號密碼"; Filename: "{app}\OpenPETs-cli.exe"; Parameters: "reset-password"
Name: "{autoprograms}\Open-PETs\使用說明"; Filename: "{app}\使用說明.txt"
Name: "{autoprograms}\Open-PETs\資料與設定資料夾"; Filename: "{localappdata}\OpenPETs"
Name: "{autodesktop}\Open-PETs"; Filename: "{app}\OpenPETs.exe"; Tasks: desktopicon

[Dirs]
; 先建立資料夾，「資料與設定資料夾」捷徑在第一次啟動前也能開
Name: "{localappdata}\OpenPETs"; Flags: uninsneveruninstall

[Run]
Filename: "{app}\OpenPETs.exe"; Description: "立即開啟 Open-PETs"; Flags: nowait postinstall skipifsilent
