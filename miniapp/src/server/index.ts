import { loadServerConfig } from "./config.js";
import { createMiniappServer } from "./server.js";

try {
  const config = loadServerConfig();
  const server = createMiniappServer(config);
  server.listen(config.port, config.host, () => {
    console.log(`Mini App dev BFF listening on http://${config.host}:${config.port} (synthetic data, money movement disabled)`);
  });
} catch (error) {
  console.error(`Mini App dev BFF refused to start: ${error instanceof Error ? error.message : "invalid configuration"}`);
  process.exitCode = 1;
}
