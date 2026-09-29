import { loadServerConfig } from "./config.js";
import { demoRepository } from "../data/demo.js";
import { createAuditStore } from "./audit-bootstrap.js";
import { createBackofficeServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadServerConfig();
  const auditStore = await createAuditStore(config.audit, demoRepository.auditSource());
  const server = createBackofficeServer(config, auditStore);
  server.once("close", () => {
    void auditStore.close();
  });

  server.listen(config.port, config.host, () => {
    console.log(`Backoffice BFF listening on http://${config.host}:${config.port}`);
  });
}

main().catch(() => {
  console.error("Backoffice BFF refused to start because audit storage is not ready");
  process.exitCode = 1;
});
