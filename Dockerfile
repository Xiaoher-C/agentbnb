# Stage 1: Build
FROM node:20-slim AS build

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy root package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsup.config.ts tsconfig.json ./

# Copy hub package files
COPY hub/package.json hub/pnpm-lock.yaml ./hub/

# Copy workspace package manifests (needed for pnpm workspace resolution)
COPY packages/genesis-template/package.json ./packages/genesis-template/
COPY packages/skill-inspector/package.json ./packages/skill-inspector/

# Install root dependencies (including dev for build)
RUN pnpm install

# Copy source files
COPY src/ ./src/
COPY skills/ ./skills/
COPY hub/ ./hub/
COPY packages/skill-inspector/ ./packages/skill-inspector/

# Build the skill-inspector workspace package first (root + hub depend on its dist)
RUN pnpm -F @agentbnb/skill-inspector build

# Build CLI (tsup) + Hub (Vite)
RUN pnpm build:all

# ---

# Stage 2: Production
FROM node:20-slim AS production

WORKDIR /app

# Install pnpm (needed for better-sqlite3 native module rebuild + workspace links)
RUN npm install -g pnpm

# Copy workspace manifest + package files for production install
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./

# Copy the skill-inspector workspace package (manifest + built dist) so pnpm can
# resolve the `@agentbnb/skill-inspector` workspace:* dependency at runtime.
COPY --from=build /app/packages/skill-inspector/package.json ./packages/skill-inspector/
COPY --from=build /app/packages/skill-inspector/dist ./packages/skill-inspector/dist/

# Install production dependencies only (rebuilds native modules, links workspace pkg)
RUN pnpm install --prod

# Copy compiled CLI + library
COPY --from=build /app/dist ./dist/

# Copy built Hub SPA
COPY --from=build /app/hub/dist ./hub/dist/

# Copy entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 7701

ENTRYPOINT ["./docker-entrypoint.sh"]
