<#
.SYNOPSIS
  One-shot MinIO account setup: create buckets -> create IAM policy (per-bucket rw/ro)
  -> create user -> attach policy.

.EXAMPLE
  .\grant.ps1 -User ateam -Secret 'maeta@2026' -Bucket ateam,dsh -ReadOnlyBucket aife

.EXAMPLE
  # change permissions only, keep the existing user
  .\grant.ps1 -User ateam -Secret 'maeta@2026' -Bucket ateam -ReadOnlyBucket aife -SkipUserCreate

.NOTES
  ASCII-only on purpose: Windows PowerShell 5.1 decodes BOM-less .ps1 files with the ANSI code
  page, so non-ASCII literals can break parsing. Keep this file ASCII.
  The secret key must be 8-40 characters (MinIO rejects anything shorter).
#>
[CmdletBinding()]
param(
    # target alias; must point at a MinIO server with admin/root rights
    [string]$Alias = 'admin',
    # buckets that get read-write access; they are created too (unless -SkipBucketCreate)
    [string[]]$Bucket = @(),
    # buckets that get read-only access
    [string[]]$ReadOnlyBucket = @(),
    # user name (MinIO access key)
    [Parameter(Mandatory = $true)][string]$User,
    # secret key (MinIO secret key), 8-40 characters
    [Parameter(Mandatory = $true)][string]$Secret,
    # policy name, defaults to "<user>-rw"
    [string]$PolicyName = '',
    [switch]$SkipBucketCreate,
    [switch]$SkipUserCreate,
    # where the policy JSON is written, defaults to .\<PolicyName>.json
    [string]$PolicyOut = '',
    # mc executable; auto-detected when empty
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

# run mc, keep stdout and stderr apart; return an object instead of printing (progress bar noise)
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
        $errText = ($stderr -replace "`r", '')
        $cleanErr = ($errText -split "`n" | Where-Object { $_ -notmatch '^\s*[-.=]{3}' -and $_.Trim() -ne '' }) -join ' | '
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

function Assert-Ok {
    param($Result, [string]$What)
    if ($Result.ExitCode -ne 0) {
        $msg = $Result.StdErr
        if (-not $msg) { $msg = $Result.StdOut }
        throw "$What failed (exit=$($Result.ExitCode)): $msg"
    }
}

$script:McExe = Resolve-Mc $Mc

# ---- pre-flight: reject what the server would reject, before touching anything ----
if ($Secret.Length -lt 8 -or $Secret.Length -gt 40) {
    throw "secret key must be 8-40 characters, got $($Secret.Length) (MinIO limit)"
}
foreach ($b in ($Bucket + $ReadOnlyBucket)) {
    if ($b -notmatch '^[a-z0-9][a-z0-9.-]*[a-z0-9]$') {
        throw "invalid bucket name: '$b' (lowercase letters/digits only, no underscore)"
    }
}
if (-not $PolicyName) { $PolicyName = "$User-rw" }
if (-not $PolicyOut) { $PolicyOut = Join-Path (Get-Location).Path "$PolicyName.json" }

Write-Host "mc      : $script:McExe" -ForegroundColor DarkGray
Write-Host "alias   : $Alias" -ForegroundColor DarkGray
Write-Host "user    : $User    policy: $PolicyName" -ForegroundColor DarkGray
Write-Host "rw      : $($Bucket -join ', ')" -ForegroundColor DarkGray
Write-Host "ro      : $($ReadOnlyBucket -join ', ')" -ForegroundColor DarkGray

# ---- 1. buckets ----
if (-not $SkipBucketCreate) {
    foreach ($b in $Bucket) {
        $r = Invoke-Mc @('mb', '--ignore-existing', "$Alias/$b", '--no-color')
        Assert-Ok $r "create bucket $b"
        Write-Host "[ok] bucket $b" -ForegroundColor Green
    }
}

# ---- 2. build the policy ----
$statements = @()
if ($Bucket.Count -gt 0) {
    $statements += [pscustomobject]@{
        Sid      = 'BucketReadWrite'
        Effect   = 'Allow'
        Action   = @('s3:GetBucketLocation', 's3:ListBucket', 's3:ListBucketMultipartUploads', 's3:ListMultipartUploadParts')
        Resource = @($Bucket | ForEach-Object { "arn:aws:s3:::$_" })
    }
    $statements += [pscustomobject]@{
        Sid      = 'ObjectReadWrite'
        Effect   = 'Allow'
        Action   = @('s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts')
        Resource = @($Bucket | ForEach-Object { "arn:aws:s3:::$_/*" })
    }
}
if ($ReadOnlyBucket.Count -gt 0) {
    $statements += [pscustomobject]@{
        Sid      = 'BucketReadOnly'
        Effect   = 'Allow'
        Action   = @('s3:GetBucketLocation', 's3:ListBucket')
        Resource = @($ReadOnlyBucket | ForEach-Object { "arn:aws:s3:::$_" })
    }
    $statements += [pscustomobject]@{
        Sid      = 'ObjectReadOnly'
        Effect   = 'Allow'
        Action   = @('s3:GetObject')
        Resource = @($ReadOnlyBucket | ForEach-Object { "arn:aws:s3:::$_/*" })
    }
}
if ($statements.Count -eq 0) {
    throw 'need at least one -Bucket or -ReadOnlyBucket, otherwise the policy grants nothing'
}

$policyObj = [pscustomobject]@{ Version = '2012-10-17'; Statement = $statements }
$json = ($policyObj | ConvertTo-Json -Depth 10)
# write UTF-8 without BOM: MinIO parses the JSON, a BOM would be a parse error
[System.IO.File]::WriteAllText($PolicyOut, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[ok] policy JSON -> $PolicyOut" -ForegroundColor Green

$r = Invoke-Mc @('admin', 'policy', 'create', $Alias, $PolicyName, $PolicyOut, '--no-color')
Assert-Ok $r "create policy $PolicyName"
Write-Host "[ok] policy $PolicyName" -ForegroundColor Green

# ---- 3. user ----
if (-not $SkipUserCreate) {
    $info = Invoke-Mc @('admin', 'user', 'info', $Alias, $User, '--no-color')
    if ($info.ExitCode -eq 0) {
        Write-Host "[skip] user $User already exists" -ForegroundColor Yellow
    } else {
        $r = Invoke-Mc @('admin', 'user', 'add', $Alias, $User, $Secret, '--no-color')
        Assert-Ok $r "create user $User"
        Write-Host "[ok] user $User" -ForegroundColor Green
    }
}

# ---- 4. attach ----
$r = Invoke-Mc @('admin', 'policy', 'attach', $Alias, $PolicyName, '--user', $User, '--no-color')
Assert-Ok $r "attach policy $PolicyName to $User"
Write-Host "[ok] attach $PolicyName -> $User" -ForegroundColor Green

# ---- 5. summary ----
$info = Invoke-Mc @('admin', 'user', 'info', $Alias, $User, '--no-color')
Write-Host ''
Write-Host '---- user state ----' -ForegroundColor Cyan
Write-Host $info.StdOut
Write-Host '---- verify permissions with the new account ----' -ForegroundColor Cyan
Write-Host ".\verify.ps1 -Alias $Alias -User $User -Secret '<secret>' -Bucket $($Bucket -join ',') -ReadOnlyBucket $($ReadOnlyBucket -join ',')" -ForegroundColor Cyan
