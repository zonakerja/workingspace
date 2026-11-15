#!/bin/sh
# Menyalakan Hermes (profile agent) di laptop. Dijalankan dari Windows:
#   wsl -e sh /mnt/d/Development/Application/workingspace/apps/akai/agent/hermes/up.sh
# Backend Akasha berjalan di Windows → alamatnya = gateway default WSL (berubah setelah restart, dihitung setiap kali).
set -e
cd "$(dirname "$0")/../../../.."
AKASHA_API_HOST=$(ip route show default | awk '{print $3; exit}')
export AKASHA_API_HOST
echo "Backend Akasha (Windows) = $AKASHA_API_HOST:4000"
docker compose --profile agent up -d hermes

# Mount skill Akasha (/opt/data/skills/akasha) membuat Docker membuat /opt/data/skills milik root di volume → skill
# bawaan Hermes gagal disalin. Sekali saja: serahkan ke user hermes (UID 10000) lalu mulai ulang.
if [ "$(docker exec -u 0 akasha-hermes stat -c %u /opt/data/skills)" != "10000" ]; then
  docker exec -u 0 akasha-hermes chown 10000:10000 /opt/data/skills
  docker restart akasha-hermes >/dev/null
  echo "Folder skill diperbaiki, Hermes dimulai ulang."
fi

# Model lewat Akasha + MCP Akasha (tanpa API key di Hermes); dimulai ulang hanya bila konfigurasi berubah.
# Izin agen diaktifkan dari Akasha: Asisten Agen → Status & Skill → Siapkan agen.
docker exec akasha-hermes sh /opt/akasha/configure.sh
if docker exec akasha-hermes sh -c 'test -f /opt/data/.akasha-config-changed && rm /opt/data/.akasha-config-changed'; then
  docker restart akasha-hermes >/dev/null
  echo "Hermes dimulai ulang dengan konfigurasi baru."
fi
