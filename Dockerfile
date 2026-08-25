FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @technoqueue/web build

FROM node:24-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
ENV TECHNOQUEUE_DB_PATH=/data/technoqueue.sqlite
COPY --from=build /app /app
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -q -O - "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1
CMD ["pnpm", "--filter", "@technoqueue/web", "start"]
