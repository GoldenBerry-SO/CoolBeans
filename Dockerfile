# ABOUTME: Multi-stage image for the Cool Beans API and worker (PRD §18) — Node on Alpine.
# ABOUTME: Build target selects api or worker; both share the pruned monorepo install.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS installer
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc turbo.json tsconfig.json biome.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM installer AS builder
# The marketing site (apps/www) deploys to Cloudflare Pages, never into this image —
# skipping its Astro build keeps the api/worker image lean and fast.
RUN pnpm exec turbo build --filter='!@coolbeans/www'

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=builder /app ./
RUN addgroup -S app && adduser -S app -G app && mkdir -p /app/data && chown -R app:app /app/data
USER app
EXPOSE 3000
# Default runs the API (migrations apply on boot). Override CMD for the worker.
CMD ["node", "apps/api/dist/node.js"]
