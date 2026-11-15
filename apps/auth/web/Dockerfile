# syntax=docker/dockerfile:1
# ============================================================================
# Halaman SSO workingspace.id: build Vite → disajikan nginx (SPA statis + header keamanan). Dibangun dari root monorepo:
#   docker build -f apps/auth/web/Dockerfile -t workingspace-auth-web .
# /api, /oidc, /interaction di host yang sama diteruskan Caddy ke auth-api (docs/SSO.md §2.9).
# ============================================================================

FROM node:24-trixie-slim AS prune
WORKDIR /repo
RUN npm install -g turbo@2.11.10
COPY . .
RUN turbo prune @workingspace/auth-web --docker

FROM node:24-trixie-slim AS build
WORKDIR /app
COPY --from=prune /repo/out/json/ ./
RUN npm ci
COPY --from=prune /repo/out/full/ ./
RUN npm run build -w @workingspace/auth-web

FROM nginx:1.30-alpine AS runtime
COPY apps/auth/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/auth/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO /dev/null http://127.0.0.1/healthz || exit 1
