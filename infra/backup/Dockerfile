# syntax=docker/dockerfile:1
# ============================================================================
# Image service `backup` (docker-compose.prod.yml): pg_dump/pg_restore + rclone + curl.
# Base HARUS sama dengan image service `postgres` (versi pg_dump = versi server).
# ============================================================================

FROM rclone/rclone:1.75.1 AS rclone

FROM pgvector/pgvector:0.8.7-pg18
# curl untuk heartbeat pemantauan + ca-certificates (rclone ke S3 luar server); binary rclone statis dari image resminya.
# apt hanya memakai repo Debian lewat https (repo PostgreSQL pgdg bawaan image dilewati; metode http apt bisa sangat lambat di
# sebagian jaringan Docker). Sertifikat CA sementara dari image rclone hanya untuk unduhan ini; tanda tangan paket tetap diperiksa apt.
COPY --from=rclone /etc/ssl/certs/ca-certificates.crt /tmp/apt-ca.crt
RUN mkdir -p /tmp/apt-debian \
  && sed 's#http://deb.debian.org#https://deb.debian.org#g' /etc/apt/sources.list.d/debian.sources > /tmp/apt-debian/debian.sources \
  && APT_OPTS="-o Acquire::https::CaInfo=/tmp/apt-ca.crt -o Dir::Etc::SourceParts=/tmp/apt-debian -o Dir::Etc::SourceList=/dev/null" \
  && apt-get $APT_OPTS update \
  && apt-get $APT_OPTS install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* /tmp/apt-debian /tmp/apt-ca.crt
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
# Remote rclone dikonfigurasi lewat env (backup.sh); file kosong mencegah NOTICE "config file not found"
ENV RCLONE_CONFIG=/etc/rclone/rclone.conf
RUN mkdir -p /etc/rclone && touch /etc/rclone/rclone.conf
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod 755 /usr/local/bin/backup.sh
HEALTHCHECK --interval=5m --timeout=10s --start-period=10m CMD ["backup.sh", "--health"]
ENTRYPOINT ["backup.sh"]
