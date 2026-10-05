/**
 * Canonical JSON for signed simulator payloads.
 *
 * Canonical form: UTF-8 without BOM, no insignificant whitespace, object keys
 * sorted by UTF-16 code units, strings escaped exactly as `JSON.stringify`
 * escapes them, NFC-normalized well-formed strings and only safe integers as
 * numbers. Money is always a decimal string.
 */

export const MAX_JSON_DEPTH = 16;

/**
 * @typedef {"invalid_utf8"
 *   | "byte_order_mark"
 *   | "invalid_json"
 *   | "duplicate_key"
 *   | "lone_surrogate"
 *   | "nesting_too_deep"
 *   | "non_canonical_json"} JsonErrorCode
 */

export class JsonError extends Error {
  /**
   * @param {JsonErrorCode} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "JsonError";
    /** @type {JsonErrorCode} */
    this.code = code;
  }
}

/**
 * @typedef {null | boolean | number | string | JsonArray | JsonObject} JsonValue
 * @typedef {Array<JsonValue>} JsonArray
 * @typedef {{ [key: string]: JsonValue }} JsonObject
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalStringify(value) {
  return serialize(value, 0);
}

/**
 * @param {unknown} value
 * @param {number} depth
 * @returns {string}
 */
function serialize(value, depth) {
  if (depth > MAX_JSON_DEPTH) {
    throw new JsonError("nesting_too_deep", "value is nested too deeply");
  }
  if (value === null || value === true || value === false) {
    return String(value);
  }
  if (typeof value === "string") {
    return serializeString(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new JsonError("non_canonical_json", "numbers must be safe integers");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new JsonError("non_canonical_json", "arrays must be plain arrays");
    }
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new JsonError("non_canonical_json", "sparse arrays are not allowed");
      }
      items.push(serialize(value[index], depth + 1));
    }
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new JsonError("non_canonical_json", "objects must be plain objects");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new JsonError("non_canonical_json", "symbol keys are not allowed");
    }
    const record = /** @type {Record<string, unknown>} */ (value);
    const members = [];
    for (const key of Object.keys(record).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new JsonError("non_canonical_json", "accessor properties are not allowed");
      }
      members.push(`${serializeString(key)}:${serialize(descriptor.value, depth + 1)}`);
    }
    return `{${members.join(",")}}`;
  }
  throw new JsonError("non_canonical_json", `unsupported JSON value type ${typeof value}`);
}

/**
 * @param {string} value
 */
function serializeString(value) {
  if (!value.isWellFormed()) {
    throw new JsonError("lone_surrogate", "strings must be well-formed UTF-16");
  }
  if (value.normalize("NFC") !== value) {
    throw new JsonError("non_canonical_json", "strings must be NFC-normalized");
  }
  return JSON.stringify(value);
}

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Decodes strict UTF-8 bytes: invalid, overlong or surrogate sequences and a
 * leading byte order mark are rejected.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeStrictUtf8(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new JsonError("byte_order_mark", "a UTF-8 byte order mark is not allowed");
  }
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    throw new JsonError("invalid_utf8", "body is not valid UTF-8");
  }
}

/**
 * Strict RFC 8259 parser that, unlike `JSON.parse`, rejects duplicate member
 * names (compared after escape decoding) and lone surrogate escapes. Objects
 * are created without a prototype so `__proto__` is an ordinary key.
 *
 * @param {string} text
 * @returns {JsonValue}
 */
export function parseStrictJson(text) {
  let position = 0;

  /** @returns {never} */
  function fail(message = "invalid JSON") {
    throw new JsonError("invalid_json", `${message} at offset ${position}`);
  }

  function skipWhitespace() {
    while (position < text.length) {
      const char = text[position];
      if (char === " " || char === "\t" || char === "\n" || char === "\r") {
        position += 1;
      } else {
        return;
      }
    }
  }

  /**
   * @param {number} depth
   * @returns {JsonValue}
   */
  function parseValue(depth) {
    if (depth > MAX_JSON_DEPTH) {
      throw new JsonError("nesting_too_deep", "JSON is nested too deeply");
    }
    skipWhitespace();
    const char = text[position];
    if (char === "{") {
      return parseObject(depth);
    }
    if (char === "[") {
      return parseArray(depth);
    }
    if (char === '"') {
      return parseString();
    }
    if (char === "-" || (char !== undefined && char >= "0" && char <= "9")) {
      return parseNumber();
    }
    for (const [literal, value] of /** @type {const} */ ([
      ["true", true],
      ["false", false],
      ["null", null],
    ])) {
      if (text.startsWith(literal, position)) {
        position += literal.length;
        return value;
      }
    }
    return fail();
  }

  /** @param {number} depth */
  function parseObject(depth) {
    position += 1;
    /** @type {Record<string, JsonValue>} */
    const result = Object.create(null);
    skipWhitespace();
    if (text[position] === "}") {
      position += 1;
      return result;
    }
    for (;;) {
      skipWhitespace();
      if (text[position] !== '"') {
        fail("expected member name");
      }
      const key = parseString();
      if (Object.hasOwn(result, key)) {
        throw new JsonError("duplicate_key", "duplicate JSON member name");
      }
      skipWhitespace();
      if (text[position] !== ":") {
        fail("expected colon");
      }
      position += 1;
      result[key] = parseValue(depth + 1);
      skipWhitespace();
      if (text[position] === ",") {
        position += 1;
      } else if (text[position] === "}") {
        position += 1;
        return result;
      } else {
        fail("expected comma or closing brace");
      }
    }
  }

  /** @param {number} depth */
  function parseArray(depth) {
    position += 1;
    /** @type {JsonValue[]} */
    const result = [];
    skipWhitespace();
    if (text[position] === "]") {
      position += 1;
      return result;
    }
    for (;;) {
      result.push(parseValue(depth + 1));
      skipWhitespace();
      if (text[position] === ",") {
        position += 1;
      } else if (text[position] === "]") {
        position += 1;
        return result;
      } else {
        fail("expected comma or closing bracket");
      }
    }
  }

  function parseString() {
    position += 1;
    let result = "";
    for (;;) {
      if (position >= text.length) {
        fail("unterminated string");
      }
      const char = text[position];
      const code = text.charCodeAt(position);
      if (char === '"') {
        position += 1;
        break;
      }
      if (code < 0x20) {
        fail("unescaped control character");
      }
      if (char !== "\\") {
        result += char;
        position += 1;
        continue;
      }
      const escapeChar = text[position + 1];
      position += 2;
      const simple = SIMPLE_ESCAPES.get(escapeChar ?? "");
      if (simple !== undefined) {
        result += simple;
      } else if (escapeChar === "u") {
        const hex = text.slice(position, position + 4);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) {
          fail("invalid unicode escape");
        }
        result += String.fromCharCode(Number.parseInt(hex, 16));
        position += 4;
      } else {
        fail("invalid escape");
      }
    }
    if (!result.isWellFormed()) {
      throw new JsonError("lone_surrogate", "string contains a lone surrogate");
    }
    return result;
  }

  function parseNumber() {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      text.slice(position),
    );
    if (!match) {
      return fail("invalid number");
    }
    position += match[0].length;
    return Number(match[0]);
  }

  const value = parseValue(0);
  skipWhitespace();
  if (position !== text.length) {
    fail("trailing characters");
  }
  return value;
}

const SIMPLE_ESCAPES = new Map([
  ['"', '"'],
  ["\\", "\\"],
  ["/", "/"],
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
]);

/**
 * Decodes, strictly parses and requires the exact canonical byte form.
 * Re-serializing must reproduce the received text, so whitespace, key order,
 * alternative escapes, number spellings and non-NFC strings are rejected.
 *
 * @param {Uint8Array} bytes
 * @returns {Record<string, JsonValue>}
 */
export function parseCanonicalJsonBytes(bytes) {
  const text = decodeStrictUtf8(bytes);
  const value = parseStrictJson(text);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new JsonError("invalid_json", "top-level JSON value must be an object");
  }
  if (serialize(value, 0) !== text) {
    throw new JsonError("non_canonical_json", "body is not in canonical JSON form");
  }
  return value;
}
