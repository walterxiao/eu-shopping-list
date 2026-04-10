# syntax=docker/dockerfile:1.7

# ---- deps ----
# Use the official Playwright image: Ubuntu 22.04 with chromium and all
# system deps preinstalled. Build tools are present for better-sqlite3.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM deps AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

# ---- runtime ----
FROM mcr.microsoft.com/playwright:v1.48.0-jammy AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    SCRAPE_MOCK=1 \
    CACHE_DB_PATH=/app/data/cache.sqlite \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Create the data dir and hand everything to the non-root pwuser that
# ships with the Playwright image.
RUN mkdir -p /app/data && chown -R pwuser:pwuser /app
USER pwuser

# Next.js standalone output is self-contained: it already includes a
# traced node_modules (with better-sqlite3's native binding) and the
# fixtures/ directory the mock scraper reads at runtime.
COPY --from=build --chown=pwuser:pwuser /app/.next/standalone ./
COPY --from=build --chown=pwuser:pwuser /app/.next/static ./.next/static
COPY --from=build --chown=pwuser:pwuser /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
