# Dev-only helper image: loopback edge, synthetic dev-material generator and
# healthcheck script. Build context: repository root.
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS source
WORKDIR /opt/solidchange-local
COPY infra/local/scripts/*.mjs ./
RUN for script in ./*.mjs; do node --check "$script"; done

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS runtime
ENV NODE_ENV=development
RUN install -d -o 70 -g 70 -m 0755 /run/solidchange-dev
WORKDIR /opt/solidchange-local
COPY --from=source /opt/solidchange-local ./
USER node
CMD ["node", "/opt/solidchange-local/loopback-edge.mjs"]
