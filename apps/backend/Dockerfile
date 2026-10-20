# Production image: Bun API + built guest web app, host dashboard and slideshow.
# Build from the repo root:  docker build -f apps/backend/Dockerfile .

# ─── 1. Dependencies (backend + web apps only — skips the Expo/mobile tree) ───
FROM oven/bun:1.4 AS deps
WORKDIR /app
# bunfig.toml is deliberately not copied: its hoisted-linker setting only matters for the Expo app,
# and skipping it avoids a Bun config-parse failure seen on some VPS CPUs.
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/web-host/package.json apps/web-host/
COPY apps/web-slideshow/package.json apps/web-slideshow/
COPY apps/web-guest/package.json apps/web-guest/
# The mobile manifest must exist for the lockfile to resolve, but its deps are filtered out.
COPY apps/mobile/package.json apps/mobile/
RUN bun install --frozen-lockfile \
      --filter '@snapshare/backend' \
      --filter '@snapshare/web-host' \
      --filter '@snapshare/web-slideshow' \
      --filter '@snapshare/web-guest'

# ─── 2. Build the static web apps ───
FROM deps AS web
COPY packages/shared packages/shared
COPY apps/web-host apps/web-host
COPY apps/web-slideshow apps/web-slideshow
COPY apps/web-guest apps/web-guest
RUN cd apps/web-host && bun build ./index.html --outdir /static/host --minify --public-path /host/ \
 && cd ../web-slideshow && bun build ./index.html --outdir /static/slideshow --minify --public-path /slideshow/ \
 && cd ../web-guest && bun build ./index.html --outdir /static/join --minify --public-path /join/

# ─── 3. Runtime ───
FROM oven/bun:1.4 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/static \
    RUN_MIGRATIONS=true
COPY --from=deps /app ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend
COPY --from=web /static ./static
WORKDIR /app/apps/backend
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD bun -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "src/index.ts"]
