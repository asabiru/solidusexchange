// Wave-68 contract-guard audit: the drift classes that escaped both the
// api-contracts checker and this package's own contract harness. Every
// declared parameter grammar must bind to a grammar the dispatcher actually
// serves — a documented input that can never reach a route is a
// guaranteed-404 lie, not a contract.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { OPERATOR_QUEUE_KINDS, isOperatorAuditCursor } from "../src/operator.mjs";
import { contract } from "./http-client.mjs";

const APP_SOURCE = readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");
const OPERATOR_SOURCE = readFileSync(new URL("../src/operator.mjs", import.meta.url), "utf8");

// Reads the runtime matcher grammars out of the implementation source so the
// declared contracts are checked against the same regexes the dispatcher
// compiles, not a copy that could drift on its own.
function sourcePattern(source, name, label) {
  const match = new RegExp(`const ${name} = /(.+)/u;`, "u").exec(source);
  assert.notEqual(match, null, `${label} must declare ${name}`);
  return match[1];
}

const SEGMENT_PATTERN = sourcePattern(APP_SOURCE, "PATH_PARAMETER_PATTERN", "app.mjs");
const INSTRUMENT_PATTERN = sourcePattern(APP_SOURCE, "INSTRUMENT_PATH_PATTERN", "app.mjs");
const AUDIT_CURSOR_PATTERN = sourcePattern(OPERATOR_SOURCE, "AUDIT_CURSOR_PATTERN", "operator.mjs");
const segmentPattern = new RegExp(SEGMENT_PATTERN, "u");
const instrumentPattern = new RegExp(INSTRUMENT_PATTERN, "u");

// The runtime grammar pins below fail on any change to the dispatcher's
// segment or instrument grammar: re-running the admissibility argument is
// mandatory whenever the matcher grammar moves, so a widened runtime
// grammar can never silently loosen the declared surface.
assert.equal(
  SEGMENT_PATTERN,
  "^[a-z][a-z0-9_-]{2,127}$",
  "runtime segment grammar changed — re-audit the admissible declared grammars"
);
assert.equal(
  INSTRUMENT_PATTERN,
  "^[A-Z0-9]{2,8}\\/[A-Z0-9]{2,8}$",
  "runtime instrument grammar changed — re-audit the admissible declared grammars"
);

// Mirror of app.mjs matchOperation: a segment is served when it satisfies
// the canonical pattern, or — for {instrument} only — when it decodes once
// into the instrument shape.
function runtimeAdmits(parameterName, rawSegment) {
  if (segmentPattern.test(rawSegment)) {
    return true;
  }
  if (parameterName !== "instrument") {
    return false;
  }
  try {
    return instrumentPattern.test(decodeURIComponent(rawSegment));
  } catch {
    return false;
  }
}

// A declared path-parameter pattern is admissible only after proving it
// accepts nothing outside the runtime segment grammar: either it IS the
// grammar, or it is a `^literal[class]{m,n}$` shape whose literal starts
// with a lowercase ASCII letter and stays inside [a-z0-9_-], whose class is
// a subset of [a-z0-9_-], and whose total length fits {3,128}. Anything
// outside that shape must be argued here before the contract may declare
// it — this is where a documented-but-unservable pattern fails.
function admissibleSegmentPattern(pattern) {
  if (pattern === SEGMENT_PATTERN) {
    return true;
  }
  const match = /^\^([a-z0-9_-]+)\[([^\]^]+)\]\{(\d+)(?:,(\d+))?\}\$$/u.exec(pattern);
  if (match === null) {
    return false;
  }
  const [, literal, charClass, min, max] = match;
  if (!/^[a-z][a-z0-9_-]*$/u.test(literal)) {
    return false;
  }
  // Only char classes that spell a subset of the runtime [a-z0-9_-]
  // segment grammar are admissible; any new class spelling must be argued
  // here before it may be pinned.
  if (!["a-z0-9_-", "a-z0-9", "0-9a-f"].includes(charClass)) {
    return false;
  }
  const shortest = literal.length + Number.parseInt(min, 10);
  const longest = literal.length + Number.parseInt(max ?? min, 10);
  return shortest >= 3 && longest <= 128;
}

const METHOD_KEYS = new Set(["get", "put", "post", "delete", "patch", "options", "head", "trace"]);

function resolveParameter(reference) {
  if (reference?.$ref) {
    const match = /^#\/components\/parameters\/([^/]+)$/u.exec(reference.$ref);
    assert.notEqual(match, null, `unexpected parameter $ref ${reference.$ref}`);
    return contract.openapi.components?.parameters?.[match[1]];
  }
  return reference;
}

function declaredOperations() {
  const operations = [];
  for (const [pathName, item] of Object.entries(contract.openapi.paths ?? {})) {
    for (const [method, operation] of Object.entries(item ?? {})) {
      if (!METHOD_KEYS.has(method)) {
        continue;
      }
      operations.push({
        pathName,
        operation,
        parameters: [...(item.parameters ?? []), ...(operation.parameters ?? [])].map(resolveParameter)
      });
    }
  }
  return operations;
}

test("declared query parameters bind exactly to the served-query operations", () => {
  const servedQueryParameters = new Map([
    ["getOperatorQueue", "kind"],
    ["getOperatorAudit", "cursor"]
  ]);
  for (const { pathName, operation, parameters } of declaredOperations()) {
    const queryParameters = parameters.filter((parameter) => parameter?.in === "query");
    const expected = servedQueryParameters.get(operation.operationId);
    if (expected === undefined) {
      assert.deepEqual(
        queryParameters.map((parameter) => parameter?.name),
        [],
        `${operation.operationId} (${pathName}) must not declare a query parameter the dispatcher refuses`
      );
      continue;
    }
    assert.deepEqual(
      queryParameters.map((parameter) => parameter?.name),
      [expected],
      `${operation.operationId} must declare exactly its served query parameter`
    );
    const [declared] = queryParameters;
    assert.notEqual(
      declared.required,
      true,
      `${operation.operationId} query parameter ${expected} must stay optional`
    );
    assert.equal(
      declared.schema?.type,
      "string",
      `${operation.operationId} query parameter ${expected} must stay a string`
    );
    if (operation.operationId === "getOperatorQueue") {
      assert.deepEqual(
        [...(declared.schema.enum ?? [])].sort(),
        [...OPERATOR_QUEUE_KINDS].sort(),
        "declared kind enum must equal the runtime kind allowlist"
      );
      assert.equal(
        declared.schema.default,
        OPERATOR_QUEUE_KINDS[0],
        "declared kind default must be the first served kind"
      );
    } else {
      assert.equal(
        declared.schema.pattern,
        AUDIT_CURSOR_PATTERN,
        "declared cursor pattern must be the runtime cursor grammar"
      );
      const declaredPattern = new RegExp(declared.schema.pattern, "u");
      for (const [probe, expectedResult] of [
        ["auc_0000000000000000", true],
        ["auc_ffffffffffffffff", true],
        ["auc_zzzzzzzzzzzzzzzz", false],
        ["auc_000000000000000", false],
        ["auc_00000000000000000", false],
        ["AUC_0000000000000000", false],
        ["", false]
      ]) {
        assert.equal(
          declaredPattern.test(probe),
          expectedResult,
          `declared cursor grammar must ${expectedResult ? "admit" : "refuse"} ${JSON.stringify(probe)}`
        );
        assert.equal(
          isOperatorAuditCursor(probe),
          expectedResult,
          `runtime cursor grammar must ${expectedResult ? "admit" : "refuse"} ${JSON.stringify(probe)}`
        );
      }
    }
  }
});

test("every declared path-parameter grammar is runtime-admissible", () => {
  const templated = Object.entries(contract.openapi.paths ?? {}).filter(([pathName]) =>
    pathName.includes("{")
  );
  assert.ok(templated.length > 0, "expected templated contract paths");
  for (const [pathName, item] of templated) {
    const placeholders = [...pathName.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]);
    for (const [method, operation] of Object.entries(item ?? {})) {
      if (!METHOD_KEYS.has(method)) {
        continue;
      }
      const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])]
        .map(resolveParameter)
        .filter((parameter) => parameter?.in === "path");
      assert.deepEqual(
        [...parameters.map((parameter) => parameter?.name)].sort(),
        [...placeholders].sort(),
        `${operation.operationId} must declare exactly the path parameters its template carries`
      );
      for (const parameter of parameters) {
        assert.equal(
          parameter.required,
          true,
          `${operation.operationId} ${parameter.name} must stay required`
        );
        const schema = parameter.schema ?? {};
        assert.equal(
          schema.type,
          "string",
          `${operation.operationId} ${parameter.name} must stay a string`
        );
        const grammars = ["enum", "pattern"].filter((key) => Object.hasOwn(schema, key));
        assert.equal(
          grammars.length,
          1,
          `${operation.operationId} ${parameter.name} must declare exactly one grammar`
        );
        if (Object.hasOwn(schema, "enum")) {
          for (const value of schema.enum) {
            const wire = parameter.name === "instrument" ? encodeURIComponent(value) : value;
            assert.ok(
              runtimeAdmits(parameter.name, wire),
              `${operation.operationId} {${parameter.name}} enum value ${JSON.stringify(value)} is never served`
            );
          }
        } else {
          assert.ok(
            admissibleSegmentPattern(schema.pattern),
            `${operation.operationId} {${parameter.name}} pattern ${schema.pattern} admits segments the router never matches`
          );
        }
      }
    }
  }
});
