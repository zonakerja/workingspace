#!/bin/sh
# Backup berkala Akasha (service `backup` di docker-compose.prod.yml). Panduan: docs/DEPLOYMENT.md §4.
#
#   backup.sh            loop: backup setiap BACKUP_INTERVAL_HOURS jam
#   backup.sh --once     satu kali backup (exit 0 = sukses)
#   backup.sh --health   healthcheck Docker: sukses terakhir masih dalam jadwal?
#   backup.sh rclone …   jalankan rclone dengan remote yang sudah terkonfigurasi (src, offsite)
#
# Isi /backups:
#   db-<waktu>.dump              pg_dump format custom (divalidasi pg_restore --list), retensi BACKUP_RETENTION_DAYS
#   storage/current/             cermin bucket object storage (diambil lewat API S3, konsisten walau storage berjalan)
#   storage/changed/<waktu>/     berkas yang dihapus/diganti sejak backup sebelumnya, retensi BACKUP_RETENTION_DAYS
# Salinan luar server (opsional, bila OFFSITE_S3_BUCKET atau OFFSITE_DRIVE_TYPE diisi): remote S3 lain atau Google Drive /
# OneDrive, terenkripsi rclone crypt
# (isi & nama berkas) dengan BACKUP_ENCRYPTION_PASSWORD, retensi OFFSITE_RETENTION_DAYS.
# Pemantauan (opsional): BACKUP_HEALTHCHECK_URL di-ping saat sukses, <url>/fail saat gagal (healthchecks.io).
set -eu

INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
OFFSITE_RETENTION_DAYS="${OFFSITE_RETENTION_DAYS:-30}"
BUCKET="${ASSET_BUCKET:-akasha-assets}"
DIR=/backups
MARKER="$DIR/.last-success"

log() { echo "[backup] $*"; }

# Salinan luar server aktif bila S3 atau Drive/OneDrive diatur (S3 menang bila keduanya diisi)
offsite_enabled() { [ -n "${OFFSITE_S3_BUCKET:-}" ] || [ -n "${OFFSITE_DRIVE_TYPE:-}" ]; }

# Remote rclone dari env (tanpa file konfigurasi). `src` = object storage aplikasi; `offsite` = crypt di atas
# `offsiteraw` (S3 luar server, Google Drive, atau OneDrive).
configure_rclone() {
  export RCLONE_CONFIG_SRC_TYPE=s3
  export RCLONE_CONFIG_SRC_PROVIDER=Other
  export RCLONE_CONFIG_SRC_ENDPOINT="${S3_ENDPOINT:-http://storage:8333}"
  export RCLONE_CONFIG_SRC_REGION="${S3_REGION:-us-east-1}"
  export RCLONE_CONFIG_SRC_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-}"
  export RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-}"
  export RCLONE_CONFIG_SRC_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"
  if offsite_enabled; then
    if [ -z "${BACKUP_ENCRYPTION_PASSWORD:-}" ]; then
      log "Salinan luar server diatur tetapi BACKUP_ENCRYPTION_PASSWORD kosong" >&2
      return 1
    fi
  fi
  if [ -n "${OFFSITE_DRIVE_TYPE:-}" ] && [ -z "${OFFSITE_S3_BUCKET:-}" ]; then
    # Google Drive / OneDrive (docs/AKUN-TERSAMBUNG.md tahap 0): token OAuth dari `rclone authorize "drive"` / `"onedrive"`
    # di laptop. Isi tetap dienkripsi rclone crypt, jadi penyedia drive hanya melihat berkas acak.
    case "$OFFSITE_DRIVE_TYPE" in
      drive)
        export RCLONE_CONFIG_OFFSITERAW_TYPE=drive
        # drive.file: rclone hanya melihat berkas yang dibuatnya sendiri, bukan seluruh isi Drive
        export RCLONE_CONFIG_OFFSITERAW_SCOPE="${OFFSITE_DRIVE_SCOPE:-drive.file}"
        ;;
      onedrive)
        export RCLONE_CONFIG_OFFSITERAW_TYPE=onedrive
        export RCLONE_CONFIG_OFFSITERAW_DRIVE_TYPE="${OFFSITE_ONEDRIVE_DRIVE_TYPE:-personal}"
        export RCLONE_CONFIG_OFFSITERAW_DRIVE_ID="${OFFSITE_ONEDRIVE_DRIVE_ID:-}"
        ;;
      *)
        log "OFFSITE_DRIVE_TYPE harus drive atau onedrive" >&2
        return 1
        ;;
    esac
    if [ -z "${OFFSITE_DRIVE_TOKEN:-}" ]; then
      log "OFFSITE_DRIVE_TOKEN kosong (jalankan rclone authorize \"$OFFSITE_DRIVE_TYPE\" di laptop)" >&2
      return 1
    fi
    export RCLONE_CONFIG_OFFSITERAW_TOKEN="$OFFSITE_DRIVE_TOKEN"
    [ -z "${OFFSITE_DRIVE_CLIENT_ID:-}" ] || export RCLONE_CONFIG_OFFSITERAW_CLIENT_ID="$OFFSITE_DRIVE_CLIENT_ID"
    [ -z "${OFFSITE_DRIVE_CLIENT_SECRET:-}" ] || export RCLONE_CONFIG_OFFSITERAW_CLIENT_SECRET="$OFFSITE_DRIVE_CLIENT_SECRET"
    export RCLONE_CONFIG_OFFSITE_TYPE=crypt
    export RCLONE_CONFIG_OFFSITE_REMOTE="offsiteraw:${OFFSITE_DRIVE_FOLDER:-akasha-backup}"
    RCLONE_CONFIG_OFFSITE_PASSWORD="$(rclone obscure "$BACKUP_ENCRYPTION_PASSWORD")" || return 1
    export RCLONE_CONFIG_OFFSITE_PASSWORD
  fi
  if [ -n "${OFFSITE_S3_BUCKET:-}" ]; then
    export RCLONE_CONFIG_OFFSITERAW_TYPE=s3
    export RCLONE_CONFIG_OFFSITERAW_PROVIDER="${OFFSITE_S3_PROVIDER:-Other}"
    export RCLONE_CONFIG_OFFSITERAW_ENDPOINT="${OFFSITE_S3_ENDPOINT:-}"
    export RCLONE_CONFIG_OFFSITERAW_REGION="${OFFSITE_S3_REGION:-auto}"
    export RCLONE_CONFIG_OFFSITERAW_ACCESS_KEY_ID="${OFFSITE_S3_ACCESS_KEY_ID:-}"
    export RCLONE_CONFIG_OFFSITERAW_SECRET_ACCESS_KEY="${OFFSITE_S3_SECRET_ACCESS_KEY:-}"
    # Bucket dibuat manual di penyedia; key cukup punya izin baca/tulis objek
    export RCLONE_CONFIG_OFFSITERAW_NO_CHECK_BUCKET=true
    export RCLONE_CONFIG_OFFSITE_TYPE=crypt
    export RCLONE_CONFIG_OFFSITE_REMOTE="offsiteraw:${OFFSITE_S3_BUCKET}/${OFFSITE_S3_PREFIX:-akasha}"
    RCLONE_CONFIG_OFFSITE_PASSWORD="$(rclone obscure "$BACKUP_ENCRYPTION_PASSWORD")" || return 1
    export RCLONE_CONFIG_OFFSITE_PASSWORD
  fi
}

ping_monitor() {
  [ -n "${BACKUP_HEALTHCHECK_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_HEALTHCHECK_URL}$1" || log "ping pemantauan gagal" >&2
}

# Hapus subfolder bernama <yyyymmdd-hhmmss> yang lebih tua dari N hari (berdasarkan nama, bukan mtime berkas).
prune_stamped_dirs() { # <rclone-path> <hari>
  cutoff="$(date -u -d "-$2 days" +%Y%m%d%H%M%S)"
  rclone lsf --dirs-only "$1" 2>/dev/null | tr -d / | while read -r stamp; do
    case "$stamp" in
      [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]) ;;
      *) continue ;;
    esac
    if [ "$(echo "$stamp" | tr -d -)" -lt "$cutoff" ]; then
      rclone purge "$1/$stamp" || return 1
    fi
  done
}

dump_one() { # <database> <file>
  pg_dump --format=custom --no-owner --dbname="$1" --file="$2.partial" || { rm -f "$2.partial"; return 1; }
  pg_restore --list "$2.partial" >/dev/null || { rm -f "$2.partial"; log "dump $1 tidak valid" >&2; return 1; }
  mv "$2.partial" "$2" || return 1
  log "database $1: $(du -h "$2" | cut -f1) → $(basename "$2")"
}

# Database utama (PGDATABASE) → db-<stamp>.dump; EXTRA_DATABASES (spasi/koma) → db-<nama>-<stamp>.dump
backup_database() { # <stamp>
  dump_one "${PGDATABASE:-akasha}" "$DIR/db-$1.dump" || return 1
  for extra in $(echo "${EXTRA_DATABASES:-}" | tr ',' ' '); do
    dump_one "$extra" "$DIR/db-$extra-$1.dump" || return 1
  done
  find "$DIR" -maxdepth 1 -type f -name 'db-*.dump' -mtime "+$RETENTION_DAYS" -delete || return 1
}

backup_storage() { # <stamp>
  if ! rclone lsf --dirs-only src: 2>/dev/null | grep -qx "$BUCKET/"; then
    log "bucket $BUCKET belum ada, backup berkas dilewati"
    return 0
  fi
  rclone sync "src:$BUCKET" "$DIR/storage/current" --backup-dir "$DIR/storage/changed/$1" || return 1
  prune_stamped_dirs "$DIR/storage/changed" "$RETENTION_DAYS" || return 1
  log "berkas: $(rclone size --json "$DIR/storage/current" | tr -d '\n')"
}

backup_offsite() { # <stamp>
  if ! offsite_enabled; then
    log "PERINGATAN: salinan luar server belum diatur — backup hanya ada di server ini"
    return 0
  fi
  rclone copy "$DIR" offsite:db --max-depth 1 --include 'db-*.dump' || return 1
  rclone delete offsite:db --min-age "${OFFSITE_RETENTION_DAYS}d" || return 1
  if [ -d "$DIR/storage/current" ]; then
    rclone sync "$DIR/storage/current" offsite:storage/current --backup-dir "offsite:storage/changed/$1" || return 1
    prune_stamped_dirs offsite:storage/changed "$OFFSITE_RETENTION_DAYS" || return 1
  fi
  log "salinan luar server diperbarui (terenkripsi)"
}

run_backup() {
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  log "mulai $stamp"
  backup_database "$stamp" || return 1
  backup_storage "$stamp" || return 1
  backup_offsite "$stamp" || return 1
  date -u +%s >"$MARKER"
  log "selesai $stamp"
}

# Satu backup dalam kunci (mencegah backup manual bentrok dengan jadwal), lapor ke pemantauan.
run_once() {
  status=0
  (flock -n 9 || exit 75; run_backup) 9>/tmp/backup.lock || status=$?
  case "$status" in
    0) ping_monitor "" ;;
    75) log "backup lain sedang berjalan, dilewati" >&2 ;;
    *)
      log "GAGAL" >&2
      ping_monitor /fail
      ;;
  esac
  return "$status"
}

case "${1:-}" in
  --health)
    [ -f "$MARKER" ] || exit 1
    # Sehat bila sukses terakhir tidak lebih lama dari interval + 2 jam
    [ $(($(date -u +%s) - $(cat "$MARKER"))) -le $((INTERVAL_HOURS * 3600 + 7200)) ]
    ;;
  rclone)
    shift
    configure_rclone
    exec rclone "$@"
    ;;
  --once)
    configure_rclone
    run_once
    ;;
  "")
    configure_rclone
    while true; do
      run_once || log "dicoba lagi pada jadwal berikutnya" >&2
      sleep $((INTERVAL_HOURS * 3600))
    done
    ;;
  *)
    echo "Pemakaian: backup.sh [--once | --health | rclone <argumen>]" >&2
    exit 2
    ;;
esac
