FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WRANGLER_WRITE_LOGS=false \
    WRANGLER_LOG_PATH=/tmp/pieaes256hole-wrangler.log \
    MINIFLARE_REGISTRY_PATH=/tmp/pieaes256hole-miniflare

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm run build

EXPOSE 3000
CMD ["pnpm", "start", "--host", "0.0.0.0", "--port", "3000"]
