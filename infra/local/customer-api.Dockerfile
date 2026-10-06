# Dev-only image for packages/customer-api (loopback-only, synthetic auth).
# Build context: repository root. Never a production image.
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS source
WORKDIR /app/packages/customer-api
COPY packages/customer-api/package.json packages/customer-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY packages/customer-api/src ./src

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS runtime
ENV NODE_ENV=development
WORKDIR /app/packages/customer-api
COPY --from=source /app/packages/customer-api ./
COPY infra/local/scripts/healthcheck.mjs infra/local/scripts/with-dev-material.sh /opt/solidchange-local/
USER node
CMD ["node", "src/server.mjs"]
