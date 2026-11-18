# syntax=docker/dockerfile:1
# ============================================================================
# Halaman depan workingspace.id: build Vite → disajikan nginx (statis + header keamanan). Dibangun dari root monorepo:
#   docker build -f apps/landing/Dockerfile -t workingspace-landing .
# Alamat SSO & Akasha ditanam saat build: --build-arg VITE_AUTH_URL=… --build-arg VITE_AKASHA_URL=… --build-arg VITE_AKAI_URL=… (docs/SSO.md §2.9).
# ============================================================================

FROM node:24-trixie-slim AS prune
WORKDIR /repo
RUN npm install -g turbo@2.11.10
COPY . .
RUN turbo prune @workingspace/landing --docker

FROM node:24-trixie-slim AS build
WORKDIR /app
COPY --from=prune /repo/out/json/ ./
RUN npm ci
COPY --from=prune /repo/out/full/ ./
ARG VITE_AUTH_URL=https://auth.workingspace.id
ARG VITE_AKASHA_URL=https://akasha.workingspace.id
ARG VITE_AKAI_URL=https://akai.workingspace.id
ENV VITE_AUTH_URL=$VITE_AUTH_URL VITE_AKASHA_URL=$VITE_AKASHA_URL VITE_AKAI_URL=$VITE_AKAI_URL
RUN npm run build -w @workingspace/landing

FROM nginx:1.30-alpine AS runtime
# Templat: ${AUTH_ORIGIN} diisi saat container start (status masuk dibaca dari SSO, CSP connect-src)
ENV AUTH_ORIGIN=https://auth.workingspace.id
COPY apps/landing/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/landing/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO /dev/null http://127.0.0.1/healthz || exit 1
