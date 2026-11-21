<#
  Mematikan lingkungan development (data tetap aman: hanya menghentikan proses, tidak menghapus volume).
    powershell -ExecutionPolicy Bypass -File scripts\dev-down.ps1            # dev server + container
    powershell -ExecutionPolicy Bypass -File scripts\dev-down.ps1 -Shutdown  # + wsl --shutdown (membebaskan RAM)
#>
param([switch]$Shutdown)

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$drive = $root.Substring(0, 1).ToLower()
$wslRoot = "/mnt/$drive" + ($root.Substring(2) -replace "\\", "/")

Write-Host "1. Dev server (node milik proyek ini)" -ForegroundColor Cyan
$nodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*$root*" -or $_.CommandLine -like "*apps\akasha*" -or $_.CommandLine -like "*apps/akasha*" -or $_.CommandLine -like "*apps\auth*" -or $_.CommandLine -like "*apps\akai*" -or $_.CommandLine -like "*apps\landing*" }
foreach ($n in $nodes) {
  Stop-Process -Id $n.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Host ("  {0} proses node dihentikan" -f @($nodes).Count) -ForegroundColor Green

Write-Host "2. Container Docker (stop, bukan down -v)" -ForegroundColor Cyan
$wsl = (wsl --list --running 2>$null | Out-String) -replace "`0", ""
if ($wsl -match "Ubuntu") {
  wsl -e sh -c "cd '$wslRoot' && docker compose --profile office --profile robot --profile agent --profile converter stop"
} else {
  Write-Host "  WSL tidak berjalan - tidak ada container" -ForegroundColor DarkGray
}

Write-Host "3. Penjaga WSL" -ForegroundColor Cyan
Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*sleep infinity*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if ($Shutdown) { wsl --shutdown; Write-Host "  wsl --shutdown selesai" -ForegroundColor Green }
Write-Host "`nSelesai. Cek: scripts\dev-status.ps1 - aman menutup laptop bila semua [mati]." -ForegroundColor Cyan
