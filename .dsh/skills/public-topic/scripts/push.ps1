# public-topic - push a titled Markdown message to an ntfy public topic.
#
# The topic is a parameter and 'pub_' is the default prefix:
#   -Topic dsh          -> pub_dsh
#   -Topic pub_dsh      -> pub_dsh   (already prefixed, left alone)
#   -Topic dsh,news     -> pub_dsh,pub_news
#
# Hard-won constraints (all three were hit for real; see SKILL.md):
#   1. never pass -Title on the command line (smart quotes U+201C/U+201D shred argv)
#   2. never pass non-ASCII -Tags on the command line (argv is ANSI-decoded)
#   3. never build the payload with ConvertTo-Json (PS 5.1 string bug -> 413)
#
# Usage:
#   powershell -NoProfile -File scripts\push.ps1 -BodyFile body.md -TagsFile tags.txt -Topic dsh
param(
    [Parameter(Mandatory = $true)][string]$BodyFile,
    [string]$Topic = 'dsh',
    [string]$Prefix = 'pub_',
    [string]$Title = '',
    [string[]]$Tags = @(),
    [string]$TagsFile = '',
    [string]$Server = '',
    [int]$Priority = 3,
    [switch]$PrintPayload
)

$ErrorActionPreference = 'Stop'

if ($Server -eq '') { $Server = if ($env:NTFY_SERVER) { $env:NTFY_SERVER } else { 'https://msn.feg.cn' } }
$Server = $Server.TrimEnd('/')

# Resolve every topic name, adding the prefix only when it is missing.
$topicList = @()
foreach ($t in ($Topic -split ',')) {
    $name = $t.Trim()
    if ($name -eq '') { continue }
    if (-not $name.StartsWith($Prefix)) { $name = $Prefix + $name }
    $topicList += $name
}
if ($topicList.Count -eq 0) { throw "no topic resolved from -Topic '$Topic' (prefix '$Prefix')" }

function ConvertTo-JsonString {
    param([string]$Value)
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($ch in $Value.ToCharArray()) {
        $code = [int]$ch
        if ($ch -eq '"') { [void]$sb.Append('\"') }
        elseif ($ch -eq '\') { [void]$sb.Append('\\') }
        elseif ($code -eq 10) { [void]$sb.Append('\n') }
        elseif ($code -eq 13) { [void]$sb.Append('\r') }
        elseif ($code -eq 9) { [void]$sb.Append('\t') }
        elseif ($code -lt 32) { [void]$sb.Append('\u{0:x4}' -f $code) }
        else { [void]$sb.Append($ch) }
    }
    [void]$sb.Append('"')
    $sb.ToString()
}

if (-not (Test-Path -LiteralPath $BodyFile)) { throw "body file not found: $BodyFile" }
$message = Get-Content -LiteralPath $BodyFile -Raw -Encoding UTF8
$message = $message.TrimStart([char]0xFEFF)
if ([string]::IsNullOrWhiteSpace($message)) { throw "body file is empty: $BodyFile" }
$message = $message.Replace("`r`n", "`n").Replace("`r", "`n")

# Tags come from a UTF-8 file when they contain non-ASCII; -Tags is a fallback
# for ASCII-only use. Both are comma/newline separated.
$tagList = @()
function Add-Tags {
    param([string[]]$Raw)
    foreach ($t in $Raw) {
        foreach ($piece in ($t -split ',')) {
            foreach ($p2 in ($piece -split "`n")) {
                $p = $p2.Trim()
                if ($p -ne '') { $script:tagList += $p }
            }
        }
    }
}
if ($TagsFile -ne '') {
    if (-not (Test-Path -LiteralPath $TagsFile)) { throw "tags file not found: $TagsFile" }
    $tagText = (Get-Content -LiteralPath $TagsFile -Raw -Encoding UTF8).TrimStart([char]0xFEFF)
    Add-Tags @($tagText)
}
Add-Tags @($Tags)

# The first "## " line is the title source; it is stripped from the message so
# the delivered body does not repeat the notification title.
$lines = @($message -split "`n")
$titleIdx = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].Trim().StartsWith('## ')) { $titleIdx = $i; break }
}
$headingTitle = ''
if ($titleIdx -ge 0) { $headingTitle = ($lines[$titleIdx].Trim().Substring(3)).Trim() }

if ([string]::IsNullOrWhiteSpace($Title)) {
    if ($titleIdx -lt 0) { throw "no -Title given and body file has no '## ' heading to derive one from: $BodyFile" }
    $Title = $headingTitle
}

if ($titleIdx -ge 0 -and $headingTitle -eq $Title) {
    $kept = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($i -ne $titleIdx) { [void]$kept.Add($lines[$i]) } }
    while ($kept.Count -gt 0 -and $kept[0].Trim() -eq '') { $kept.RemoveAt(0) }
    $message = ($kept -join "`n").TrimEnd()
    if ([string]::IsNullOrWhiteSpace($message)) { throw "body file only contained the title line: $BodyFile" }
}

$tagJson = if ($tagList.Count -gt 0) { '[' + (($tagList | ForEach-Object { ConvertTo-JsonString $_ }) -join ',') + ']' } else { '[]' }

$json = '{' +
    '"topic":' + (ConvertTo-JsonString ($topicList -join ',')) + ',' +
    '"title":' + (ConvertTo-JsonString $Title) + ',' +
    '"message":' + (ConvertTo-JsonString $message) + ',' +
    '"markdown":true,' +
    '"priority":' + $Priority + ',' +
    '"tags":' + $tagJson + '}'

$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

# fail fast if the hand-built JSON is malformed (ntfy answers 40009 "topic invalid")
try { $null = ConvertFrom-Json -InputObject $json } catch { throw "internal error: generated payload is not valid JSON: $($_.Exception.Message)`n$json" }

if ($PrintPayload) { $json; exit 0 }

$resp = Invoke-WebRequest -Uri $Server -Method Post -UseBasicParsing `
    -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 30

$id = ''
if ($resp.Content -match '"id"\s*:\s*"([^"]+)"') { $id = $Matches[1] }
"HTTP $($resp.StatusCode) -> $Server/$($topicList -join ',')  id=$id  ($($bytes.Length) bytes, tags: $($tagList -join '/'))"
