#!/bin/sh
# Konfigurasi Hermes untuk Akasha — dijalankan DI DALAM container hermes oleh up.sh (dev) atau
#   docker compose -f docker-compose.prod.yml exec hermes sh /opt/akasha/configure.sh   (produksi)
# Tidak berisi rahasia & aman diulang (idempoten). docs/AI-AGENT.md §23.
#
# - Model: provider "custom" = endpoint OpenAI-compatible Akasha. Akasha meneruskan ke provider & API key pilihan user
#   (Pengaturan → Model AI), jadi API key model TIDAK disimpan di Hermes.
# - Kunci Hermes → Akasha = ${API_SERVER_KEY} (env container, sama dengan HERMES_API_KEY backend) untuk model & MCP.
#   Izinnya diaktifkan dari Akasha: Asisten Agen → Status & Skill → Siapkan agen.
set -e
AKASHA_BASE="${AKASHA_BASE:-http://akasha-api:4000/api/v1}"
CONFIG=/opt/data/config.yaml

if [ ! -f "$CONFIG" ]; then
  echo "config.yaml Hermes belum ada — jalankan Hermes sekali dulu."
  exit 1
fi

set_value() {
  current=$(hermes config get "$1" 2>/dev/null || true)
  if [ "$current" != "$2" ]; then
    hermes config set "$1" "$2" >/dev/null
    CHANGED=1
  fi
}

CHANGED=0
set_value model.provider custom
set_value model.base_url "$AKASHA_BASE/agent/llm/v1"
set_value model.default akasha-agent

# Nilai ${...} harus tertulis apa adanya (Hermes mengganti dengan env saat memuat config) → tulis lewat sed, bukan
# `hermes config set` yang menyimpan hasil terjemahannya.
if ! grep -q 'api_key: "\${API_SERVER_KEY}"' "$CONFIG"; then
  sed -i '/^model:/,/^[a-z]/{/^  api_key:/d}' "$CONFIG"
  sed -i 's/^model:$/model:\n  api_key: "${API_SERVER_KEY}"/' "$CONFIG"
  CHANGED=1
fi

# MCP server Akasha (blok di akasha-mcp.yaml); blok lama berbasis AKASHA_MCP_TOKEN diganti
if grep -q 'AKASHA_MCP_TOKEN' "$CONFIG"; then
  sed -i 's/\${AKASHA_MCP_TOKEN}/${API_SERVER_KEY}/' "$CONFIG"
  CHANGED=1
fi
if ! grep -q '^mcp_servers:' "$CONFIG"; then
  sed "s#http://akasha-api:4000/api/v1#$AKASHA_BASE#" /opt/akasha/akasha-mcp.yaml >>"$CONFIG"
  CHANGED=1
elif ! grep -q '/api/v1/mcp' "$CONFIG"; then
  echo "PERINGATAN: config.yaml sudah punya mcp_servers lain — tambahkan blok dari apps/akai/agent/hermes/akasha-mcp.yaml manual."
fi

# Gateway membaca API_SERVER_KEY dari .env profil; tanpa baris ini API server tidak terbuka setelah container dimulai
# ulang ("No messaging platforms enabled"). Nilai di .env menang atas env container, jadi selalu disamakan.
ENV_FILE=/opt/data/.env
if [ -n "${API_SERVER_KEY:-}" ] && ! grep -qxF "API_SERVER_KEY=$API_SERVER_KEY" "$ENV_FILE" 2>/dev/null; then
  sed -i '/^API_SERVER_KEY=/d' "$ENV_FILE" 2>/dev/null || true
  printf 'API_SERVER_KEY=%s\n' "$API_SERVER_KEY" >>"$ENV_FILE"
  CHANGED=1
fi

# Batasi agen ke MCP Akasha (docs/AI-AGENT.md §26). Terminal, berkas, kode, dan browser akan melewati semua pembatasan
# fitur native karena dari container agen bisa menjangkau layanan lain secara langsung. Skill & memori tetap menyala.
for toolset in terminal file code_execution browser web image_gen vision connections delegation cronjob computer_use; do
  if hermes tools list --platform api_server 2>/dev/null | grep -qE "[^s]enabled +$toolset "; then
    hermes tools disable --platform api_server "$toolset" >/dev/null
    CHANGED=1
  fi
done

if [ "$CHANGED" = 1 ]; then
  echo "Konfigurasi Hermes diperbarui (model lewat Akasha + MCP Akasha)."
  touch /opt/data/.akasha-config-changed
else
  echo "Konfigurasi Hermes sudah sesuai."
fi
