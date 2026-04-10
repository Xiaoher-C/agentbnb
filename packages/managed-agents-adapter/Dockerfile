FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# --- Install + Build ---
FROM base AS build
COPY package.json tsconfig.json tsup.config.ts ./
# Install all deps (not --frozen-lockfile since we're building standalone)
RUN pnpm install --no-frozen-lockfile
COPY src/ src/
RUN pnpm run build

# --- Production stage ---
FROM node:20-slim AS production
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

# Install production deps only
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    pnpm install --prod --no-frozen-lockfile

ENV NODE_ENV=production
EXPOSE 7702

CMD ["node", "dist/server.js"]
