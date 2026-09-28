import { loadServerConfig } from "./config.js";
import { createBackofficeServer } from "./server.js";

const config = loadServerConfig();
const server = createBackofficeServer(config);

server.listen(config.port, config.host, () => {
  console.log(`Backoffice BFF listening on http://${config.host}:${config.port}`);
});
