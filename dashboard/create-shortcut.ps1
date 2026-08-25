$root = "F:\MCP-CLEAN\dashboard"
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcut = $shell.CreateShortcut((Join-Path $desktop "MCP-CLEAN Dashboard.lnk"))
$shortcut.TargetPath = Join-Path $root "start.cmd"
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 1
$shortcut.Description = "MCP-CLEAN Dashboard"
$shortcut.Save()

