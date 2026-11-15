# ONLYOFFICE Docs Community + plugin AI resmi ONLYOFFICE yang dijalankan dengan AI Akasha (docs/ONLYOFFICE.md §3.4).
# - Plugin AI tidak ikut image Community → dipasang saat build (butuh internet sekali; versi terbaru di marketplace).
# - Jembatan Akasha (akasha-ai-bridge.js) disisipkan ke plugin: tab AI memakai provider & API key user di
#   Pengaturan → AI lewat backend Akasha, tanpa pengaturan key di editor. Tab AI hanya tampil bila user mengaktifkannya
#   (config editor dari backend: customization.ai.disabled). Build gagal bila struktur plugin berubah (cek grep).
# Font tambahan TIDAK dimasukkan ke image: folder font bersama di-mount ke /usr/share/fonts/truetype/custom (dev:
# infra/onlyoffice/fonts, produksi: volume yang juga ditulis backend saat admin mengunggah font). Daftar font dibuat ulang
# setiap start (GENERATE_FONTS=true bawaan image) dan saat isi folder berubah (pemantau di akasha-entrypoint.sh).
FROM onlyoffice/documentserver:10.0

COPY akasha-ai-bridge.js /tmp/akasha-ai-bridge.js
COPY --chmod=755 akasha-entrypoint.sh /app/akasha-entrypoint.sh

RUN set -e; \
  documentserver-pluginsmanager.sh -r false --install="ai"; \
  P="/var/www/onlyoffice/documentserver/sdkjs-plugins/{9DC93CDB-B576-4F0C-B55E-FCC9C48DD007}"; \
  test -f "$P/config.json"; \
  cp /tmp/akasha-ai-bridge.js "$P/scripts/akasha-ai-bridge.js"; \
  grep -q 'window.Asc.plugin.init = async function() {' "$P/scripts/code.js"; \
  sed -i 's|window.Asc.plugin.init = async function() {|&\n\tif (window.akashaApplyAiSettings) window.akashaApplyAiSettings();|' "$P/scripts/code.js"; \
  grep -q 'src="scripts/code.js"' "$P/index.html"; \
  sed -i 's|<script type="text/javascript" src="scripts/code.js"></script>|<script type="text/javascript" src="scripts/akasha-ai-bridge.js"></script>\n  &|' "$P/index.html"; \
  grep -q 'akasha-ai-bridge.js' "$P/index.html"; \
  grep -q 'akashaApplyAiSettings' "$P/scripts/code.js"; \
  for f in "$P/scripts/code.js" "$P/index.html" "$P/scripts/akasha-ai-bridge.js"; do gzip -kf9 "$f"; done; \
  chown -R ds:ds "$P"; \
  rm /tmp/akasha-ai-bridge.js

ENTRYPOINT ["/app/akasha-entrypoint.sh"]
