# syntax=docker/dockerfile:1
# ============================================================================
# Layanan SSO workingspace.id (NestJS + oidc-provider + Prisma). Dibangun dari root monorepo:
#   docker build -f apps/auth/api/Dockerfile -t workingspace-auth-api .
# Saat start: menerapkan migrasi database (DB workingspace_auth) lalu menjalankan API di port 4300.
# Di produksi Caddy meneruskan auth.workingspace.id/{api,oidc,interaction}/* ke service ini (docs/SSO.md §2.9).
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
RUN turbo prune @workingspace/auth-api --docker

FROM base AS deps
WORKDIR /app
COPY --from=prune /repo/out/json/ ./
# Skema & config dibutuhkan postinstall (prisma generate → src/generated/prisma)
COPY apps/auth/api/prisma.config.ts ./apps/auth/api/
COPY apps/auth/api/prisma ./apps/auth/api/prisma
RUN npm ci

FROM deps AS build
COPY --from=prune /repo/out/full/ ./
RUN npm run build -w @workingspace/auth-api \
  && npm prune --omit=dev \
  && mkdir -p apps/auth/api/node_modules

FROM base AS runtime
ENV NODE_ENV=production \
  NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
WORKDIR /app/apps/auth/api
COPY --from=build --chown=node:node /app/apps/auth/api/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/auth/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/auth/api/prisma ./prisma
COPY --from=build --chown=node:node /app/apps/auth/api/package.json /app/apps/auth/api/prisma.config.ts ./
USER node
EXPOSE 4300
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://localhost:4300/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "-c", "node /app/node_modules/prisma/build/index.js migrate deploy && exec node dist/main.js"]
