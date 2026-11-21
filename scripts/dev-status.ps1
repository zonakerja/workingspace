<#
  Status lingkungan development (tidak menyalakan / mematikan apa pun).
    powershell -ExecutionPolicy Bypass -File scripts\dev-status.ps1
#>
$components = [ordered]@{
  5173 = "Frontend Akasha (http://localhost:5173)"
  4000 = "Backend Akasha (http://localhost:4000/api/v1/health)"
  4300 = "SSO API (http://localhost:4300/api/health)"
  5175 = "Halaman SSO (http://auth.workingspace.localhost:5175)"
  5176 = "Halaman depan (http://workingspace.localhost:5176)"
  4400 = "Akai API (http://localhost:4400/api/health)"
  5177 = "Akai web (http://akai.workingspace.localhost:5177)"
  5432 = "PostgreSQL (Docker)"
  6379 = "Redis (Docker)"
  8333 = "SeaweedFS S3 (Docker)"
  8888 = "SeaweedFS filer (Docker)"
  8080 = "ONLYOFFICE (Docker, profile office)"
  4100 = "Robot Playwright (Docker, profile robot)"
  4200 = "Markdown Converter (Docker, profile converter)"
  8642 = "Hermes (Docker, profile agent)"
}
foreach ($entry in $components.GetEnumerator()) {
  # Kunci angka pada OrderedDictionary dibaca sebagai indeks posisi -> ambil lewat enumerator
  $port = $entry.Key
  $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) {
    $proc = (Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    Write-Host ("[aktif] {0,-5} {1}  ({2})" -f $port, $entry.Value, $proc) -ForegroundColor Green
  } else {
    Write-Host ("[mati ] {0,-5} {1}" -f $port, $entry.Value) -ForegroundColor DarkGray
  }
}
$wsl = (wsl --list --running 2>$null | Out-String) -replace "`0", ""
if ($wsl -match "Ubuntu") {
  Write-Host "`nWSL berjalan. Container:" -ForegroundColor Cyan
  wsl -e sh -c "docker ps --format '  {{.Names}}  {{.Status}}'"
} else {
  Write-Host "`nWSL berhenti (semua container mati)." -ForegroundColor DarkGray
}
