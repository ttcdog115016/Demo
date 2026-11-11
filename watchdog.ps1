# watchdog.ps1
# Restarts the cloudflared quick tunnel when it is stuck on "Tunnel not found",
# and keeps the latest public URL in current_url.txt.

$TaskName       = "cloudflared-openpets-v2"
$Dir            = "C:\Users\TTCWEI\Desktop\Demo"
$TunnelLog      = Join-Path $Dir "cloudflared.log"
$UrlFile        = Join-Path $Dir "current_url.txt"
$WatchLog       = Join-Path $Dir "watchdog.log"
$CheckEverySec  = 60
$CooldownSec    = 120
$StuckThreshold = 6

function Write-Log($msg) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $WatchLog -Value $line
}

function Get-LatestUrl {
    $m = Select-String -Path $TunnelLog -Pattern "https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue |
         Select-Object -Last 1
    if ($m) { return [regex]::Match($m.Line, "https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com").Value }
    return $null
}

function Test-Stuck {
    $tail = Get-Content -Path $TunnelLog -Tail 300 -ErrorAction SilentlyContinue
    if (-not $tail) { return $false }
    $bad = 0
    foreach ($line in $tail) {
        if ($line -match "Registered tunnel connection") { $bad = 0 }
        elseif ($line -match "Tunnel not found")          { $bad++ }
    }
    return ($bad -ge $StuckThreshold)
}

function Restart-Tunnel {
    Write-Log "Stuck on 'Tunnel not found'. Restarting tunnel..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 3
    Start-ScheduledTask -TaskName $TaskName
}

$lastUrl = ""
if (Test-Path $UrlFile) { $lastUrl = (Get-Content $UrlFile -TotalCount 1) }
$lastRestart = Get-Date "2000-01-01"
Write-Log "watchdog started (task: $TaskName)"

while ($true) {
    try {
        $now = Get-Date
        $cooledDown = (($now - $lastRestart).TotalSeconds -gt $CooldownSec)

        if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
            if ($cooledDown) {
                Write-Log "cloudflared is not running. Starting task."
                Start-ScheduledTask -TaskName $TaskName
                $lastRestart = Get-Date
            }
        }
        elseif ($cooledDown -and (Test-Stuck)) {
            Restart-Tunnel
            $lastRestart = Get-Date
        }

        $url = Get-LatestUrl
        if ($url -and $url -ne $lastUrl) {
            Set-Content -Path $UrlFile -Value $url -Encoding UTF8
            Write-Log "NEW URL: $url"
            & "C:\Users\TTCWEI\Desktop\Demo\push_url.ps1" -Url $url
            $lastUrl = $url
        }
    }
    catch {
        Write-Log ("error: " + $_.Exception.Message)
    }
    Start-Sleep -Seconds $CheckEverySec
}


