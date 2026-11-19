; Open-PETs 單機版安裝程式（Inno Setup 6）
; 由 build_exe.ps1 呼叫：ISCC /DAppVersion=<版本> /DSourceDir=<dist\OpenPETs> /DOutputDir=<dist> OpenPETs.iss
; 只裝給目前使用者（%LOCALAPPDATA%\Programs\OpenPETs），不需要系統管理員權限。
; 資料（.env、帳號、稽核紀錄）由程式寫到 %LOCALAPPDATA%\OpenPETs，解除安裝不刪，避免鹽值與帳號遺失。
; 重新安裝或升級時，若偵測到既有資料，安裝程式會詢問是否「還原初始設定」（預設是）：
;   還原＝把整個資料夾改名備份為 OpenPETs.backup-<時間戳記>，再建立全新的資料夾，
;   下次開啟會重新產生 .env（鹽值與金鑰）並顯示「建立系統管理員」畫面。不勾選則沿用原本的資料。
; 靜默安裝（/SILENT、/VERYSILENT）沒有指定時一律沿用原本的資料；要還原請加 /RESETDATA=1（明確不還原：/RESETDATA=0）。
; 測試用參數（正式安裝不要用）：/DataDir=<資料夾> 改用別的資料夾；建置時 /DAppIdValue=... 與 /DTestMode=1
; 讓測試版使用獨立的 AppId、且不建立開始功能表與桌面捷徑，不會動到本機已安裝的 Open-PETs。

#ifndef AppVersion
  #define AppVersion "2.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\OpenPETs"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef AppIdValue
  #define AppIdValue "{{C6B6B812-0898-430D-B713-CFDF9B837F8E}"
#endif
#define AppName "Open-PETs 資料隱私保護工具"

[Setup]
; AppId 固定不變：升級安裝時才會覆蓋同一份
AppId={#AppIdValue}
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

#ifndef TestMode
[Icons]
Name: "{autoprograms}\Open-PETs\Open-PETs 資料隱私保護工具"; Filename: "{app}\OpenPETs.exe"
Name: "{autoprograms}\Open-PETs\重設帳號密碼"; Filename: "{app}\OpenPETs-cli.exe"; Parameters: "reset-password"
Name: "{autoprograms}\Open-PETs\使用說明"; Filename: "{app}\使用說明.txt"
Name: "{autoprograms}\Open-PETs\資料與設定資料夾"; Filename: "{code:GetDataDir}"
Name: "{autodesktop}\Open-PETs"; Filename: "{app}\OpenPETs.exe"; Tasks: desktopicon
#endif

[Dirs]
; 先建立資料夾，「資料與設定資料夾」捷徑在第一次啟動前也能開
Name: "{code:GetDataDir}"; Flags: uninsneveruninstall

[Run]
Filename: "{app}\OpenPETs.exe"; Description: "立即開啟 Open-PETs"; Flags: nowait postinstall skipifsilent

[Code]
var
  ResetPage: TInputOptionWizardPage;

{ 資料夾位置。正式安裝一律是 %LOCALAPPDATA%\OpenPETs（與 launcher.py 一致）；/DataDir= 只供測試。 }
function GetDataDir(Param: String): String;
begin
  Result := ExpandConstant('{param:DataDir|}');
  if Result = '' then
    Result := ExpandConstant('{localappdata}\OpenPETs');
end;

{ 已經有資料才需要問：.env 或 data\ 任一存在（launcher 第一次執行時會建立這兩者）。 }
function HasExistingData: Boolean;
var
  D: String;
begin
  D := GetDataDir('');
  Result := FileExists(D + '\.env') or DirExists(D + '\data');
end;

function ResetParam: String;
begin
  Result := ExpandConstant('{param:RESETDATA|}');
end;

procedure InitializeWizard;
begin
  ResetPage := CreateInputOptionPage(wpSelectTasks,
    '還原初始設定',
    '這台電腦已經有 Open-PETs 的資料（帳號、設定、稽核紀錄）。',
    '要把 Open-PETs 還原成剛安裝的狀態，重新建立第一個管理員嗎？' + #13#10 +
    '還原時，既有資料夾會先改名備份成「OpenPETs.backup-日期時間」（與原資料夾同一層，不會刪除），' +
    '之後可自行復原或刪除；還原後會重新產生鹽值與金鑰，舊的雜湊結果將與新的對不上。' + #13#10 +
    '不勾選則沿用原本的帳號與設定。',
    False, False);
  ResetPage.Add('還原初始設定（既有資料先備份）');
  ResetPage.Values[0] := True;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if (ResetPage <> nil) and (PageID = ResetPage.ID) then
    { 沒有既有資料、或命令列已用 /RESETDATA 指定時，不必問 }
    Result := (not HasExistingData) or (ResetParam <> '');
end;

function WantReset: Boolean;
begin
  if ResetParam = '1' then
    Result := True
  else if ResetParam = '0' then
    Result := False
  else if WizardSilent then
    Result := False  { 靜默安裝沒有指定時保守沿用原本的資料 }
  else
    Result := ResetPage.Values[0];
end;

procedure BackupAndResetData;
var
  D, B: String;
begin
  D := GetDataDir('');
  B := D + '.backup-' + GetDateTimeString('yyyymmdd-hhnnss', #0, #0);
  if DirExists(B) then
    B := B + '-2';
  if RenameFile(D, B) then
    Log('已還原初始設定，既有資料備份於：' + B)
  else
  begin
    Log('無法改名備份既有資料夾，本次不還原：' + D);
    MsgBox('無法備份既有資料夾（可能 Open-PETs 還在執行，或檔案正被占用），這次不會還原，會沿用原本的資料。' + #13#10 +
           '請關閉 Open-PETs 後重新執行安裝程式。', mbError, MB_OK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  { ssInstall：安裝程式即將開始複製檔案，也在建立資料夾之前；此時改名，之後 [Dirs] 會建立全新的空資料夾。 }
  if (CurStep = ssInstall) and HasExistingData and WantReset then
    BackupAndResetData;
end;
