# syntax=docker/dockerfile:1
# ============================================================================
# Akai API — gateway model ekosistem workingspace.id (NestJS + Prisma). Dibangun dari root monorepo:
#   docker build -f apps/akai/api/Dockerfile -t akai-api .
# Saat start: menerapkan migrasi database (DB akai) lalu menjalankan API di port 4400.
# Di produksi Caddy meneruskan akai.workingspace.id/api/* ke service ini; gateway /gateway/* hanya dari jaringan internal
# (Akasha memanggil http://akai-api:4400). docs/AKAI.md.
# ============================================================================

FROM node:24-trixie-slim AS base
# OpenSSL dibutuhkan schema engine Prisma (migrate deploy)
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS prune
WORKDIR /repo
RUN npm install -g turbo@2.11.10
COPY . .
RUN turbo prune @akai/api --docker

FROM base AS deps
WORKDIR /app
COPY --from=prune /repo/out/json/ ./
# Skema & config dibutuhkan postinstall (prisma generate → src/generated/prisma)
COPY apps/akai/api/prisma.config.ts ./apps/akai/api/
COPY apps/akai/api/prisma ./apps/akai/api/prisma
RUN npm ci

FROM deps AS build
COPY --from=prune /repo/out/full/ ./
RUN npm run build -w @akai/api \
  && npm prune --omit=dev \
  && mkdir -p apps/akai/api/node_modules

FROM base AS runtime
ENV NODE_ENV=production \
  NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
WORKDIR /app/apps/akai/api
COPY --from=build --chown=node:node /app/apps/akai/api/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/akai/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/akai/api/prisma ./prisma
COPY --from=build --chown=node:node /app/apps/akai/api/package.json /app/apps/akai/api/prisma.config.ts ./
USER node
EXPOSE 4400
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://localhost:4400/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "-c", "node /app/node_modules/prisma/build/index.js migrate deploy && exec node dist/main.js"]
