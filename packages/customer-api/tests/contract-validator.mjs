// Dependency-free validator for the JSON Schema subset used by
// packages/api-contracts. Unknown keywords fail closed so contract drift is
// never silently ignored.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTRACTS_ROOT = join(packageRoot, "..", "api-contracts");

const ANNOTATIONS = new Set(["$schema", "$id", "title", "description"]);
const KEYWORDS = new Set([
  "$ref",
  "type",
  "const",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "items",
  "maxItems",
  "uniqueItems",
  "minimum",
  "maximum"
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export function loadContract() {
  const openapi = JSON.parse(readFileSync(join(CONTRACTS_ROOT, "openapi.yaml"), "utf8"));
  const errorSchema = JSON.parse(
    readFileSync(join(CONTRACTS_ROOT, "schemas", "error.schema.json"), "utf8")
  );
  return { openapi, documents: { "./schemas/error.schema.json": errorSchema } };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function typeMatches(type, value) {
  switch (type) {
    case "object":
      return isObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      throw new Error(`Unsupported schema type: ${type}`);
  }
}

function formatMatches(format, value) {
  if (format === "uuid") {
    return UUID.test(value);
  }
  if (format === "date-time") {
    return DATE_TIME.test(value) && Number.isFinite(Date.parse(value));
  }
  throw new Error(`Unsupported schema format: ${format}`);
}

export function createValidator(contract) {
  function resolve(ref, document) {
    if (ref.startsWith("#/")) {
      let target = document;
      for (const part of ref.slice(2).split("/")) {
        if (!isObject(target) || !Object.hasOwn(target, part)) {
          throw new Error(`Unresolvable reference: ${ref}`);
        }
        target = target[part];
      }
      return { schema: target, document };
    }
    if (Object.hasOwn(contract.documents, ref)) {
      return { schema: contract.documents[ref], document: contract.documents[ref] };
    }
    throw new Error(`Unsupported reference: ${ref}`);
  }

  function validate(schema, value, document, path, errors) {
    if (!isObject(schema)) {
      throw new Error(`Schema at ${path} must be an object`);
    }
    for (const keyword of Object.keys(schema)) {
      if (!KEYWORDS.has(keyword) && !ANNOTATIONS.has(keyword)) {
        throw new Error(`Unsupported schema keyword at ${path}: ${keyword}`);
      }
    }
    if (schema.$ref !== undefined) {
      const target = resolve(schema.$ref, document);
      validate(target.schema, value, target.document, path, errors);
    }
    if (schema.type !== undefined && !typeMatches(schema.type, value)) {
      errors.push(`${path}: expected ${schema.type}`);
      return;
    }
    if (Object.hasOwn(schema, "const") && canonical(schema.const) !== canonical(value)) {
      errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
    }
    if (schema.enum !== undefined && !schema.enum.some((item) => canonical(item) === canonical(value))) {
      errors.push(`${path}: value is not in enum`);
    }
    if (typeof value === "string") {
      const length = [...value].length;
      if (schema.minLength !== undefined && length < schema.minLength) {
        errors.push(`${path}: shorter than ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && length > schema.maxLength) {
        errors.push(`${path}: longer than ${schema.maxLength}`);
      }
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) {
        errors.push(`${path}: does not match pattern`);
      }
      if (schema.format !== undefined && !formatMatches(schema.format, value)) {
        errors.push(`${path}: invalid ${schema.format}`);
      }
    }
    if (typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${path}: below minimum ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${path}: above maximum ${schema.maximum}`);
      }
    }
    if (Array.isArray(value)) {
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${path}: longer than ${schema.maxItems} items`);
      }
      if (schema.uniqueItems === true && new Set(value.map(canonical)).size !== value.length) {
        errors.push(`${path}: items must be unique`);
      }
      if (schema.items !== undefined) {
        value.forEach((item, index) => validate(schema.items, item, document, `${path}[${index}]`, errors));
      }
    }
    if (isObject(value)) {
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(value, key)) {
          errors.push(`${path}: missing required property ${key}`);
        }
      }
      const properties = schema.properties ?? {};
      for (const [key, item] of Object.entries(value)) {
        if (Object.hasOwn(properties, key)) {
          validate(properties[key], item, document, `${path}.${key}`, errors);
        } else if (schema.additionalProperties === false) {
          errors.push(`${path}: unexpected property ${key}`);
        } else if (isObject(schema.additionalProperties)) {
          validate(schema.additionalProperties, item, document, `${path}.${key}`, errors);
        }
      }
    }
  }

  return Object.freeze({
    resolve(ref) {
      return resolve(ref, contract.openapi).schema;
    },
    validate(schema, value, path = "$") {
      const errors = [];
      validate(schema, value, contract.openapi, path, errors);
      return errors;
    }
  });
}

function parseJson(text) {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: "body is not JSON" };
  }
}

function headerValues(response, name) {
  return response.headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
}

function headerValue(schema, text) {
  return schema.type === "integer" && /^-?[0-9]+$/u.test(text) ? Number(text) : text;
}

// Statuses the service returns although the contract declares no response
// for them; they must still carry the contract error envelope.
export const CONTRACT_GAP_STATUSES = Object.freeze([400, 404]);

export function conformanceErrors(contract, validator, { method, path, response }) {
  const errors = [];
  const operation = Object.hasOwn(contract.openapi.paths, path)
    ? contract.openapi.paths[path][method.toLowerCase()]
    : undefined;
  let declared = operation?.responses?.[String(response.status)];
  if (declared?.$ref) {
    declared = validator.resolve(declared.$ref);
  }
  if (!declared) {
    if (!CONTRACT_GAP_STATUSES.includes(response.status)) {
      errors.push(`undeclared status ${response.status}`);
    }
    declared = validator.resolve("#/components/responses/InternalError");
  }

  const declaredHeaders = Object.entries(declared.headers ?? {});
  for (const [name, reference] of declaredHeaders) {
    const header = reference.$ref ? validator.resolve(reference.$ref) : reference;
    const values = headerValues(response, name.toLowerCase());
    if (values.length > 1) {
      errors.push(`header ${name} appears more than once`);
    } else if (values.length === 0) {
      if (header.required) {
        errors.push(`missing required header ${name}`);
      }
    } else {
      errors.push(
        ...validator
          .validate(header.schema, headerValue(header.schema, values[0]), `header ${name}`)
      );
    }
  }

  const mediaTypes = Object.keys(declared.content ?? {});
  const contentType = headerValues(response, "content-type");
  if (mediaTypes.length !== 1 || mediaTypes[0] !== "application/json") {
    errors.push("declared response must be application/json only");
  }
  if (contentType.length !== 1 || contentType[0] !== "application/json; charset=utf-8") {
    errors.push(`unexpected content-type ${JSON.stringify(contentType)}`);
  }
  if (method === "HEAD") {
    if (response.body.length !== 0) {
      errors.push("HEAD response must not carry a body");
    }
    return errors;
  }
  const parsed = parseJson(response.body);
  if (parsed.error) {
    errors.push(parsed.error);
    return errors;
  }
  const schema = declared.content?.["application/json"]?.schema;
  if (schema) {
    errors.push(...validator.validate(schema, parsed.value, "body"));
  }
  if (response.status >= 400) {
    const requestId = headerValues(response, "x-request-id")[0];
    if (parsed.value.request_id !== requestId) {
      errors.push("error request_id must equal the X-Request-Id response header");
    }
    if (canonical(parsed.value.details) !== "{}") {
      errors.push("error details must stay empty");
    }
  }
  return errors;
}
