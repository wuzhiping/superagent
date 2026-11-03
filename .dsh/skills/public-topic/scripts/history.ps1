# public-topic - list recent message titles from an ntfy topic (for de-duplication).
#
# ntfy's 'since' uses Go duration syntax: s / m / h only. There is NO 'd' unit,
# so 7 days is 168h ("7d" is rejected with HTTP 400).
#
# Usage:
#   powershell -NoProfile -File scripts\history.ps1 -Topic dsh -Since 168h
#
# Output: one line per message, "<yyyy-MM-dd HH:mm><TAB><title>", oldest first.
param(
    [string]$Topic = 'dsh',
    [string]$Prefix = 'pub_',
    [string]$Since = '168h',
    [string]$Server = ''
)

$ErrorActionPreference = 'Stop'

if ($Server -eq '') { $Server = if ($env:NTFY_SERVER) { $env:NTFY_SERVER } else { 'https://msn.feg.cn' } }
$Server = $Server.TrimEnd('/')

$topicList = @()
foreach ($t in ($Topic -split ',')) {
    $name = $t.Trim()
    if ($name -eq '') { continue }
    if (-not $name.StartsWith($Prefix)) { $name = $Prefix + $name }
    $topicList += $name
}
if ($topicList.Count -eq 0) { throw "no topic resolved from -Topic '$Topic' (prefix '$Prefix')" }

$all = @()
foreach ($tp in $topicList) {
    $uri = "$Server/$tp/json?poll=1&since=$Since"
    $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 30
    $text = [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
    foreach ($line in ($text -split "`n")) {
        if ($line.Trim() -eq '') { continue }
        $m = $line | ConvertFrom-Json
        # Skip non-message events (message_delete, open/keepalive) and titleless
        # records: they carry no headline, so they are useless for de-duplication
        # and only inflate the line count. A normal message has event="message".
        if ($m.PSObject.Properties.Name -contains 'event' -and $m.event -ne 'message') { continue }
        if ([string]::IsNullOrWhiteSpace([string]$m.title)) { continue }
        $when = [datetimeoffset]::FromUnixTimeSeconds([long]$m.time).ToLocalTime()
        $all += New-Object psobject -Property ([ordered]@{
                time  = $when
                topic = $m.topic
                id    = $m.id
                title = $m.title
            })
    }
}

foreach ($m in ($all | Sort-Object time)) {
    "{0}`t{1}" -f $m.time.ToString('yyyy-MM-dd HH:mm'), $m.title
}
