# syntax=docker/dockerfile:1
# ============================================================================
# LifeOS Backend (NestJS + Prisma). Image produksi multi-stage, dibangun dari root monorepo:
#   docker build -f apps/akasha/api/Dockerfile -t lifeos-backend .
# `turbo prune` menyisakan workspace @akasha/api + lockfile terpangkas, lalu npm ci di root workspace.
# Saat start: menerapkan migrasi database lalu menjalankan API.
# ============================================================================

FROM node:24-trixie-slim AS base
# OpenSSL dibutuhkan schema engine Prisma (migrate deploy); tanpa ini Prisma salah mendeteksi versi libssl
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS prune
WORKDIR /repo
RUN npm install -g turbo@2.11.10
COPY . .
RUN turbo prune @akasha/api --docker

FROM base AS deps
WORKDIR /app
COPY --from=prune /repo/out/json/ ./
# Skema & config dibutuhkan postinstall (prisma generate → src/generated/prisma)
COPY apps/akasha/api/prisma.config.ts ./apps/akasha/api/
COPY apps/akasha/api/prisma ./apps/akasha/api/prisma
RUN npm ci

FROM deps AS build
COPY --from=prune /repo/out/full/ ./
RUN npm run build -w @akasha/api \
  && npm prune --omit=dev \
  && mkdir -p apps/akasha/api/node_modules

FROM base AS runtime
ENV NODE_ENV=production \
  NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
WORKDIR /app/apps/akasha/api
COPY --from=build --chown=node:node /app/apps/akasha/api/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/akasha/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/akasha/api/prisma ./prisma
# Templat dokumen kosong ONLYOFFICE (POST /office/documents) + templat vault Obsidian (Tools → Basis Pengetahuan)
COPY --from=build --chown=node:node /app/apps/akasha/api/templates ./templates
COPY --from=build --chown=node:node /app/apps/akasha/api/package.json /app/apps/akasha/api/prisma.config.ts ./
# Folder font ONLYOFFICE (volume bersama) & folder vault Obsidian; dibuat di image agar dimiliki user node
RUN mkdir -p /app/office-fonts /app/knowledge-vaults && chown node:node /app/office-fonts /app/knowledge-vaults
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "-c", "node /app/node_modules/prisma/build/index.js migrate deploy && exec node dist/main.js"]
