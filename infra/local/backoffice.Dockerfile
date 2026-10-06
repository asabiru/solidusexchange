# Dev-only image for backoffice/ (operator backoffice BFF + built static app, synthetic data only).
# Build context: repository root, so the file: dependencies on packages/* resolve.
# The same image runs the BFF and the Vite preview server as separate services.
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build
WORKDIR /app
COPY packages/provider-simulators/package.json packages/provider-simulators/package-lock.json packages/provider-simulators/
COPY backoffice/package.json backoffice/package-lock.json backoffice/
RUN npm ci --prefix backoffice --ignore-scripts --no-audit --no-fund
COPY packages/provider-simulators/src packages/provider-simulators/src
COPY backoffice backoffice
RUN npm run --prefix backoffice build

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS runtime
ENV NODE_ENV=development
COPY --from=build /app/packages/provider-simulators/package.json /app/packages/provider-simulators/
COPY --from=build /app/packages/provider-simulators/src /app/packages/provider-simulators/src
WORKDIR /app/backoffice
COPY --from=build /app/backoffice/package.json /app/backoffice/vite.config.ts ./
COPY --from=build /app/backoffice/node_modules ./node_modules
COPY --from=build /app/backoffice/.server-dist ./.server-dist
COPY --from=build /app/backoffice/dist ./dist
COPY infra/local/scripts/healthcheck.mjs infra/local/scripts/with-dev-material.sh /opt/solidchange-local/
USER node
CMD ["node", ".server-dist/server/index.js"]
