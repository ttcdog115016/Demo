# install_watchdog_task.ps1
# Registers (or removes) the scheduled task that keeps watchdog.ps1 running in a hidden window.
#
#   .\install_watchdog_task.ps1            register the task (replaces an existing one); does NOT start it
#   .\install_watchdog_task.ps1 -Uninstall remove the task
#
# The task runs at LOGON of the current user, in that user's interactive session, with normal (non-elevated)
# rights, so no administrator rights and no stored password are needed. After a reboot the watchdog therefore
# starts when you log on (the tunnel and preview tasks still start at boot by themselves).
# watchdog.ps1 holds a named mutex, so a second copy (e.g. a window opened by hand) exits immediately.
#
# Start now:  Start-ScheduledTask -TaskName watchdog-openpets
# Stop:       Stop-ScheduledTask  -TaskName watchdog-openpets
# State/log:  Get-ScheduledTaskInfo -TaskName watchdog-openpets ; watchdog.log in this folder

param(
    [switch]$Uninstall,
    [string]$TaskName = "watchdog-openpets"
)

$ErrorActionPreference = "Stop"
$Dir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script = Join-Path $Dir "watchdog.ps1"
$User   = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name   # DOMAIN\user

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task '$TaskName'."
}
if ($Uninstall) { return }

if (-not (Test-Path $Script)) { throw "watchdog.ps1 not found next to this script: $Script" }

$action    = New-ScheduledTaskAction -Execute "powershell.exe" `
                -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $Script) `
                -WorkingDirectory $Dir
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $User
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
                -ExecutionTimeLimit ([TimeSpan]::Zero) `
                -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
                -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
    -Settings $settings -Description "Keeps the Open-PETs demo tunnel and preview alive (watchdog.ps1). Runs at logon, hidden." | Out-Null

Write-Host "Registered task '$TaskName' for $User (at logon, hidden, single instance). It is not started yet:"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
