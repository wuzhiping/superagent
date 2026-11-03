<#
.SYNOPSIS
  Verify MinIO permissions with a real account: read (ls / get), write (put / rm) vs expectation.
  Creates a temporary alias, probes each bucket, then removes the alias and the probe files.

.EXAMPLE
  .\verify.ps1 -User ateam -Secret 'maeta@2026' -Bucket ateam,dsh -ReadOnlyBucket aife -DeniedBucket memos

.NOTES
  ASCII-only on purpose: Windows PowerShell 5.1 decodes BOM-less .ps1 files with the ANSI code
  page, so non-ASCII literals can break parsing. Keep this file ASCII.
  Exit code 0 = all checks passed, 1 = at least one mismatch.
#>
[CmdletBinding()]
param(
    [string]$Alias = 'admin',
    [Parameter(Mandatory = $true)][string]$User,
    [Parameter(Mandatory = $true)][string]$Secret,
    # buckets expected to be read-write
    [string[]]$Bucket = @(),
    # buckets expected to be read-only
    [string[]]$ReadOnlyBucket = @(),
    # buckets expected to be denied entirely
    [string[]]$DeniedBucket = @(),
    [string]$Mc = ''
)

$ErrorActionPreference = 'Stop'

function Resolve-Mc {
    param([string]$Path)
    if ($Path) { return $Path }
    $cmd = Get-Command mc -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($c in @('D:\Refine\Books\ntop\AI\mc\mc.exe')) {
        if (Test-Path $c) { return $c }
    }
    throw 'mc executable not found: install MinIO Client or pass -Mc <full path>'
}

function Invoke-Mc {
    param([string[]]$McArgs)
    $errFile = [System.IO.Path]::GetTempFileName()
    # Relax ErrorActionPreference while running the native command: mc writes its progress bar
    # to stderr, and under 'Stop' PowerShell turns that into a terminating NativeCommandError.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $stdout = & $script:McExe @McArgs 2>$errFile
        $code = $LASTEXITCODE
        $stderr = ''
        if (Test-Path $errFile) { $stderr = (Get-Content $errFile -Raw -ErrorAction SilentlyContinue) }
        $cleanErr = (($stderr -replace "`r", '') -split "`n" |
            Where-Object { $_ -notmatch '^\s*[-.=]{3}' -and $_.Trim() -ne '' }) -join ' | '
        return [pscustomobject]@{
            ExitCode = $code
            StdOut   = (($stdout | Out-String).Trim())
            StdErr   = $cleanErr.Trim()
        }
    } finally {
        $ErrorActionPreference = $prevEap
        Remove-Item $errFile -Force -ErrorAction SilentlyContinue
    }
}

$script:McExe = Resolve-Mc $Mc
$results = New-Object System.Collections.ArrayList
$probeKey = "_perm_probe_$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).txt"
$probeLocal = [System.IO.Path]::GetTempFileName()
Set-Content -Path $probeLocal -Value 'permission probe' -Encoding ASCII

function Add-Result {
    param([string]$Bucket, [string]$Check, [bool]$ExpectedOk, [bool]$ActualOk, [string]$Detail = '')
    $expLabel = if ($ExpectedOk) { 'allow' } else { 'deny' }
    $actLabel = if ($ActualOk) { 'allow' } else { 'deny' }
    $verdict = if ($ActualOk -eq $ExpectedOk) { 'PASS' } else { 'FAIL' }
    [void]$results.Add([pscustomobject]@{
        Bucket = $Bucket; Check = $Check; Expected = $expLabel
        Actual = $actLabel; Verdict = $verdict; Detail = $Detail
    })
}

# resolve the endpoint of the target alias
$aliasJson = Invoke-Mc @('alias', 'list', '--json', '--no-color')
$endpoint = ($aliasJson.StdOut -split "`n" | ForEach-Object { if ($_.Trim()) { $_ | ConvertFrom-Json } } |
    Where-Object { $_.alias -eq $Alias } | Select-Object -First 1).URL
if (-not $endpoint) { throw "alias '$Alias' not found in mc alias list" }

$tmpAlias = "permtest-$User-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
try {
    $r = Invoke-Mc @('alias', 'set', $tmpAlias, $endpoint, $User, $Secret, '--no-color')
    if ($r.ExitCode -ne 0) { throw "cannot create temp alias: $($r.StdErr)" }
    Write-Host "test alias: $tmpAlias -> $endpoint (user=$User)" -ForegroundColor DarkGray

    foreach ($b in $Bucket) {
        $r = Invoke-Mc @('ls', "$tmpAlias/$b", '--no-color')
        Add-Result $b 'ls' $true ($r.ExitCode -eq 0) $r.StdErr

        $r = Invoke-Mc @('cp', $probeLocal, "$tmpAlias/$b/$probeKey", '--no-color')
        $putOk = ($r.ExitCode -eq 0)
        Add-Result $b 'put' $true $putOk $r.StdErr

        if ($putOk) {
            $out = [System.IO.Path]::GetTempFileName()
            $r = Invoke-Mc @('cp', "$tmpAlias/$b/$probeKey", $out, '--no-color')
            Add-Result $b 'get' $true ($r.ExitCode -eq 0) $r.StdErr
            Remove-Item $out -Force -ErrorAction SilentlyContinue

            $r = Invoke-Mc @('rm', "$tmpAlias/$b/$probeKey", '--no-color')
            Add-Result $b 'rm' $true ($r.ExitCode -eq 0) $r.StdErr
        } else {
            Add-Result $b 'get' $true $false 'put failed, skipped get'
            Add-Result $b 'rm' $true $false 'put failed, skipped rm'
        }
    }

    foreach ($b in $ReadOnlyBucket) {
        $r = Invoke-Mc @('ls', "$tmpAlias/$b", '--no-color')
        Add-Result $b 'ls' $true ($r.ExitCode -eq 0) $r.StdErr

        # read one existing object to prove GetObject works
        $lsJson = Invoke-Mc @('ls', '--recursive', '--json', "$tmpAlias/$b", '--no-color')
        $firstKey = $null
        foreach ($line in ($lsJson.StdOut -split "`n")) {
            if (-not $line.Trim()) { continue }
            try { $o = $line | ConvertFrom-Json } catch { continue }
            if ($o.key) { $firstKey = $o.key; break }
        }
        if ($firstKey) {
            $out = [System.IO.Path]::GetTempFileName()
            $r = Invoke-Mc @('cp', "$tmpAlias/$b/$firstKey", $out, '--no-color')
            Add-Result $b 'get' $true ($r.ExitCode -eq 0) $r.StdErr
            Remove-Item $out -Force -ErrorAction SilentlyContinue
        } else {
            Add-Result $b 'get' $true $true 'bucket empty, skipped get'
        }

        $r = Invoke-Mc @('cp', $probeLocal, "$tmpAlias/$b/$probeKey", '--no-color')
        Add-Result $b 'put' $false ($r.ExitCode -eq 0) $r.StdErr
    }

    foreach ($b in $DeniedBucket) {
        $r = Invoke-Mc @('ls', "$tmpAlias/$b", '--no-color')
        Add-Result $b 'ls' $false ($r.ExitCode -eq 0) $r.StdErr
    }
} finally {
    Invoke-Mc @('alias', 'remove', $tmpAlias) | Out-Null
    Remove-Item $probeLocal -Force -ErrorAction SilentlyContinue
}

Write-Host ''
$results | Format-Table -AutoSize Bucket, Check, Expected, Actual, Verdict
$failed = @($results | Where-Object { $_.Verdict -eq 'FAIL' })
Write-Host ''
if ($failed.Count -eq 0) {
    Write-Host "ALL PASS: $($results.Count) checks" -ForegroundColor Green
    exit 0
} else {
    Write-Host "$($failed.Count) of $($results.Count) checks did not match expectation" -ForegroundColor Red
    $failed | ForEach-Object {
        Write-Host "  - $($_.Bucket) $($_.Check): expected $($_.Expected), got $($_.Actual) $($_.Detail)" -ForegroundColor Red
    }
    exit 1
}
