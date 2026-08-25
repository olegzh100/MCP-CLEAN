$root = "F:\MCP-CLEAN\dashboard"
$target = Join-Path $root "start.cmd"
$wshell = New-Object -ComObject WScript.Shell

function New-McpShortcut([string]$path) {
    $directory = Split-Path $path -Parent
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $shortcut = $wshell.CreateShortcut($path)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = $root
    $shortcut.WindowStyle = 1
    $shortcut.Description = "MCP-CLEAN Dashboard"
    $shortcut.Save()
}

# Find the physical Desktop that Explorer is actually showing.
$desktop = $null
try {
    $shellApp = New-Object -ComObject Shell.Application
    foreach ($w in $shellApp.Windows()) {
        try {
            if ($w.LocationName -eq 'Desktop' -and $w.LocationURL -like 'file:///*') {
                $uri = [Uri]$w.LocationURL
                $candidate = [Uri]::UnescapeDataString($uri.LocalPath)
                if (Test-Path -LiteralPath $candidate) {
                    $desktop = $candidate
                    break
                }
            }
        } catch {}
    }
} catch {}

if (-not $desktop) {
    $candidates = @(
        (Join-Path $env:USERPROFILE 'Creative Cloud Files\Desktop'),
        (Join-Path $env:USERPROFILE 'OneDrive\Desktop'),
        (Join-Path $env:USERPROFILE 'Desktop')
    )
    $desktop = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

if (-not $desktop) {
    throw 'Could not resolve the visible Windows Desktop folder.'
}

$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"

$desktopShortcut = Join-Path $desktop "MCP-CLEAN Dashboard.lnk"
$startShortcut = Join-Path $startMenu "MCP-CLEAN Dashboard.lnk"

New-McpShortcut $desktopShortcut
New-McpShortcut $startShortcut

Write-Output "Desktop shortcut: $desktopShortcut"
Write-Output "Start Menu shortcut: $startShortcut"
Write-Output "MCP-CLEAN Dashboard shortcuts created successfully."