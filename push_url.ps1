# push_url.ps1
# Sends the current trycloudflare URL to the Google Apps Script web app,
# which then updates the test URL inside the Google Doc.
# Usage:  push_url.ps1 -Url https://xxxx.trycloudflare.com
#         push_url.ps1            (no argument: reads current_url.txt)
# ASCII only on purpose (Windows PowerShell 5.1 can garble non-ASCII in .ps1 files)

param([string]$Url = "")

$Dir      = "C:\Users\TTCWEI\Desktop\Demo"
$Endpoint = "https://script.google.com/macros/s/AKfycbwD-QxVkH9vRKH17GUDy1wUBYKDXa-YK8kQqBL14NFn3ugFroyPOnW6g9ni3zJYxUXo/exec"       # ends with /exec
# Secret is NOT stored in this script (security scan 2-2, 2026-11-02).
# Source order: env var PUSH_URL_SECRET, then %LOCALAPPDATA%\OpenPETs-demo\push_url_secret.txt
$SecretFile = Join-Path $env:LOCALAPPDATA "OpenPETs-demo\push_url_secret.txt"
$Secret = $env:PUSH_URL_SECRET
if (-not $Secret -and (Test-Path $SecretFile)) { $Secret = (Get-Content $SecretFile -TotalCount 1).Trim() }
$WatchLog = Join-Path $Dir "watchdog.log"
$UrlFile  = Join-Path $Dir "current_url.txt"

function Write-Log($m) {
    Add-Content -Path $WatchLog -Value ("{0} [doc] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m)
}

if (-not $Secret) {
    Write-Log "skip: secret not configured (set PUSH_URL_SECRET or create $SecretFile)"
    exit 1
}

if (-not $Url) {
    if (Test-Path $UrlFile) { $Url = (Get-Content $UrlFile -TotalCount 1).Trim() }
}
if ($Url -notmatch '^https://[a-z0-9-]+\.trycloudflare\.com$') {
    Write-Log "skip: not a valid tunnel url: $Url"
    exit 1
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$body = @{ secret = $Secret; url = $Url } | ConvertTo-Json -Compress

for ($i = 1; $i -le 3; $i++) {
    try {
        $res = Invoke-RestMethod -Uri $Endpoint -Method Post -ContentType "application/json" -Body $body -TimeoutSec 30
        $text = ("$res").Trim()
        Write-Log ("attempt {0}: {1}" -f $i, $text)
        if ($text -like "ok*") { exit 0 }
        if ($text -in @("forbidden", "bad-url", "no-match")) { exit 1 }   # retrying will not help
    }
    catch {
        Write-Log ("attempt {0} failed: {1}" -f $i, $_.Exception.Message)
    }
    Start-Sleep -Seconds 15
}
exit 1
