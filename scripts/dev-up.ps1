<#
  Menyalakan lingkungan development workingspace (Akasha, SSO, Akai) di laptop — tanpa Claude.
  Jalankan dari folder proyek:
    powershell -ExecutionPolicy Bypass -File scripts\dev-up.ps1            # inti: Docker + backend + frontend + SSO
    powershell -ExecutionPolicy Bypass -File scripts\dev-up.ps1 -All       # inti + Akai + halaman depan + ONLYOFFICE + robot + converter + Hermes
    powershell -ExecutionPolicy Bypass -File scripts\dev-up.ps1 -Akai -Office -Robot   # pilih sendiri
  Komponen yang port-nya sudah dipakai tidak dinyalakan lagi (aman dijalankan berulang). Setiap dev server dibuka di
  jendela PowerShell sendiri; tutup jendelanya (atau Ctrl+C) untuk menghentikan, atau jalankan scripts\dev-down.ps1.
#>
param(
  [switch]$All,
  [switch]$Akai,
  [switch]$Landing,
  [switch]$Office,
  [switch]$Robot,
  [switch]$Converter,
  [switch]$Agent
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$drive = $root.Substring(0, 1).ToLower()
$wslRoot = "/mnt/$drive" + ($root.Substring(2) -replace "\\", "/")
if ($All) { $Akai = $Landing = $Office = $Robot = $Converter = $Agent = $true }

function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Start-DevWindow([string]$title, [int]$port, [string]$command) {
  if (Test-Port $port) {
    Write-Host ("  {0,-22} port {1} sudah aktif - dilewati" -f $title, $port) -ForegroundColor DarkGray
    return
  }
  $script = "`$Host.UI.RawUI.WindowTitle = '$title ($port)'; Set-Location '$root'; $command"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", $script | Out-Null
  Write-Host ("  {0,-22} dinyalakan (port {1})" -f $title, $port) -ForegroundColor Green
}

Write-Host "1. WSL & Docker" -ForegroundColor Cyan
$running = wsl --list --running 2>$null | Out-String
$keeper = Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*sleep infinity*" }
if (-not $keeper) {
  # Penjaga agar WSL tidak berhenti saat idle (jendela kecil; tutup = WSL boleh berhenti)
  Start-Process wsl -ArgumentList "-e", "sh", "-c", "sleep infinity" -WindowStyle Minimized | Out-Null
  Write-Host "  penjaga WSL (sleep infinity) dinyalakan" -ForegroundColor Green
} else {
  Write-Host "  penjaga WSL sudah berjalan" -ForegroundColor DarkGray
}

$profiles = @()
if ($Office) { $profiles += "--profile office" }
if ($Robot) { $profiles += "--profile robot" }
if ($Converter) { $profiles += "--profile converter" }
$profileArgs = $profiles -join " "
Write-Host "  docker compose up (postgres, redis, storage $profileArgs) ..." -ForegroundColor Gray
wsl -e sh -c "cd '$wslRoot' && docker compose $profileArgs up -d --wait"
if ($LASTEXITCODE -ne 0) { Write-Warning "docker compose gagal - lihat pesan di atas (docs/SETUP.md §13)."; exit 1 }
# Proyek lain (OnTrack) bisa merebut port 5432/6379 bila ikut menyala
$foreign = wsl -e sh -c "docker ps --format '{{.Names}}' | grep -E '^ontrack_' || true"
if ($foreign) { Write-Warning "Container OnTrack menyala ($($foreign -join ', ')) dan bisa merebut port 5432/6379. Hentikan: wsl -e sh -c `"docker stop $($foreign -join ' ')`"" }

Write-Host "2. Dev server" -ForegroundColor Cyan
Start-DevWindow "SSO API" 4300 "npm --prefix apps/auth/api run dev"
Start-DevWindow "Halaman SSO" 5175 "npm --prefix apps/auth/web run dev"
Start-DevWindow "Backend Akasha" 4000 "npm --prefix apps/akasha/api run dev"
Start-DevWindow "Frontend Akasha" 5173 "npm --prefix apps/akasha/web run dev"
if ($Akai) {
  Start-DevWindow "Akai API" 4400 "npm --prefix apps/akai/api run dev"
  Start-DevWindow "Akai web" 5177 "npm --prefix apps/akai/web run dev"
}
if ($Landing) { Start-DevWindow "Halaman depan" 5176 "npm --prefix apps/landing run dev" }

if ($Agent) {
  Write-Host "3. Hermes (menunggu backend 4000 siap)" -ForegroundColor Cyan
  $deadline = (Get-Date).AddMinutes(3)
  while (-not (Test-Port 4000) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
  wsl -e sh "$wslRoot/apps/akai/agent/hermes/up.sh"
}

Write-Host ""
Write-Host "Selesai. Buka http://localhost:5173 -> Masuk dengan akun Workingspace (dev: noreply@workingspace.id / 123)." -ForegroundColor Cyan
Write-Host "Backend butuh +/- 30 detik sampai siap. Cek status: scripts\dev-status.ps1 · Matikan: scripts\dev-down.ps1"
