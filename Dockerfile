# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Instalar dependencias necesarias para build
RUN apt-get update && apt-get install -y openssl

COPY package*.json ./
RUN npm ci

COPY . .

# Generar cliente Prisma
RUN npx prisma generate

# Build NestJS
RUN npm run build


# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-slim AS production

# Instalar dumb-init y limpiar cache
RUN apt-get update && apt-get install -y dumb-init openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

# Copiar solo lo necesario
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

# Crear usuario no-root
RUN useradd -m -u 1001 nestjs && chown -R nestjs:nestjs /app

USER nestjs

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD npx prisma migrate deploy && npx prisma migrate dev --name init && node dist/src/main.js

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1