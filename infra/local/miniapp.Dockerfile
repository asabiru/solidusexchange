# Dev-only image for miniapp/ (Telegram Mini App BFF + built static app, synthetic data only).
# Build context: repository root, so the file: dependencies on packages/* resolve.
# The same image runs the BFF and the Vite preview server as separate services.
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build
WORKDIR /app
COPY packages/customer-api/package.json packages/customer-api/package-lock.json packages/customer-api/
COPY packages/provider-simulators/package.json packages/provider-simulators/package-lock.json packages/provider-simulators/
COPY miniapp/package.json miniapp/package-lock.json miniapp/
RUN npm ci --prefix miniapp --ignore-scripts --no-audit --no-fund
COPY packages/customer-api/src packages/customer-api/src
COPY packages/provider-simulators/src packages/provider-simulators/src
COPY miniapp miniapp
RUN npm run --prefix miniapp build

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS runtime
ENV NODE_ENV=development
COPY --from=build /app/packages/customer-api/package.json /app/packages/customer-api/
COPY --from=build /app/packages/customer-api/src /app/packages/customer-api/src
COPY --from=build /app/packages/provider-simulators/package.json /app/packages/provider-simulators/
COPY --from=build /app/packages/provider-simulators/src /app/packages/provider-simulators/src
WORKDIR /app/miniapp
COPY --from=build /app/miniapp/package.json /app/miniapp/vite.config.ts ./
COPY --from=build /app/miniapp/node_modules ./node_modules
COPY --from=build /app/miniapp/.server-dist ./.server-dist
COPY --from=build /app/miniapp/dist ./dist
COPY infra/local/scripts/healthcheck.mjs infra/local/scripts/with-dev-material.sh /opt/solidchange-local/
USER node
CMD ["node", ".server-dist/server/index.js"]
