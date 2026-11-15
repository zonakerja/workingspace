#!/bin/sh
# Uji manual: kirim setiap berkas di folder contoh ke /convert (dijalankan di dalam container converter).
# sh tests/try_convert.sh /tmp/samples
dir="${1:-/tmp/samples}"
for f in "$dir"/*; do
  echo "=== $(basename "$f")"
  curl -s -H "Authorization: Bearer $CONVERTER_TOKEN" -F "file=@$f" -F "filename=$(basename "$f")" http://127.0.0.1:4200/convert |
    python -c "import json,sys; r=json.load(sys.stdin); print({k: r.get(k) for k in ('engine','reason','pages','chars','tokens','durationMs','warnings','detail')}); print((r.get('markdown') or '')[:600])"
done
