$root = "F:\MCP-CLEAN\dashboard"
$target = Join-Path $root "start.cmd"
$shell = New-Object -ComObject WScript.Shell

function New-McpShortcut([string]$path) {
    $directory = Split-Path $path -Parent
    if (-not (Test-Path $directory)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = $root
    $shortcut.WindowStyle = 1
    $shortcut.Description = "MCP-CLEAN Dashboard"
    $shortcut.Save()
}

$desktop = Join-Path $env:USERPROFILE "Desktop"
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"

New-McpShortcut (Join-Path $desktop "MCP-CLEAN Dashboard.lnk")
New-McpShortcut (Join-Path $startMenu "MCP-CLEAN Dashboard.lnk")

Write-Output "Created MCP-CLEAN Dashboard shortcuts on Desktop and in Start Menu."
Write-Output "You can pin the Start Menu shortcut to Start or the taskbar from Windows shell."
