# syntax=docker/dockerfile:1
# ============================================================================
# LifeOS Frontend: build Vite → disajikan nginx (SPA statis + header keamanan). Dibangun dari root monorepo:
#   docker build -f apps/akasha/web/Dockerfile -t lifeos-frontend .   (dipakai di docker-compose.prod.yml)
# ============================================================================

FROM node:24-trixie-slim AS prune
WORKDIR /repo
RUN npm install -g turbo@2.11.10
COPY . .
RUN turbo prune @akasha/web --docker

FROM node:24-trixie-slim AS build
WORKDIR /app
COPY --from=prune /repo/out/json/ ./
RUN npm ci
COPY --from=prune /repo/out/full/ ./
RUN npm run build -w @akasha/web

FROM nginx:1.30-alpine AS runtime
COPY apps/akasha/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/akasha/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO /dev/null http://127.0.0.1/healthz || exit 1
