import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkCompose,
  checkDevStack,
  checkDockerfile,
  checkNodeEnv,
  checkSecrets,
} from "./check-dev-stack.mjs";

const DIGEST = `sha256:${"a1".repeat(32)}`;
const NODE_IMAGE = `node:24.19.0-bookworm-slim@${DIGEST}`;

const DOCKERFILE = `FROM ${NODE_IMAGE} AS build
RUN echo build
FROM ${NODE_IMAGE} AS runtime
COPY --from=build /app /app
USER node
CMD ["node", "server.js"]
`;

function compose(service = "") {
  return `name: example
services:
  edge:
    build:
      context: ../..
    user: "1000:1000"
    ports:
      - "127.0.0.1:4183:8183"
  db:
    image: postgres:16.10-alpine3.22@${DIGEST}
    user: "70:70"
    network_mode: service:edge
${service}
networks:
  private:
`;
}

test("accepts a loopback-only, pinned, non-root compose file", () => {
  assert.deepEqual(checkCompose(compose(), "compose.yaml"), []);
});

test("rejects published ports that are not bound to 127.0.0.1", () => {
  for (const port of ['"4183:8183"', '"0.0.0.0:4183:8183"', '"::1:4183:8183"', "4183", '"127.0.0.2:1:2"']) {
    const text = compose(`  web:\n    build: .\n    user: "1000"\n    ports:\n      - ${port}\n`);
    const errors = checkCompose(text, "compose.yaml");
    assert.equal(errors.length, 1, port);
    assert.match(errors[0], /compose\.yaml:\d+: service web must publish ports only on 127\.0\.0\.1/);
  }
});

test("rejects long-syntax and flow-style port declarations", () => {
  const longSyntax = compose(
    '  web:\n    build: .\n    user: "1000"\n    ports:\n      - target: 80\n        published: "8080"\n',
  );
  assert.equal(checkCompose(longSyntax, "compose.yaml").length, 1);
  const flow = compose('  web:\n    build: .\n    user: "1000"\n    ports: ["127.0.0.1:1:2"]\n');
  assert.match(checkCompose(flow, "compose.yaml")[0], /must be a block list/);
});

test("rejects compose images that are not pinned by digest", () => {
  const text = compose('  cache:\n    image: redis:7\n    user: "999"\n');
  assert.match(checkCompose(text, "compose.yaml")[0], /service cache image must be pinned by @sha256 digest/);
  const missing = compose('  cache:\n    user: "999"\n');
  assert.match(checkCompose(missing, "compose.yaml")[0], /must declare a pinned image or a build/);
});

test("rejects services that run as root or without an explicit user", () => {
  for (const user of ['"0"', "root", '"0:0"', "root:root"]) {
    const errors = checkCompose(compose(`  web:\n    build: .\n    user: ${user}\n`), "compose.yaml");
    assert.match(errors[0], /service web must not run as root/, user);
  }
  const errors = checkCompose(compose("  web:\n    build: .\n"), "compose.yaml");
  assert.match(errors[0], /service web must set a non-root user/);
});

test("rejects privileged services and host networking", () => {
  const privileged = compose('  web:\n    build: .\n    user: "1000"\n    privileged: true\n');
  assert.match(checkCompose(privileged, "compose.yaml")[0], /must not be privileged/);
  const host = compose('  web:\n    build: .\n    user: "1000"\n    network_mode: host\n');
  assert.match(checkCompose(host, "compose.yaml")[0], /must not use network_mode host/);
});

test("requires at least one service", () => {
  assert.match(checkCompose("name: empty\n", "compose.yaml")[0], /must declare services/);
});

test("accepts a multi-stage Dockerfile pinned by digest with a non-root user", () => {
  assert.deepEqual(checkDockerfile(DOCKERFILE, "app.Dockerfile"), []);
});

test("rejects Dockerfile base images without a digest", () => {
  const errors = checkDockerfile("FROM node:24-slim AS build\nFROM build\nUSER node\n", "app.Dockerfile");
  assert.deepEqual(errors, ["app.Dockerfile:1: base image node:24-slim must be pinned by @sha256 digest"]);
});

test("rejects Dockerfiles whose final stage runs as root", () => {
  const noUser = `FROM ${NODE_IMAGE} AS build\nUSER node\nFROM ${NODE_IMAGE}\nCMD ["node"]\n`;
  assert.match(checkDockerfile(noUser, "app.Dockerfile")[0], /final stage .* must set a non-root USER/);
  const root = `FROM ${NODE_IMAGE}\nUSER root\n`;
  assert.match(checkDockerfile(root, "app.Dockerfile")[0], /must not switch to root/);
  const uidZero = `FROM ${NODE_IMAGE}\nUSER 0:0\n`;
  assert.match(checkDockerfile(uidZero, "app.Dockerfile")[0], /must not switch to root/);
  assert.match(checkDockerfile("# empty\n", "app.Dockerfile")[0], /has no FROM instruction/);
});

test("rejects NODE_ENV=production in any spelling", () => {
  for (const line of [
    "NODE_ENV=production",
    "      NODE_ENV: production",
    'ENV NODE_ENV="production"',
    "ENV NODE_ENV production",
    "  - NODE_ENV=Production",
  ]) {
    assert.equal(checkNodeEnv(line, "file").length, 1, line);
  }
  assert.deepEqual(checkNodeEnv("NODE_ENV: development\nENV NODE_ENV=test\n", "file"), []);
});

test("rejects committed private keys and provider-style tokens", () => {
  const pem = "-----BEGIN " + "EC PRIVATE KEY-----";
  assert.match(checkSecrets(pem, "f")[0], /private key material/);
  const token = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4";
  assert.ok(checkSecrets(`value ${token}`, "f").some((error) => /provider credential/.test(error)));
  const akid = "AKIA" + "ABCDEFGHIJ012345";
  assert.ok(checkSecrets(akid, "f").some((error) => /provider credential/.test(error)));
});

test("rejects high-entropy literals but ignores image digests", () => {
  const hex = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  assert.match(checkSecrets(`KEY_MATERIAL ${hex}`, "f")[0], /high-entropy/);
  const base64url = "Zm9vYmFyLWJhei1xdXV4LTEyMzQ1Njc4OTAtYWJj";
  assert.match(checkSecrets(base64url, "f")[0], /high-entropy/);
  assert.deepEqual(checkSecrets(`image: ${NODE_IMAGE}`, "f"), []);
  assert.deepEqual(checkSecrets("backoffice-audit-database-url-file-reference", "f"), []);
});

test("rejects URLs that embed literal passwords", () => {
  assert.match(checkSecrets("postgresql://user:hunter2@127.0.0.1/db", "f")[0], /embeds a literal password/);
  assert.deepEqual(checkSecrets(`postgresql://user:\${PASSWORD}@127.0.0.1/db`, "f"), []);
});

test("requires secret-named settings in .env.example and compose to stay empty", () => {
  assert.deepEqual(checkSecrets("API_TOKEN=\nDB_PASSWORD=\nMINIAPP_KYC_SCENARIO=approve\n", ".env.example"), []);
  assert.match(checkSecrets("DB_PASSWORD=changeme\n", ".env.example")[0], /DB_PASSWORD must not have a committed literal value/);
  assert.deepEqual(
    checkSecrets(
      [
        `      DB_PASSWORD: \${DB_PASSWORD:-}`,
        "      POSTGRES_PASSWORD_FILE: /run/dev/password",
        "      - API_TOKEN=@api-token.key",
      ].join("\n"),
      "compose.yaml",
    ),
    [],
  );
  assert.match(checkSecrets(`      DB_PASSWORD: \${DB_PASSWORD:-fallback}`, "compose.yaml")[0], /must not have a committed literal/);
  assert.match(checkSecrets("      - API_TOKEN=literal", "compose.yaml")[0], /must not have a committed literal/);
});

test("rejects YAML anchors, aliases and merge keys that hide service settings", () => {
  const merge = `name: example
x-base: &base
  privileged: true
  network_mode: host
services:
  web:
    build: .
    user: "1000"
    <<: *base
`;
  const errors = checkCompose(merge, "compose.yaml").join("\n");
  assert.match(errors, /compose\.yaml:2: YAML anchors, aliases and merge keys are not allowed/);
  assert.match(errors, /compose\.yaml:9: YAML anchors, aliases and merge keys are not allowed/);
  assert.match(errors, /compose\.yaml:2: top-level key x-base is not allowed/);
  const ports = compose('  web:\n    build: .\n    user: "1000"\n    ports: &published\n      - "127.0.0.1:1:2"\n');
  assert.match(checkCompose(ports, "compose.yaml").join("\n"), /anchors, aliases and merge keys/);
  const quotedStar = compose('  web:\n    build: .\n    user: "1000"\n    command: ["sh", "-c", "echo * && true"]\n');
  assert.deepEqual(checkCompose(quotedStar, "compose.yaml"), []);
});

test("rejects quoted service keys and sequences that YAML attaches to the service", () => {
  const quoted = compose('  web:\n    build: .\n    user: "1000"\n    "privileged": true\n');
  assert.match(checkCompose(quoted, "compose.yaml")[0], /service web keys must be plain block-mapping keys/);
  const compact = compose('  web:\n    build: .\n    user: "1000"\n    ports:\n    - "0.0.0.0:4183:8183"\n');
  const errors = checkCompose(compact, "compose.yaml").join("\n");
  assert.match(errors, /service web keys must be plain block-mapping keys/);
  assert.match(errors, /service web must publish ports only on 127\.0\.0\.1/);
});

test("rejects port items indented deeper than one level below ports", () => {
  const deep = compose('  web:\n    build: .\n    user: "1000"\n    ports:\n        - "0.0.0.0:4183:8183"\n');
  const errors = checkCompose(deep, "compose.yaml");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /service web must publish ports only on 127\.0\.0\.1/);
});

test("rejects root uids with leading zeros and interpolated user or network_mode", () => {
  for (const user of ['"00"', '"0000:1000"']) {
    const errors = checkCompose(compose(`  web:\n    build: .\n    user: ${user}\n`), "compose.yaml");
    assert.match(errors[0], /service web must not run as root/, user);
  }
  const interpolatedUser = compose("  web:\n    build: .\n    user: ${DEV_UID:-0}\n");
  assert.match(checkCompose(interpolatedUser, "compose.yaml")[0], /service web user must be a literal non-root user/);
  const interpolatedNetwork = compose('  web:\n    build: .\n    user: "1000"\n    network_mode: ${DEV_NET:-host}\n');
  assert.match(checkCompose(interpolatedNetwork, "compose.yaml")[0], /must not use network_mode \$\{DEV_NET:-host\}/);
  const none = compose('  web:\n    build: .\n    user: "1000"\n    network_mode: none\n');
  assert.deepEqual(checkCompose(none, "compose.yaml"), []);
});

test("rejects compose features that pull in configuration the checker cannot see", () => {
  const extendsFile = compose(
    '  web:\n    build: .\n    user: "1000"\n    extends:\n      file: base.yml\n      service: base\n',
  );
  assert.match(checkCompose(extendsFile, "compose.yaml")[0], /service web must not use extends/);
  const envFile = compose('  web:\n    build: .\n    user: "1000"\n    env_file: app.env\n');
  assert.match(checkCompose(envFile, "compose.yaml")[0], /service web must not use env_file/);
  const include = `include:\n  - extra.yml\n${compose()}`;
  assert.match(checkCompose(include, "compose.yaml")[0], /top-level key include is not allowed/);
  const inline = compose(
    '  web:\n    build:\n      context: .\n      dockerfile_inline: |\n        FROM node:24\n    user: "1000"\n',
  );
  assert.match(checkCompose(inline, "compose.yaml").join("\n"), /service web must not use dockerfile_inline/);
  const remote = compose('  web:\n    build: https://example.invalid/repo.git\n    user: "1000"\n');
  assert.match(checkCompose(remote, "compose.yaml")[0], /service web must build from a local context/);
});

test("requires a literal development or test NODE_ENV in compose and Dockerfiles", () => {
  const interpolated = compose('  web:\n    build: .\n    user: "1000"\n    environment:\n      NODE_ENV: ${DEV_NODE_ENV:-production}\n');
  assert.match(checkCompose(interpolated, "compose.yaml")[0], /NODE_ENV must be the literal development or test/);
  const listForm = compose('  web:\n    build: .\n    user: "1000"\n    environment:\n      - NODE_ENV=$MODE\n');
  assert.match(checkCompose(listForm, "compose.yaml")[0], /NODE_ENV must be the literal development or test/);
  const literal = compose('  web:\n    build: .\n    user: "1000"\n    environment:\n      NODE_ENV: development\n');
  assert.deepEqual(checkCompose(literal, "compose.yaml"), []);
  const argDockerfile = `FROM ${NODE_IMAGE}\nARG MODE=production\nENV NODE_ENV=$MODE\nUSER node\n`;
  assert.match(checkDockerfile(argDockerfile, "app.Dockerfile")[0], /app\.Dockerfile:3: NODE_ENV must be the literal development or test/);
  const legacy = `FROM ${NODE_IMAGE}\nENV NODE_ENV \${MODE}\nUSER node\n`;
  assert.match(checkDockerfile(legacy, "app.Dockerfile")[0], /NODE_ENV must be the literal development or test/);
  assert.deepEqual(checkDockerfile(`FROM ${NODE_IMAGE}\nENV NODE_ENV=development\nUSER node\n`, "app.Dockerfile"), []);
});

test("rejects Dockerfile USER values that resolve to root or are interpolated", () => {
  const zeros = `FROM ${NODE_IMAGE}\nUSER 00\n`;
  assert.match(checkDockerfile(zeros, "app.Dockerfile")[0], /must not switch to root/);
  const interpolated = `FROM ${NODE_IMAGE}\nARG UID=0\nUSER \${UID}\n`;
  assert.match(checkDockerfile(interpolated, "app.Dockerfile")[0], /USER must be a literal non-root user/);
});

async function withStack(files, run) {
  const root = await mkdtemp(path.join(tmpdir(), "dev-stack-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), text);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("checks a whole stack directory and skips the local .env", async () => {
  await withStack(
    {
      "compose.yaml": compose(),
      "app.Dockerfile": DOCKERFILE,
      ".env.example": "DB_PASSWORD=\n",
      ".env": "DB_PASSWORD=local-only\n",
      "scripts/start.sh": "echo ok\n",
    },
    async (root) => {
      assert.deepEqual(await checkDevStack(root), []);
    },
  );
});

test("reports every violation found in a stack directory", async () => {
  await withStack(
    {
      "compose.yaml": compose('  web:\n    image: web:latest\n    user: root\n    ports:\n      - "8080:80"\n'),
      "app.Dockerfile": "FROM node:24\n",
      ".env.example": "API_TOKEN=abc\n",
      "scripts/start.sh": "NODE_ENV=production node server.js\n",
    },
    async (root) => {
      const errors = (await checkDevStack(root)).join("\n");
      assert.match(errors, /must not run as root/);
      assert.match(errors, /image must be pinned/);
      assert.match(errors, /publish ports only on 127\.0\.0\.1/);
      assert.match(errors, /base image node:24 must be pinned/);
      assert.match(errors, /must set a non-root USER/);
      assert.match(errors, /API_TOKEN must not have a committed literal/);
      assert.match(errors, /NODE_ENV must never be production/);
    },
  );
});

test("rejects override, extends and include YAML files next to compose.yaml", async () => {
  await withStack(
    {
      "compose.yaml": compose(),
      "compose.override.yaml": 'services:\n  edge:\n    privileged: true\n    user: "0"\n',
      "base.yml": "services:\n  base:\n    privileged: true\n",
      "app.Dockerfile": DOCKERFILE,
    },
    async (root) => {
      const errors = (await checkDevStack(root)).join("\n");
      assert.match(errors, /compose\.override\.yaml: unexpected YAML file/);
      assert.match(errors, /base\.yml: unexpected YAML file/);
    },
  );
});

test("checks Dockerfiles that compose builds from outside the stack directory", async () => {
  await withStack(
    {
      "stack/compose.yaml": compose('  web:\n    build:\n      context: ..\n      dockerfile: elsewhere/app.Dockerfile\n    user: "1000"\n'),
      "stack/app.Dockerfile": DOCKERFILE,
      "elsewhere/app.Dockerfile": "FROM node:24\nUSER node\n",
    },
    async (root) => {
      const errors = (await checkDevStack(path.join(root, "stack"))).join("\n");
      assert.match(errors, /elsewhere\/app\.Dockerfile:1: base image node:24 must be pinned by @sha256 digest/);
    },
  );
});

test("fails when the stack has no compose file or Dockerfile", async () => {
  await withStack({ "README.md": "empty\n" }, async (root) => {
    const errors = await checkDevStack(root);
    assert.equal(errors.length, 2);
  });
});

test("the committed infra/local stack passes", async () => {
  assert.deepEqual(await checkDevStack("infra/local"), []);
});
