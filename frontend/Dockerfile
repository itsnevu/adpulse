# ==========================================================================
# AdPulse frontend — Next.js (App Router), port 3000. Multi-stage:
#   1. builder : npm ci (termasuk devDeps utk Tailwind) → next build
#   2. runner  : hanya dependency produksi + hasil build → next start
#
# NEXT_PUBLIC_API_URL DI-BAKE SAAT BUILD (perilaku Next.js) — override via:
#   docker build --build-arg NEXT_PUBLIC_API_URL=https://domain-kamu.com .
# ==========================================================================

# ---- Stage 1: build ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- Stage 2: runner ----
FROM node:20-alpine AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=node:node /app/next.config.js ./next.config.js
COPY --from=builder --chown=node:node /app/.next ./.next

USER node

EXPOSE 3000

CMD ["npm", "run", "start"]
