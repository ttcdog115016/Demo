$Log = "C:\Users\TTCWEI\Desktop\Demo\netcheck.log"
while ($true) {
    try {
        $g = Test-Connection 192.168.90.1 -Count 1 -Quiet
        $i = Test-Connection 1.1.1.1 -Count 1 -Quiet
        $d = [bool](Resolve-DnsName region1.v2.argotunnel.com -Type A -DnsOnly -QuickTimeout -ErrorAction SilentlyContinue)
        "{0} gw={1} net={2} dns={3}" -f (Get-Date -Format "MM/dd HH:mm:ss"), $g, $i, $d | Add-Content $Log
    } catch {
        "{0} error={1}" -f (Get-Date -Format "MM/dd HH:mm:ss"), $_.Exception.Message | Add-Content $Log
    }
    Start-Sleep -Seconds 10
}
