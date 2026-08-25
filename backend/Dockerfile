# ==========================================================================
# AdPulse backend — Express API (Node 20, CommonJS), port 4000.
#
# Build & run (dari folder backend/):
#   docker build -t adpulse-backend .
#   docker run --env-file ../.env -p 4000:4000 adpulse-backend
#
# Dipakai juga oleh docker-compose.yml (profile "full") — compose me-mount
# ../database ke /app/database supaya `npm run migrate` bisa membaca
# database/schema.sql (source of truth, di luar build context ini).
# ==========================================================================
FROM node:20-alpine

ENV NODE_ENV=production

# WORKDIR /app/backend agar path relatif kode (../../database/schema.sql
# dari src/db/migrate.js) mendarat di /app/database — lihat mount di compose.
WORKDIR /app/backend

# Install dependencies dulu (layer cache: hanya invalid bila lockfile berubah)
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Salin source code
COPY --chown=node:node src ./src

USER node

EXPOSE 4000

CMD ["node", "src/server.js"]
