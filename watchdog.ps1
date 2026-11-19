# watchdog.ps1
# Keeps the cloudflared quick tunnel (and the vite preview it points at) alive, and keeps the latest
# public URL in current_url.txt.
#
# Restarts the tunnel when:
#   - cloudflared is not running                                  (original behaviour)
#   - it is stuck on "Tunnel not found"                           (original behaviour)
#   - the public URL fails N checks in a row while the origin is healthy
#     ("Register tunnel error" / log silent / 530: the process is alive but serves nothing)
# Restarts the preview scheduled task when the origin (http://localhost:5173/) fails N checks in a row
# (e.g. "npm run preview" is stopped at a "Terminate batch job (Y/N)?" prompt while the task still says Running).
#
# Safety: health-based restarts have a cooldown and an hourly cap, so a real outage cannot cause restart loops.
# A restarted quick tunnel gets a NEW public URL; the URL-change block below then updates current_url.txt.
#
# Test without touching anything:  .\watchdog.ps1 -DryRun -Once [-PublicUrlOverride <url>] [-FailThreshold 1]

param(
    [switch]$DryRun,                 # only log what would be done (to the console, not to watchdog.log)
    [switch]$Once,                   # run one iteration and exit
    [string]$PublicUrlOverride = "", # check this URL instead of the latest tunnel URL (for tests)
    [string]$OriginUrl = "http://localhost:5173/",
    [int]$FailThreshold = 3          # consecutive failed checks before a health-based restart
)

$TaskName        = "cloudflared-openpets-v2"
$PreviewTaskName = "npm-preview-openpets"
$Dir             = "C:\Users\TTCWEI\Desktop\Demo"
$TunnelLog       = Join-Path $Dir "cloudflared.log"
$UrlFile         = Join-Path $Dir "current_url.txt"
$WatchLog        = Join-Path $Dir "watchdog.log"
$CheckEverySec   = 60
$CooldownSec     = 120
$StuckThreshold  = 6
$HealthCooldownSec        = 300   # minimum gap between health-based restarts
$MaxHealthRestartsPerHour = 3

function Write-Log($msg) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    if ($DryRun) { Write-Host $line } else { Add-Content -Path $WatchLog -Value $line }
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

# True only for HTTP 200 within the timeout. Any error, timeout or non-2xx (e.g. Cloudflare 530) counts as unhealthy.
function Test-HttpOk([string]$Url, [int]$TimeoutSec = 15) {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        return ($r.StatusCode -eq 200)
    }
    catch { return $false }
}

function Restart-Tunnel($reason = "Stuck on 'Tunnel not found'") {
    Write-Log "$reason. Restarting tunnel..."
    if ($DryRun) { Write-Log "[DryRun] would stop task $TaskName, kill cloudflared, start task $TaskName"; return }
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 3
    Start-ScheduledTask -TaskName $TaskName
}

function Restart-Preview($reason) {
    Write-Log "$reason. Restarting preview task $PreviewTaskName..."
    if ($DryRun) { Write-Log "[DryRun] would stop task $PreviewTaskName, start task $PreviewTaskName"; return }
    Stop-ScheduledTask -TaskName $PreviewTaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    Start-ScheduledTask -TaskName $PreviewTaskName
}

function Format-Health($ok, $fails) {
    if ($ok) { return "healthy" } else { return "FAIL x$fails" }
}

$lastUrl = ""
if (Test-Path $UrlFile) { $lastUrl = (Get-Content $UrlFile -TotalCount 1) }
$lastRestart = Get-Date "2000-01-01"
$lastHealthRestart = Get-Date "2000-01-01"
$healthRestarts = New-Object System.Collections.Generic.List[datetime]
$publicFails = 0
$originFails = 0
$mode = if ($DryRun) { ", DryRun" } else { "" }
Write-Log "watchdog started (task: $TaskName$mode)"

while ($true) {
    try {
        $now = Get-Date
        $cooledDown = (($now - $lastRestart).TotalSeconds -gt $CooldownSec)

        if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
            if ($cooledDown) {
                Write-Log "cloudflared is not running. Starting task."
                if (-not $DryRun) { Start-ScheduledTask -TaskName $TaskName }
                $lastRestart = Get-Date
            }
        }
        elseif ($cooledDown -and (Test-Stuck)) {
            Restart-Tunnel
            $lastRestart = Get-Date
        }

        $url = Get-LatestUrl
        if ($url -and $url -ne $lastUrl) {
            Write-Log "NEW URL: $url"
            if (-not $DryRun) {
                Set-Content -Path $UrlFile -Value $url -Encoding UTF8
                & "C:\Users\TTCWEI\Desktop\Demo\push_url.ps1" -Url $url
            }
            $lastUrl = $url
            $publicFails = 0   # new tunnel, new URL: start counting from scratch
        }

        # ---- health checks (public URL and origin) ----
        $checkUrl = if ($PublicUrlOverride) { $PublicUrlOverride } else { $lastUrl }
        $publicOk = if ($checkUrl) { Test-HttpOk $checkUrl 15 } else { $true }
        $originOk = Test-HttpOk $OriginUrl 5
        if ($publicOk) { $publicFails = 0 } else { $publicFails++ }
        if ($originOk) { $originFails = 0 } else { $originFails++ }
        if ($DryRun) {
            Write-Log ("[DryRun] public=" + (Format-Health $publicOk $publicFails) + " origin=" + (Format-Health $originOk $originFails))
        }

        $healthCooled = (((Get-Date) - $lastHealthRestart).TotalSeconds -gt $HealthCooldownSec)
        $recent = @($healthRestarts | Where-Object { ((Get-Date) - $_).TotalMinutes -le 60 })
        $healthRestarts = New-Object System.Collections.Generic.List[datetime]
        foreach ($t in $recent) { $healthRestarts.Add($t) }
        $underCap = ($healthRestarts.Count -lt $MaxHealthRestartsPerHour)

        if ((-not $originOk) -and $originFails -ge $FailThreshold) {
            # Origin is down: restarting the tunnel would not help, restart the preview instead.
            if ($healthCooled -and $underCap) {
                Restart-Preview "Origin $OriginUrl failed $originFails checks in a row"
                $lastHealthRestart = Get-Date; $healthRestarts.Add((Get-Date)); $originFails = 0
            }
            elseif (-not $underCap) { Write-Log "Origin down but already restarted $MaxHealthRestartsPerHour times in the last hour; not restarting again." }
        }
        elseif ($originOk -and (-not $publicOk) -and $publicFails -ge $FailThreshold) {
            # Origin answers locally but the public URL does not: the tunnel is stuck.
            if ($healthCooled -and $underCap) {
                Restart-Tunnel "Public URL $checkUrl failed $publicFails checks in a row while origin is healthy"
                $lastRestart = Get-Date; $lastHealthRestart = Get-Date; $healthRestarts.Add((Get-Date)); $publicFails = 0
            }
            elseif (-not $underCap) { Write-Log "Public URL down but already restarted $MaxHealthRestartsPerHour times in the last hour; not restarting again." }
        }
    }
    catch {
        Write-Log ("error: " + $_.Exception.Message)
    }
    if ($Once) { break }
    Start-Sleep -Seconds $CheckEverySec
}
