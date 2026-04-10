FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# --- Dependencies stage ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/managed-agents-adapter/package.json packages/managed-agents-adapter/
RUN pnpm install --frozen-lockfile --filter @agentbnb/managed-agents-adapter

# --- Build stage ---
FROM deps AS build
COPY packages/managed-agents-adapter/ packages/managed-agents-adapter/
COPY tsconfig.json ./
RUN pnpm --filter @agentbnb/managed-agents-adapter run build

# --- Production stage ---
FROM node:20-slim AS production
WORKDIR /app

COPY --from=build /app/packages/managed-agents-adapter/dist ./dist
COPY --from=build /app/packages/managed-agents-adapter/package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/managed-agents-adapter/node_modules ./packages/managed-agents-adapter/node_modules

ENV NODE_ENV=production
EXPOSE 7702

CMD ["node", "dist/server.js"]
