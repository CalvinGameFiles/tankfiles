# Puts a "TankFiles" shortcut on the desktop that opens the game in its own window (minimised console behind it).
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$desktop = [Environment]::GetFolderPath('Desktop')
$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'TankFiles.lnk'))
$s.TargetPath = Join-Path $root 'Play TankFiles.bat'
$s.WorkingDirectory = $root
$s.IconLocation = (Join-Path $root 'www\img\icon.ico') + ',0'
$s.WindowStyle = 7
$s.Description = 'TankFiles - by CalvinGameFiles'
$s.Save()
Write-Output "Shortcut written to $desktop\TankFiles.lnk"
