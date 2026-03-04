# Supabase Studio with custom basePath (/studio)
# Built from official monorepo source to support any CPU architecture

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update -qq && \
  apt-get install -y --no-install-recommends \
  git \
  python3 \
  ca-certificates \
  build-essential && \
  rm -rf /var/lib/apt/lists/* && \
  update-ca-certificates

RUN npm install -g pnpm@10.16.1

WORKDIR /app

# Clone Supabase monorepo (shallow)
FROM base AS source
ARG SUPABASE_VERSION=master
RUN git clone --depth 1 --branch ${SUPABASE_VERSION} https://github.com/supabase/supabase.git /app

# Prune with turbo
FROM base AS turbo
COPY --from=source /app /app
RUN pnpm dlx turbo@2.3.3 prune studio --docker

# Install dependencies
FROM base AS deps
COPY --from=turbo /app/out/json ./
COPY --from=turbo /app/out/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build with custom basePath
FROM deps AS builder
COPY --from=turbo /app/out/full ./
ENV NEXT_PUBLIC_BASE_PATH=/studio
RUN pnpm --filter studio exec next build

# Production
FROM node:22-slim AS production
WORKDIR /app
COPY --from=builder /app/apps/studio/public ./apps/studio/public
COPY --from=builder /app/apps/studio/.next/standalone ./
COPY --from=builder /app/apps/studio/.next/static ./apps/studio/.next/static
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=5s --retries=3 CMD node -e "fetch('http://localhost:3000/studio/api/platform/profile').then((r) => {if (r.status !== 200) throw new Error(r.status)})"
CMD ["node", "apps/studio/server.js"]
