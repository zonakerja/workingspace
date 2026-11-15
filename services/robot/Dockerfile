# syntax=docker/dockerfile:1
# ============================================================================
# Akasha Robot (Playwright + Chromium) — browser otomatis untuk konektor SRIKANDI & e-Kinerja (docs/AI-AGENT.md §21).
# Dibangun dari root monorepo:  docker build -f services/robot/Dockerfile -t akasha-robot .
# Image dasar resmi Playwright (amd64 & arm64) sudah berisi Chromium yang cocok dengan versi paket `playwright`.
# Versi image HARUS sama dengan versi `playwright` di package.json.
# ============================================================================

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS prune
WORKDIR /repo
RUN npm install -g turbo@2.11.10
COPY . .
RUN turbo prune @workingspace/robot --docker

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS build
WORKDIR /app
COPY --from=prune /repo/out/json/ ./
RUN npm ci
COPY --from=prune /repo/out/full/ ./
RUN npm run build -w @workingspace/robot \
  && npm prune --omit=dev \
  && mkdir -p services/robot/node_modules

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runtime
ENV NODE_ENV=production \
  NPM_CONFIG_UPDATE_NOTIFIER=false \
  PORT=4100
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /app/package.json ./
COPY --from=build --chown=pwuser:pwuser /app/node_modules ./node_modules
WORKDIR /app/services/robot
COPY --from=build --chown=pwuser:pwuser /app/services/robot/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/services/robot/dist ./dist
COPY --from=build --chown=pwuser:pwuser /app/services/robot/package.json ./
# Chromium berjalan sebagai user biasa (bukan root); robot hanya membuka host konektor yang diizinkan
USER pwuser
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
