import { loadServerConfig } from "./config.js";
import { createSessionStore } from "./session-bootstrap.js";
import { createMiniappServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadServerConfig();
  const sessionStore = await createSessionStore(config.session);
  const server = createMiniappServer(config, { sessionStore });
  server.once("close", () => {
    void sessionStore.close();
  });
  server.listen(config.port, config.host, () => {
    console.log(`Mini App dev BFF listening on http://${config.host}:${config.port} (synthetic data, money movement disabled)`);
  });
}

main().catch((error) => {
  console.error(`Mini App dev BFF refused to start: ${error instanceof Error ? error.message : "invalid configuration"}`);
  process.exitCode = 1;
});
