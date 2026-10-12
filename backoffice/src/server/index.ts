import { loadServerConfig } from "./config.js";
import { demoRepository } from "../data/demo.js";
import { createAuditStore } from "./audit-bootstrap.js";
import { createSessionStore } from "./session-bootstrap.js";
import { createBackofficeServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadServerConfig();
  const auditStore = await createAuditStore(config.audit, demoRepository.auditSource());
  const sessionStore = await createSessionStore(config.session);
  const server = createBackofficeServer(config, auditStore, undefined, {}, undefined, sessionStore);
  server.once("close", () => {
    void auditStore.close();
    void sessionStore.close();
  });

  server.listen(config.port, config.host, () => {
    console.log(`Backoffice BFF listening on http://${config.host}:${config.port}`);
  });
}

main().catch((error) => {
  const reason = error instanceof Error ? error.message || error.name : "unknown startup failure";
  console.error(`Backoffice BFF refused to start: ${reason}`);
  process.exitCode = 1;
});
