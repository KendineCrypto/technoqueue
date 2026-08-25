FROM node:24-alpine
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/agent/package.json apps/agent/package.json
RUN pnpm install --frozen-lockfile=false
COPY packages/core packages/core
COPY apps/agent apps/agent
ENTRYPOINT ["pnpm", "agent"]
