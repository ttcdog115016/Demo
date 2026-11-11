<#
Open-PETs 安裝與模式切換小工具（Windows PowerShell 5.1 以上）

最常用的三個指令（在這個檔案所在的資料夾開啟 PowerShell 執行）：
  .\open-pets.ps1 setup                  第一次安裝：用問答幫你選模式、填網址、啟動、建立管理員
  .\open-pets.ps1 mode local|lan|online  切換模式（本地／內網／線上），資料不會不見
  .\open-pets.ps1 status                 看目前是什麼模式、有沒有在運作、要開哪個網址

其他指令：start、stop、logs、create-admin、reset-password、export-ca、backup、update <版本>、help
進階參數：-Mode、-Hosts、-Version、-Port、-HttpsPort、-ContainerName、-ProjectName、-Image、-Yes（全部用預設值、不詢問）

這個工具只做三件事：寫同資料夾的 .env、需要時下載缺少的設定檔、呼叫 docker compose。
它不會修改這台電腦的系統設定（防火牆規則只在你是系統管理員並且按 Y 確認時才會建立；憑證信任由各台電腦自己安裝）。
#>
param(
    [Parameter(Position = 0)][string]$Command = 'help',
    [Parameter(Position = 1)][string]$Arg1 = '',
    [string]$Mode = '',
    [string]$Hosts = '',
    [string]$Version = '',
    [int]$Port = 0,
    [int]$HttpsPort = 0,
    [string]$ContainerName = '',
    [string]$ProjectName = '',
    [string]$Image = '',
    [switch]$Yes,
    [switch]$NoCreateAdmin,
    [switch]$NoBackup
)

$ErrorActionPreference = 'Continue'
$Script:Dir = $PSScriptRoot
if (-not $Script:Dir) { $Script:Dir = (Get-Location).Path }
$Script:EnvFile = Join-Path $Script:Dir '.env'
$Script:ReleaseBase = 'https://github.com/ttcdog115016/Demo/releases/download'
$Script:GhcrImage = 'ghcr.io/ttcdog115016/open-pets-app'
$Script:DefaultVersion = '__DEFAULT_VERSION__'   # 發佈時由打包流程換成該版本；開發時保持原樣＝不預設版本
if ($Script:DefaultVersion -like '__*') { $Script:DefaultVersion = '' }
$Script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

# ------------------------------------------------------------------ 輸出
function Say([string]$text, [string]$color = 'White') { Write-Host $text -ForegroundColor $color }
function Title([string]$text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "  [完成] $text" -ForegroundColor Green }
function Note([string]$text) { Write-Host "  $text" -ForegroundColor Gray }
function Warn([string]$text) { Write-Host "  [注意] $text" -ForegroundColor Yellow }
function Stop-Tool([string]$what, [string[]]$fixes) {
    Write-Host ''
    Write-Host "[無法繼續] $what" -ForegroundColor Red
    foreach ($f in $fixes) { Write-Host "  → $f" -ForegroundColor Yellow }
    exit 1
}
function Ask([string]$prompt, [string]$default = '') {
    if ($Yes) { return $default }
    $suffix = ''
    if ($default) { $suffix = "（直接按 Enter＝$default）" }
    $answer = Read-Host "$prompt$suffix"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $default }
    return $answer.Trim()
}
function Confirm-Step([string]$prompt) {
    if ($Yes) { return $true }
    $answer = Read-Host "$prompt（輸入 Y 繼續，其他任何輸入都取消）"
    return ($answer -match '^[Yy]')
}

# ------------------------------------------------------------------ .env
function Read-EnvMap {
    $map = [ordered]@{}
    if (Test-Path $Script:EnvFile) {
        foreach ($line in [System.IO.File]::ReadAllLines($Script:EnvFile)) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { $map[$Matches[1]] = $Matches[2].Trim() }
        }
    }
    return $map
}
# 更新或新增指定的設定；其他行（包含你自己加的設定與註解）原樣保留。寫成沒有 BOM 的 UTF-8，compose 才讀得到第一行。
function Set-EnvValues([hashtable]$updates, [string[]]$remove = @()) {
    $lines = @()
    if (Test-Path $Script:EnvFile) { $lines = [System.IO.File]::ReadAllLines($Script:EnvFile) }
    $done = @{}
    $out = New-Object System.Collections.ArrayList
    foreach ($line in $lines) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
            $key = $Matches[1]
            if ($remove -contains $key) { continue }
            if ($updates.ContainsKey($key)) { [void]$out.Add("$key=$($updates[$key])"); $done[$key] = $true; continue }
        }
        [void]$out.Add($line)
    }
    foreach ($key in $updates.Keys) { if (-not $done.ContainsKey($key)) { [void]$out.Add("$key=$($updates[$key])") } }
    [System.IO.File]::WriteAllText($Script:EnvFile, (($out -join "`n") + "`n"), $Script:Utf8NoBom)
}

# ------------------------------------------------------------------ Docker 與檢查
function Test-DockerReady {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Stop-Tool '找不到 Docker：這台電腦還沒有安裝 Docker Desktop。' @(
            '到 https://www.docker.com/products/docker-desktop/ 下載並安裝 Docker Desktop（安裝時選用 WSL 2）。',
            '安裝後重新開機，開啟 Docker Desktop，等左下角顯示 Engine running（綠色），再重新執行這個工具。')
    }
    $server = & docker version --format '{{.Server.Version}}' 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($server)) {
        Stop-Tool 'Docker 沒有在執行（連不到 Docker 引擎）。' @(
            '開啟 Docker Desktop，等左下角顯示 Engine running（綠色）。剛開機時可能要等一兩分鐘。',
            '在 PowerShell 執行 docker version，「Server」那一段要有版本資訊，再重新執行這個工具。')
    }
    & docker compose version 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Stop-Tool '這個 Docker 沒有 Compose 功能。' @('請更新 Docker Desktop 到最新版（新版內建 docker compose）。')
    }
}
function Test-PortBusy([int]$p) { return [bool](Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) }
function Find-FreePort([int]$start) {
    for ($p = $start; $p -lt ($start + 60); $p++) { if (-not (Test-PortBusy $p)) { return $p } }
    return 0
}
function Get-ContainerInfo([string]$name) {
    # 注意：不能在 --format 裡寫雙引號（Windows PowerShell 5.1 會把引號吃掉），所以用 {{.Labels}} 再自己解析
    $filter = ('name=^/{0}$' -f $name)
    $line = & docker ps -a --filter $filter --format '{{.Names}}|{{.Status}}|{{.Labels}}' 2>$null
    if (-not $line) { return $null }
    $text = [string]($line | Select-Object -First 1)
    $parts = $text.Split('|', 3)
    $project = ''
    $workDir = ''
    if ($parts[2] -match 'com\.docker\.compose\.project=([^,]*)') { $project = $Matches[1] }
    if ($parts[2] -match 'com\.docker\.compose\.project\.working_dir=([^,]*)') { $workDir = $Matches[1] }
    return [pscustomobject]@{ Name = $parts[0]; Status = $parts[1]; Project = $project; WorkDir = $workDir }
}
function Get-ProjectName {
    $envMap = Read-EnvMap
    if ($ProjectName) { return $ProjectName }
    if ($envMap.Contains('COMPOSE_PROJECT_NAME')) { return $envMap['COMPOSE_PROJECT_NAME'] }
    return 'open-pets'
}
function Test-SameDir([string]$a, [string]$b) {
    if (-not $a -or -not $b) { return $false }
    return (($a.TrimEnd('\', '/') -replace '\\', '/') -ieq ($b.TrimEnd('\', '/') -replace '\\', '/'))
}
function Test-OwnContainer($info) {
    if (-not $info) { return $false }
    return (($info.Project -eq (Get-ProjectName)) -and (Test-SameDir $info.WorkDir $Script:Dir))
}
function Invoke-Compose([string[]]$ComposeArgs) {
    Push-Location $Script:Dir
    # | Out-Host：讓 docker 的輸出直接顯示在畫面上，函式只回傳結束代碼（不然輸出會混進回傳值）
    try { & docker compose @ComposeArgs | Out-Host; return $LASTEXITCODE } finally { Pop-Location }
}
function Wait-Healthy([string]$container, [int]$timeoutSeconds = 150) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while ($watch.Elapsed.TotalSeconds -lt $timeoutSeconds) {
        $state = & docker inspect --format '{{.State.Health.Status}}' $container 2>$null
        if ($state -eq 'healthy') { Write-Host ''; return $true }
        if ($state -eq 'unhealthy') { break }
        Write-Host -NoNewline '.'
        Start-Sleep -Seconds 3
    }
    Write-Host ''
    return $false
}

# ------------------------------------------------------------------ 輸入檢查
function ConvertTo-HostList([string]$text) {
    $clean = (($text -split '\s*,\s*') | Where-Object { $_ -ne '' }) -join ','
    return $clean.Trim()
}
function Test-HostList([string]$list) {
    if ([string]::IsNullOrWhiteSpace($list)) { return '還沒有填網址。' }
    if ($list -match '[:/\s]') { return '網址只要寫主機名稱或 IP（例如 192.168.1.20），不要加 http://、https://、斜線、埠號或空格。多個請用逗號分隔。' }
    foreach ($h in $list.Split(',')) {
        if ($h -notmatch '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$') { return "「$h」不是正確的主機名稱或 IP。" }
    }
    return ''
}
function Get-LanIPs {
    $found = @()
    try {
        $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object {
            $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and
            $_.InterfaceAlias -notmatch 'vEthernet|WSL|Docker|Loopback|VMware|VirtualBox|Hyper-V|Bluetooth'
        }
        foreach ($a in $addresses) { $found += [pscustomobject]@{ IP = $a.IPAddress; Name = $a.InterfaceAlias } }
    } catch {}
    return $found
}
function Test-Mode([string]$m) { return @('local', 'lan', 'online') -contains $m }
function Get-ModeLabel([string]$m) {
    switch ($m) { 'local' { return '本地' } 'lan' { return '內網' } 'online' { return '線上' } default { return $m } }
}
function Get-ComposeFileValue([string]$m) {
    switch ($m) {
        'lan' { return 'docker-compose.yml:docker-compose.lan.yml' }
        'online' { return 'docker-compose.yml:docker-compose.online.yml' }
        default { return 'docker-compose.yml' }
    }
}

# ------------------------------------------------------------------ 取得設定檔與映像檔
function Get-DefaultVersion {
    $envMap = Read-EnvMap
    if ($Version) { return $Version }
    if ($envMap.Contains('OPEN_PETS_VERSION')) { return $envMap['OPEN_PETS_VERSION'] }
    $tar = Get-ChildItem -Path $Script:Dir -Filter 'open-pets-app_*.tar.gz' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($tar -and $tar.Name -match '^open-pets-app_(.+)\.tar\.gz$') { return $Matches[1] }
    return $Script:DefaultVersion
}
function Confirm-Files([string]$mode, [string]$ver) {
    $need = @('docker-compose.yml')
    if ($mode -eq 'lan') { $need += @('docker-compose.lan.yml', 'Caddyfile.lan') }
    if ($mode -eq 'online') { $need += 'docker-compose.online.yml' }
    foreach ($f in $need) {
        $path = Join-Path $Script:Dir $f
        if (Test-Path $path) { continue }
        if (-not $ver) { Stop-Tool "資料夾裡缺少 $f，又不知道要下載哪一版。" @('請加上 -Version 2.0.0-rc3（換成你要的版本）再執行一次。') }
        $url = "$($Script:ReleaseBase)/v$ver/$f"
        Note "下載 $f ..."
        try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $path -ErrorAction Stop }
        catch {
            Stop-Tool "下載不到 $f（$url）。" @(
                '確認這台電腦連得上網路，以及版本號有沒有打對（到 GitHub 的 Releases 頁看，不含開頭的 v）。',
                "注意：${f} 是 2.0.0-rc2 之後的版本才有；rc2（含）以前沒有內網與模式切換的檔案。",
                '沒有網路的話，請改用離線交付包（裡面已經有全部檔案），把檔案放在這個資料夾。')
        }
    }
}
# 決定映像檔從哪來：本機已有 → 直接用；資料夾有離線 tar.gz → 匯入；否則從 GHCR 下載
function Resolve-Image([string]$ver) {
    $result = @{ Name = ''; Pull = $false }
    if ($Image) {
        $result.Name = $Image
        & docker image inspect "${Image}:$ver" 2>$null | Out-Null
        $result.Pull = ($LASTEXITCODE -ne 0)
        return $result
    }
    & docker image inspect "open-pets-app:$ver" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $result.Name = 'open-pets-app'; return $result }
    $tar = Join-Path $Script:Dir "open-pets-app_$ver.tar.gz"
    if (Test-Path $tar) {
        Note "匯入資料夾裡的離線映像檔（open-pets-app_$ver.tar.gz），約需一兩分鐘 ..."
        & docker load -i $tar | Out-Host
        if ($LASTEXITCODE -ne 0) { Stop-Tool '匯入離線映像檔失敗（檔案可能不完整）。' @('重新複製或下載一次，並核對 SHA256SUMS.txt。') }
        $result.Name = 'open-pets-app'
        return $result
    }
    $result.Name = $Script:GhcrImage
    $result.Pull = $true
    return $result
}

# ------------------------------------------------------------------ 套用設定（setup 與 mode 共用）
function Apply-Config($cfg) {
    Confirm-Files $cfg.Mode $cfg.Version   # 先確認設定檔都在（缺的會下載）；失敗就在這裡停下，不會留下寫到一半的 .env
    Title '寫入設定'
    $updates = [ordered]@{
        'OPEN_PETS_MODE'          = $cfg.Mode
        'OPEN_PETS_VERSION'       = $cfg.Version
        'OPEN_PETS_IMAGE'         = $cfg.ImageName
        'OPEN_PETS_PORT'          = "$($cfg.Port)"
        'OPEN_PETS_CONTAINER_NAME' = $cfg.Container
        'COMPOSE_PATH_SEPARATOR'  = ':'
        'COMPOSE_FILE'            = (Get-ComposeFileValue $cfg.Mode)
    }
    if ($cfg.ProjectName) { $updates['COMPOSE_PROJECT_NAME'] = $cfg.ProjectName }
    $remove = @()
    if ($cfg.Mode -eq 'local') { $remove += 'OPEN_PETS_ALLOWED_HOSTS' } else { $updates['OPEN_PETS_ALLOWED_HOSTS'] = $cfg.Hosts }
    if ($cfg.Mode -eq 'lan' -and $cfg.HttpsPort -gt 0) { $updates['OPEN_PETS_HTTPS_PORT'] = "$($cfg.HttpsPort)" }
    if ($cfg.Mode -ne 'lan') { $remove += 'OPEN_PETS_HTTPS_PORT' }
    Set-EnvValues $updates $remove
    Ok '設定已寫入 .env'

    $img = @{ Name = $cfg.ImageName; Pull = $cfg.Pull }

    if ($img.Pull) {
        Title '下載映像檔（第一次約需幾分鐘）'
        if ((Invoke-Compose @('pull')) -ne 0) {
            Stop-Tool '下載映像檔失敗。' @(
                '確認這台電腦連得上網路。',
                "確認版本號打對了（到 GitHub 的 Releases 頁看，不含開頭的 v）：$($cfg.Version)",
                '套件如果是私有的，需要先登入：docker login ghcr.io -u <GitHub 帳號>',
                '沒有網路的話，請改用離線交付包。')
        }
    }

    Title '啟動'
    if ((Invoke-Compose @('up', '-d', '--remove-orphans')) -ne 0) {
        Stop-Tool '啟動失敗。' @('執行 .\open-pets.ps1 logs 看原因；常見原因是網址沒填、埠被占用、或同名容器已經存在。')
    }
    Write-Host -NoNewline '  等待系統就緒'
    if (-not (Wait-Healthy $cfg.Container)) {
        Warn '等了一段時間還沒有就緒。請執行 .\open-pets.ps1 logs 看原因（剛啟動可能還在準備，也可以稍後再執行 .\open-pets.ps1 status）。'
        return $false
    }
    Ok '系統已經就緒'
    return $true
}

function Show-AccessInfo($cfg) {
    Title '怎麼開啟'
    switch ($cfg.Mode) {
        'local' {
            Say "  在這台電腦的瀏覽器開：http://localhost:$($cfg.Port)" 'Green'
            Note '只有這台電腦連得進來。'
        }
        'lan' {
            $suffix = ''
            if ($cfg.HttpsPort -gt 0 -and $cfg.HttpsPort -ne 443) { $suffix = ":$($cfg.HttpsPort)" }
            foreach ($h in $cfg.Hosts.Split(',')) { Say "  同一個內網的電腦在瀏覽器開：https://$h$suffix" 'Green' }
            Note '每台要使用的電腦第一次要先信任憑證，否則瀏覽器會顯示警告：執行 .\open-pets.ps1 export-ca，把產生的說明檔交給同事。'
        }
        'online' {
            foreach ($h in $cfg.Hosts.Split(',')) { Say "  對外網址：https://$h" 'Green' }
            Note "線上模式需要你另外設定反向代理與 HTTPS（見手冊「線上模式」）；本機的應用程式在 http://127.0.0.1:$($cfg.Port)"
        }
    }
}

function Offer-Firewall([int]$p) {
    $ruleName = "Open-PETs HTTPS $p"
    if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) { Note "防火牆已經有「$ruleName」規則。"; return }
    $command = "New-NetFirewallRule -DisplayName `"$ruleName`" -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow"
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Title '防火牆（讓同事連得進來）'
    if ($isAdmin -and -not $Yes) {
        if (Confirm-Step "要現在幫你開放這台電腦的 $p 埠嗎") { Invoke-Expression $command; Ok "已開放 $p 埠"; return }
    }
    Warn "同一個內網的電腦要連到這台電腦的 $p 埠，防火牆要開放。請用「系統管理員身分」開 PowerShell，貼上："
    Say "  $command" 'White'
}

# ------------------------------------------------------------------ 指令：setup
function Cmd-Setup {
    Title 'Open-PETs 安裝'
    Test-DockerReady
    Ok 'Docker 正在運作'

    # 1. 模式
    $m = $Mode
    if (-not $m) {
        Say ''
        Say '請選擇你要怎麼使用 Open-PETs：' 'White'
        Say '  1. 本地   只有我自己，在這一台電腦上用                         （最簡單）' 'White'
        Say '  2. 內網   同一個辦公室／內網的同事，用他們自己的電腦連進來      （需要信任憑證）' 'White'
        Say '  3. 線上   讓外面（網際網路）的人用，有自己的網域               （建議請資訊人員協助）' 'White'
        $choice = Ask '輸入 1、2 或 3' '1'
        switch ($choice) { '1' { $m = 'local' } '2' { $m = 'lan' } '3' { $m = 'online' } default { $m = $choice.ToLower() } }
    }
    if (-not (Test-Mode $m)) { Stop-Tool "不認得的模式：$m" @('模式只有三種：local（本地）、lan（內網）、online（線上）。') }

    # 2. 版本與映像檔
    $ver = Get-DefaultVersion
    if (-not $ver) { $ver = Ask '要安裝哪一版（到 GitHub 的 Releases 頁看，不含開頭的 v，例如 2.0.0-rc3）' '' }
    if (-not $ver) { Stop-Tool '需要版本號才能安裝。' @('請加上 -Version 2.0.0-rc3（換成你要的版本）再執行一次。') }
    $img = Resolve-Image $ver

    # 3. 網址
    $hostList = ''
    if ($m -eq 'lan') {
        $ips = @(Get-LanIPs)
        Say ''
        Say '同事要用哪個網址連進來？請填這台電腦在內網的 IP（或內網的主機名稱）。' 'White'
        if ($ips.Count -gt 0) {
            Say '這台電腦偵測到的內網 IP：' 'White'
            foreach ($ip in $ips) { Say "    $($ip.IP)    （$($ip.Name)）" 'Gray' }
            Note '建議把這台電腦的 IP 固定下來（路由器的 DHCP 保留，或在網路卡設定固定 IP），否則 IP 變了同事就連不上。'
        }
        $default = ''
        if ($Hosts) { $default = $Hosts } elseif ($ips.Count -gt 0) { $default = $ips[0].IP }
        $hostList = ConvertTo-HostList (Ask '網址（多個請用逗號分隔，例如 192.168.1.20,pets-server）' $default)
    }
    elseif ($m -eq 'online') {
        Say ''
        Say '請填對外的網域（使用者會在瀏覽器輸入的網址，不含 https://），例如 pets.example.com' 'White'
        $hostList = ConvertTo-HostList (Ask '對外網域（多個請用逗號分隔）' $Hosts)
    }
    if ($m -ne 'local') {
        $problem = Test-HostList $hostList
        if ($problem) { Stop-Tool $problem @('範例：192.168.1.20 或 192.168.1.20,pets-server 或 pets.example.com') }
    }

    # 4. 名稱與埠：避開別人已經在用的（例如這台電腦上已經有別的 Open-PETs）；
    #    但如果是「這個資料夾自己」之前安裝的，就沿用原本的名稱與埠（重新執行 setup 不該換掉它們）
    $proj = Get-ProjectName
    $envMap = Read-EnvMap
    $container = $ContainerName
    if (-not $container) {
        if ($envMap.Contains('OPEN_PETS_CONTAINER_NAME')) { $container = $envMap['OPEN_PETS_CONTAINER_NAME'] } else { $container = 'open-pets' }
    }
    $existing = Get-ContainerInfo $container
    $ownInstall = Test-OwnContainer $existing
    if ($existing -and -not $ownInstall) {
        $alt = 'open-pets-app'
        if (Get-ContainerInfo $alt) { $alt = "open-pets-app-$(Get-Random -Minimum 1000 -Maximum 9999)" }
        Warn "這台電腦上已經有一個叫「$container」的容器（狀態：$($existing.Status)），不是這個資料夾安裝的（可能是舊版或別的安裝）。為了不動到它，新的會改叫「$alt」。"
        $container = $alt
    }
    $ownPorts = @()
    $envApp = 0
    $envHttps = 0
    if ($ownInstall) {
        if ($envMap.Contains('OPEN_PETS_PORT')) { $envApp = [int]$envMap['OPEN_PETS_PORT']; $ownPorts += $envApp }
        if ($envMap.Contains('OPEN_PETS_HTTPS_PORT')) { $envHttps = [int]$envMap['OPEN_PETS_HTTPS_PORT']; $ownPorts += $envHttps }
    }
    $appPort = $Port
    if ($appPort -le 0) { if ($envApp -gt 0) { $appPort = $envApp } else { $appPort = 8080 } }
    if ((Test-PortBusy $appPort) -and -not ($ownPorts -contains $appPort)) {
        $free = Find-FreePort ($appPort + 1)
        Warn "這台電腦的 $appPort 埠已經有別的程式在用，改用 $free。"
        $appPort = $free
    }
    $httpsPortValue = 0
    if ($m -eq 'lan') {
        $httpsPortValue = $HttpsPort
        if ($httpsPortValue -le 0) { if ($envHttps -gt 0) { $httpsPortValue = $envHttps } else { $httpsPortValue = 443 } }
        if ((Test-PortBusy $httpsPortValue) -and -not ($ownPorts -contains $httpsPortValue)) {
            $free = Find-FreePort 8443
            Warn "這台電腦的 $httpsPortValue 埠已經有別的程式在用，HTTPS 改用 $free（同事的網址要加上 :$free）。"
            $httpsPortValue = $free
        }
    }

    $cfg = [pscustomobject]@{ Mode = $m; Version = $ver; ImageName = $img.Name; Pull = $img.Pull; Hosts = $hostList; Port = $appPort; HttpsPort = $httpsPortValue; Container = $container; ProjectName = $ProjectName }

    # 5. 確認
    Title '請確認'
    Say "  模式　　：$(Get-ModeLabel $m)（$m）" 'White'
    Say "  版本　　：$ver" 'White'
    Say "  映像檔　：$($img.Name)$(if ($img.Pull) { '（會從網路下載）' } else { '（本機已有）' })" 'White'
    if ($m -ne 'local') { Say "  網址　　：$hostList" 'White' }
    Say "  本機的埠：$appPort" 'White'
    if ($m -eq 'lan') { Say "  HTTPS 埠：$httpsPortValue" 'White' }
    Say "  容器名稱：$container" 'White'
    Say "  安裝資料夾：$Script:Dir" 'White'
    if (-not (Confirm-Step '要開始安裝嗎')) { Say '已取消，沒有做任何變更。' 'Yellow'; return }

    if (-not (Apply-Config $cfg)) { return }
    Show-AccessInfo $cfg
    if ($m -eq 'lan') { Offer-Firewall $httpsPortValue }

    # 6. 第一個管理員
    if (-not $NoCreateAdmin -and -not $Yes) {
        Title '建立第一個管理員'
        Note '系統一開始沒有任何帳號，要先建立一個管理員才能登入。帳號建議用 Email；密碼至少 12 個字元，要有大寫、小寫、數字與符號。'
        & docker exec -it $container python /opt/openpets/openpets_server.py create-admin
        if ($LASTEXITCODE -ne 0) { Note '（如果顯示「已經有帳號了」，代表這個資料夾之前已經建立過，可以直接登入。）' }
    }
    Title '全部完成'
    Say '  之後常用：' 'White'
    Say '    .\open-pets.ps1 status        看目前狀態與網址' 'Gray'
    Say '    .\open-pets.ps1 mode lan      切換模式（local／lan／online）' 'Gray'
    Say '    .\open-pets.ps1 stop          停止（資料會保留）' 'Gray'
    Say '    .\open-pets.ps1 help          看全部指令' 'Gray'
}

# ------------------------------------------------------------------ 指令：mode
function Cmd-Mode {
    Test-DockerReady
    $envMap = Read-EnvMap
    if (-not $envMap.Contains('OPEN_PETS_VERSION')) { Stop-Tool '這個資料夾還沒有安裝過（找不到 .env）。' @('請先執行 .\open-pets.ps1 setup。') }
    $newMode = $Arg1
    if (-not $newMode) { $newMode = $Mode }
    if (-not $newMode) { Stop-Tool '請指定要切換到哪個模式。' @('例如：.\open-pets.ps1 mode lan （local＝本地、lan＝內網、online＝線上）') }
    $newMode = $newMode.ToLower()
    if (-not (Test-Mode $newMode)) { Stop-Tool "不認得的模式：$newMode" @('模式只有三種：local（本地）、lan（內網）、online（線上）。') }
    $current = 'local'
    if ($envMap.Contains('OPEN_PETS_MODE')) { $current = $envMap['OPEN_PETS_MODE'] }
    if ($current -eq 'offline') { $current = 'local' }

    $hostList = ''
    if ($newMode -ne 'local') {
        $hostList = $Hosts
        if (-not $hostList -and $envMap.Contains('OPEN_PETS_ALLOWED_HOSTS')) { $hostList = $envMap['OPEN_PETS_ALLOWED_HOSTS'] }
        if (-not $hostList) {
            if ($newMode -eq 'lan') {
                $ips = @(Get-LanIPs)
                foreach ($ip in $ips) { Say "    偵測到的內網 IP：$($ip.IP)（$($ip.Name)）" 'Gray' }
                $d = ''
                if ($ips.Count -gt 0) { $d = $ips[0].IP }
                $hostList = Ask '同事要用哪個網址連進來（內網 IP 或主機名稱，多個用逗號分隔）' $d
            }
            else { $hostList = Ask '對外網域（不含 https://，多個用逗號分隔）' '' }
        }
        $hostList = ConvertTo-HostList $hostList
        $problem = Test-HostList $hostList
        if ($problem) { Stop-Tool $problem @('範例：192.168.1.20 或 192.168.1.20,pets-server 或 pets.example.com') }
    }

    Title "切換模式：$(Get-ModeLabel $current) → $(Get-ModeLabel $newMode)"
    Say '  資料（帳號、處理紀錄、稽核紀錄、金鑰）都在資料磁碟區裡，切換模式不會刪除。' 'Green'
    if ($current -eq $newMode) { Note '目前已經是這個模式，會用現在的設定重新套用一次。' }
    switch ($newMode) {
        'local' {
            Note '切換後：只有這台電腦能開 http://localhost；同一個內網的同事會連不上。'
            if ($current -eq 'lan') { Note '內網的 HTTPS 容器會停掉並移除；它保存的憑證資料會保留，之後切回內網沿用，同事不用重新信任。' }
        }
        'lan' {
            Note '切換後：同事改用 https://<網址> 連進來；每台電腦第一次要信任憑證；這台電腦的防火牆要開放 HTTPS 埠。'
            Note '「系統設定」裡的「系統維運日誌」分頁會顯示給管理員。'
        }
        'online' {
            Note '切換後：應用程式本身只在本機 127.0.0.1；要讓外面的人連，需要你另外設定反向代理與正式憑證（見手冊「線上模式」）。'
            Note '「系統設定」裡的「系統維運日誌」分頁會顯示給管理員。'
        }
    }
    if (-not (Confirm-Step '要切換嗎')) { Say '已取消，沒有做任何變更。' 'Yellow'; return }

    $ver = $envMap['OPEN_PETS_VERSION']
    $imageName = 'open-pets-app'
    if ($envMap.Contains('OPEN_PETS_IMAGE')) { $imageName = $envMap['OPEN_PETS_IMAGE'] }
    $appPort = 8080
    if ($envMap.Contains('OPEN_PETS_PORT')) { $appPort = [int]$envMap['OPEN_PETS_PORT'] }
    $container = 'open-pets'
    if ($envMap.Contains('OPEN_PETS_CONTAINER_NAME')) { $container = $envMap['OPEN_PETS_CONTAINER_NAME'] }
    $httpsPortValue = 0
    if ($newMode -eq 'lan') {
        $httpsPortValue = $HttpsPort
        if ($httpsPortValue -le 0 -and $envMap.Contains('OPEN_PETS_HTTPS_PORT')) { $httpsPortValue = [int]$envMap['OPEN_PETS_HTTPS_PORT'] }
        if ($httpsPortValue -le 0) { $httpsPortValue = 443 }
        $ownProxy = $false
        if ($current -eq 'lan') { $ownProxy = $true }
        if (-not $ownProxy -and (Test-PortBusy $httpsPortValue)) {
            $free = Find-FreePort 8443
            Warn "這台電腦的 $httpsPortValue 埠已經有別的程式在用，HTTPS 改用 $free（同事的網址要加上 :$free）。"
            $httpsPortValue = $free
        }
    }
    $cfg = [pscustomobject]@{ Mode = $newMode; Version = $ver; ImageName = $imageName; Pull = $false; Hosts = $hostList; Port = $appPort; HttpsPort = $httpsPortValue; Container = $container; ProjectName = $ProjectName }
    if (-not (Apply-Config $cfg)) { return }
    Show-AccessInfo $cfg
    if ($newMode -eq 'lan') { Offer-Firewall $httpsPortValue }
    Say ''
    Say '切換完成。用 .\open-pets.ps1 status 可以隨時查看目前狀態。' 'Green'
}

# ------------------------------------------------------------------ 其他指令
function Get-CurrentConfig {
    $envMap = Read-EnvMap
    if (-not $envMap.Contains('OPEN_PETS_VERSION')) { Stop-Tool '這個資料夾還沒有安裝過（找不到 .env）。' @('請先執行 .\open-pets.ps1 setup。') }
    $m = 'local'
    if ($envMap.Contains('OPEN_PETS_MODE')) { $m = $envMap['OPEN_PETS_MODE'] }
    if ($m -eq 'offline') { $m = 'local' }
    $container = 'open-pets'
    if ($envMap.Contains('OPEN_PETS_CONTAINER_NAME')) { $container = $envMap['OPEN_PETS_CONTAINER_NAME'] }
    $hostValue = ''
    if ($envMap.Contains('OPEN_PETS_ALLOWED_HOSTS')) { $hostValue = $envMap['OPEN_PETS_ALLOWED_HOSTS'] }
    $appPort = 8080
    if ($envMap.Contains('OPEN_PETS_PORT')) { $appPort = [int]$envMap['OPEN_PETS_PORT'] }
    $httpsPortValue = 0
    if ($envMap.Contains('OPEN_PETS_HTTPS_PORT')) { $httpsPortValue = [int]$envMap['OPEN_PETS_HTTPS_PORT'] } elseif ($m -eq 'lan') { $httpsPortValue = 443 }
    $imageName = 'open-pets-app'
    if ($envMap.Contains('OPEN_PETS_IMAGE')) { $imageName = $envMap['OPEN_PETS_IMAGE'] }
    return [pscustomobject]@{ Mode = $m; Version = $envMap['OPEN_PETS_VERSION']; ImageName = $imageName; Hosts = $hostValue; Port = $appPort; HttpsPort = $httpsPortValue; Container = $container }
}

function Cmd-Status {
    Test-DockerReady
    $cfg = Get-CurrentConfig
    Title 'Open-PETs 目前狀態'
    Say "  模式　　：$(Get-ModeLabel $cfg.Mode)（$($cfg.Mode)）" 'White'
    Say "  版本　　：$($cfg.Version)" 'White'
    $info = Get-ContainerInfo $cfg.Container
    if (-not $info) {
        Warn "找不到容器「$($cfg.Container)」。執行 .\open-pets.ps1 start 啟動，或 .\open-pets.ps1 setup 重新安裝。"
        return
    }
    $health = & docker inspect --format '{{.State.Health.Status}}' $cfg.Container 2>$null
    $color = 'Yellow'
    if ($health -eq 'healthy') { $color = 'Green' }
    Say "  容器　　：$($cfg.Container)　$($info.Status)　健康狀態：$health" $color
    try {
        $rc = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($cfg.Port)/runtime-config.js" -TimeoutSec 5
        if ($rc.Content -match '"mode":\s*"([a-z]+)"') { Say "  系統回報的模式：$($Matches[1])" 'Gray' }
    } catch { Note '（暫時連不到本機的服務；剛啟動的話請稍等一下再查）' }
    Show-AccessInfo $cfg
    if ($health -ne 'healthy') { Note '狀態不是 healthy 的話，執行 .\open-pets.ps1 logs 看原因。' }
}
function Cmd-Start { Test-DockerReady; $cfg = Get-CurrentConfig; if ((Invoke-Compose @('up', '-d', '--remove-orphans')) -eq 0) { Write-Host -NoNewline '  等待系統就緒'; if (Wait-Healthy $cfg.Container) { Ok '已啟動'; Show-AccessInfo $cfg } } }
function Cmd-Stop { Test-DockerReady; [void](Get-CurrentConfig); if ((Invoke-Compose @('stop')) -eq 0) { Ok '已停止（資料都還在，用 .\open-pets.ps1 start 再啟動）' } }
function Cmd-Logs { Test-DockerReady; [void](Get-CurrentConfig); [void](Invoke-Compose @('logs', '--tail', '80', 'open-pets')) }
function Cmd-Admin([string]$sub) {
    Test-DockerReady
    $cfg = Get-CurrentConfig
    & docker exec -it $cfg.Container python /opt/openpets/openpets_server.py $sub
}
function Cmd-ExportCa {
    Test-DockerReady
    $cfg = Get-CurrentConfig
    if ($cfg.Mode -ne 'lan') { Stop-Tool '只有「內網」模式才有憑證要匯出。' @('目前是' + (Get-ModeLabel $cfg.Mode) + '模式。要用內網請先執行 .\open-pets.ps1 mode lan') }
    $target = Join-Path $Script:Dir 'open-pets-ca.crt'
    if ((Invoke-Compose @('cp', 'proxy:/data/caddy/pki/authorities/local/root.crt', $target)) -ne 0) { Stop-Tool '匯出憑證失敗。' @('確認系統已經啟動（.\open-pets.ps1 status）。') }
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $target
    $sha256 = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($cert.RawData)).Replace('-', '')
    $suffix = ''
    if ($cfg.HttpsPort -gt 0 -and $cfg.HttpsPort -ne 443) { $suffix = ":$($cfg.HttpsPort)" }
    $urls = ($cfg.Hosts.Split(',') | ForEach-Object { "https://$_$suffix" }) -join '、'
    $guide = Join-Path $Script:Dir 'open-pets-colleague-guide.txt'
    $text = @"
Open-PETs 使用說明（給同事）

1. 用瀏覽器（Chrome 或 Edge）開啟：$urls
2. 第一次連線，瀏覽器會顯示「您的連線不是私人連線」之類的警告，這是因為這台電腦還沒有信任公司內部的憑證。
   請先照下面做一次「信任憑證」，之後就不會再出現警告。

信任憑證（每台電腦只要做一次）：
  1. 把管理員給你的檔案 open-pets-ca.crt 存到這台電腦。
  2. 用「系統管理員身分」開 PowerShell，在檔案所在的資料夾執行：
       certutil -addstore -f Root open-pets-ca.crt
     （或用滑鼠雙擊這個檔案 → 安裝憑證 → 本機電腦 → 選「將所有憑證放入以下的存放區」→「受信任的根憑證授權單位」）
  3. 完全關閉瀏覽器再重新開啟。
  4. Firefox 使用者：設定 → 隱私權與安全性 → 憑證 → 檢視憑證 → 憑證機構 → 匯入 open-pets-ca.crt，勾選「信任這個 CA 來識別網站」。

確認拿到的是正確的憑證（防止被人掉包）：憑證的 SHA-256 指紋應該是
  $sha256
（雙擊 open-pets-ca.crt → 詳細資料 → 指紋，兩個要一致；不一致就不要安裝，請回報管理員。）

登入帳號請向管理員索取。系統不開放自行註冊。
"@
    [System.IO.File]::WriteAllText($guide, $text, (New-Object System.Text.UTF8Encoding($true)))
    Ok "已匯出憑證：$target"
    Ok "已產生給同事的說明：$guide"
    Say "  憑證 SHA-256 指紋：$sha256" 'White'
    Warn '只把 open-pets-ca.crt 與說明檔交給同事。憑證的私鑰在這台電腦的資料磁碟區裡，請當作機密，不要外流。'
}
function Cmd-Backup {
    Test-DockerReady
    $cfg = Get-CurrentConfig
    $proj = Get-ProjectName
    $volume = (& docker volume ls --filter "label=com.docker.compose.project=$proj" --filter 'label=com.docker.compose.volume=open-pets-data' -q 2>$null | Select-Object -First 1)
    if (-not $volume) { Stop-Tool '找不到資料磁碟區。' @('請先執行 .\open-pets.ps1 setup 安裝並使用過一次。') }
    $backupDir = Join-Path $Script:Dir 'backups'
    New-Item -ItemType Directory -Force $backupDir | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $file = "open-pets-data_$stamp.tgz"
    Title '備份（會短暫停止服務）'
    [void](Invoke-Compose @('stop'))
    & docker run --rm --user root --entrypoint tar -v "${volume}:/data" -v "${backupDir}:/backup" "$($cfg.ImageName):$($cfg.Version)" czf "/backup/$file" -C /data .
    $code = $LASTEXITCODE
    [void](Invoke-Compose @('start'))
    if ($code -ne 0) { Stop-Tool '備份失敗。' @('確認磁碟空間足夠，再試一次。') }
    Ok "備份完成：$(Join-Path $backupDir $file)"
    Warn '備份裡有帳號、紀錄與金鑰，請當作機密保管；金鑰遺失會讓以前的雜湊結果與稽核紀錄無法對上。'
}
function Cmd-Update {
    Test-DockerReady
    $cfg = Get-CurrentConfig
    $newVersion = $Arg1
    if (-not $newVersion) { $newVersion = $Version }
    if (-not $newVersion) { Stop-Tool '請指定要更新到哪一版。' @('例如：.\open-pets.ps1 update 2.0.0-rc3（版本號到 GitHub 的 Releases 頁看，不含開頭的 v）') }
    Title "更新：$($cfg.Version) → $newVersion"
    Say '  資料不會不見；更新前會先自動備份。' 'Green'
    if (-not (Confirm-Step '要更新嗎')) { Say '已取消，沒有做任何變更。' 'Yellow'; return }
    if (-not $NoBackup) { Cmd-Backup }
    $script:Version = $newVersion
    $img = Resolve-Image $newVersion
    $cfg2 = [pscustomobject]@{ Mode = $cfg.Mode; Version = $newVersion; ImageName = $img.Name; Pull = $img.Pull; Hosts = $cfg.Hosts; Port = $cfg.Port; HttpsPort = $cfg.HttpsPort; Container = $cfg.Container; ProjectName = $ProjectName }
    if (Apply-Config $cfg2) { Ok "已更新到 $newVersion"; Show-AccessInfo $cfg2 }
}
function Cmd-Help {
    Say ''
    Say 'Open-PETs 安裝與模式切換小工具' 'Cyan'
    Say ''
    Say '  第一次安裝　　　　.\open-pets.ps1 setup' 'White'
    Say '  切換模式　　　　　.\open-pets.ps1 mode local    （本地：只有這台電腦用）' 'White'
    Say '　　　　　　　　　　.\open-pets.ps1 mode lan      （內網：同一個辦公室的同事連進來，內建 HTTPS）' 'White'
    Say '　　　　　　　　　　.\open-pets.ps1 mode online   （線上：以對外網域提供服務）' 'White'
    Say '  看狀態與網址　　　.\open-pets.ps1 status' 'White'
    Say '  啟動／停止　　　　.\open-pets.ps1 start      .\open-pets.ps1 stop' 'White'
    Say '  看日誌（出問題時）.\open-pets.ps1 logs' 'White'
    Say '  建立管理員　　　　.\open-pets.ps1 create-admin' 'White'
    Say '  忘記管理員密碼　　.\open-pets.ps1 reset-password' 'White'
    Say '  給同事的憑證與說明.\open-pets.ps1 export-ca    （內網模式）' 'White'
    Say '  備份　　　　　　　.\open-pets.ps1 backup' 'White'
    Say '  更新版本　　　　　.\open-pets.ps1 update 2.0.0-rc3' 'White'
    Say ''
    Say '  不想回答問題、全部用預設值：加上 -Yes。進階參數見檔案開頭的說明。' 'Gray'
}

switch ($Command.ToLower()) {
    'setup' { Cmd-Setup }
    'mode' { Cmd-Mode }
    'status' { Cmd-Status }
    'start' { Cmd-Start }
    'stop' { Cmd-Stop }
    'logs' { Cmd-Logs }
    'create-admin' { Cmd-Admin 'create-admin' }
    'reset-password' { Cmd-Admin 'reset-password' }
    'export-ca' { Cmd-ExportCa }
    'backup' { Test-DockerReady; Cmd-Backup }
    'update' { Cmd-Update }
    default { Cmd-Help }
}
