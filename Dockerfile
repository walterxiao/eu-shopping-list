# syntax=docker/dockerfile:1.7

# ---- deps ----
# node:22-bookworm-slim is ~240 MB and has build tools readily
# available for better-sqlite3's native binding. Alpine would need
# extra setup for musl compatibility.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 needs python3, make, and g++ to build its native binding
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM deps AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    CACHE_DB_PATH=/app/data/app.sqlite \
    HOSTNAME=0.0.0.0 \
    PORT=8642

# Create the data dir and hand everything to the non-root node user
# that ships with the base image.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

# Next.js standalone output is self-contained: it already includes a
# traced node_modules snapshot with better-sqlite3's native binding.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

EXPOSE 8642
CMD ["node", "server.js"]
