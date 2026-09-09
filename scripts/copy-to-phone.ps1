<#
.SYNOPSIS
  Copies the built APK straight onto the phone's Download folder over MTP.

.DESCRIPTION
  The phone shows up in Explorer as a shell namespace item, not a drive
  letter, so Copy-Item cannot reach it — MTP has no filesystem path. This goes
  through Shell.Application, the same COM interface Explorer itself uses.

  Never fails the build. A phone that is unplugged, asleep, or still showing
  "Charging only" is the normal case, not an error, so this warns and exits 0.
#>
param(
  [string]$Source = "android/app/build/outputs/apk/release/app-release.apk",
  [string]$DeviceName = "Take the L",
  [string]$StorageName = "Internal storage",
  [string]$FolderName = "Download",
  [string]$TargetName = "",
  [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"

# Versioned filename by default. MTP silently ignores both a delete and the
# overwrite flag, so copying onto an existing name leaves the *old* file in
# place while reporting success — the worst possible failure for something
# whose entire job is delivering a new build.
if ([string]::IsNullOrWhiteSpace($TargetName)) {
  $appJson = Get-Content (Join-Path (Split-Path -Parent $PSScriptRoot) "app.json") -Raw | ConvertFrom-Json
  $TargetName = "Pinch-$($appJson.expo.version).apk"
}

function Warn($message) {
  Write-Host "[copy-to-phone] $message"
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = if ([System.IO.Path]::IsPathRooted($Source)) { $Source } else { Join-Path $projectRoot $Source }

if (-not (Test-Path $sourcePath)) {
  Warn "No APK at $sourcePath - nothing to copy."
  exit 0
}

$shell = New-Object -ComObject Shell.Application

# 17 is the "This PC" namespace, where MTP devices appear alongside drives.
$device = $shell.NameSpace(17).Items() | Where-Object { $_.Name -eq $DeviceName }
if ($null -eq $device) {
  Warn "'$DeviceName' is not connected. Plug the phone in and set USB mode to File transfer, then re-run: npm run phone"
  exit 0
}

$storage = $device.GetFolder.Items() | Where-Object { $_.Name -eq $StorageName }
if ($null -eq $storage) {
  Warn "'$StorageName' not found on $DeviceName. The phone may still be locked - unlock it and re-run."
  exit 0
}

$destination = $storage.GetFolder.Items() | Where-Object { $_.Name -eq $FolderName }
if ($null -eq $destination) {
  Warn "'$FolderName' not found in $StorageName."
  exit 0
}
$destinationFolder = $destination.GetFolder

# CopyHere keeps the source file's name, so stage a correctly named copy in
# temp rather than pushing "app-release.apk" and renaming on the phone.
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("pinch-push-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $staging | Out-Null
$staged = Join-Path $staging $TargetName
Copy-Item $sourcePath $staged

$expectedSize = (Get-Item $staged).Length

try {
  # MTP will not overwrite in place; the stale copy has to go first.
  $existing = $destinationFolder.Items() | Where-Object { $_.Name -eq $TargetName }
  if ($null -ne $existing) {
    Warn "Replacing the existing $TargetName on the phone."
    try { $existing.InvokeVerb("delete") } catch { Warn "Could not delete the old file; continuing." }
    Start-Sleep -Milliseconds 1500
  }

  Warn "Copying $TargetName ($([math]::Round($expectedSize / 1MB, 1)) MB) to $DeviceName\$StorageName\$FolderName ..."
  # 16 answers "Yes to All" to any overwrite prompt, so this stays headless.
  $destinationFolder.CopyHere($staged, 16)

  # CopyHere returns immediately and copies on a background thread, so the
  # only way to know it finished is to watch the file grow on the device.
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $copied = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $item = $destinationFolder.Items() | Where-Object { $_.Name -eq $TargetName }
    if ($null -ne $item) {
      $size = [int64]$item.ExtendedProperty("Size")
      if ($size -eq $expectedSize) { $copied = $true; break }
    }
  }

  if ($copied) {
    Warn "Done. On the phone: Files -> Downloads -> $TargetName, tap to install over the old build."
  } else {
    Warn "Copy did not confirm within $TimeoutSeconds s. Check the phone's Downloads folder before installing."
    exit 0
  }
} finally {
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}
