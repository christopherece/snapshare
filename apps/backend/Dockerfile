# Production image: Bun API + built guest web app, host dashboard and slideshow.
# Build from the repo root:  docker build -f apps/backend/Dockerfile .
#
# CPU note: Bun 1.4 needs AVX/AVX2. For CPUs without AVX (e.g. Celeron J4125/N5105, or a VM whose CPU
# type hides it) build with BUN_VERSION=1.2.23 and BUN_BASELINE=1 — set both in .env, see DEPLOY.md.

ARG BUN_VERSION=1.4.3

# ─── 0. Bun base image (optionally with the "baseline" no-AVX binary) ───
FROM oven/bun:${BUN_VERSION} AS bun-base
ARG BUN_VERSION
ARG BUN_BASELINE=0
RUN set -e; \
    if [ "$BUN_BASELINE" = "1" ]; then \
      echo "Installing Bun ${BUN_VERSION} baseline build (no AVX required)"; \
      apt-get update -qq && apt-get install -y -qq --no-install-recommends curl unzip ca-certificates >/dev/null; \
      curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64-baseline.zip"; \
      unzip -q -j /tmp/bun.zip '*/bun' -d /tmp/bun && install -m 755 /tmp/bun/bun /usr/local/bin/bun; \
      rm -rf /tmp/bun /tmp/bun.zip /var/lib/apt/lists/*; \
    fi; \
    bun --version

# ─── 1. Dependencies (backend + web apps only — skips the Expo/mobile tree) ───
FROM bun-base AS deps
ARG BUN_BASELINE=0
WORKDIR /app
# bunfig.toml is not copied: its hoisted-linker setting only matters for the Expo app.
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/web-host/package.json apps/web-host/
COPY apps/web-slideshow/package.json apps/web-slideshow/
COPY apps/web-guest/package.json apps/web-guest/
# The mobile manifest must exist for the lockfile to resolve, but its deps are filtered out.
COPY apps/mobile/package.json apps/mobile/
# Older Bun (baseline mode) can't read Bun 1.4's lockfile, so it resolves within package.json ranges.
RUN FILTERS="--filter @snapshare/backend --filter @snapshare/web-host --filter @snapshare/web-slideshow --filter @snapshare/web-guest"; \
    if [ "$BUN_BASELINE" = "1" ]; then rm -f bun.lock && bun install $FILTERS; else bun install --frozen-lockfile $FILTERS; fi

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
FROM bun-base AS runtime
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
