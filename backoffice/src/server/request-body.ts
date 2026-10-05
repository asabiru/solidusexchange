import type { IncomingMessage } from "node:http";

const maxBodyBytes = 4_096;
const jsonStringToken = /"(?:[^"\\]|\\.)*"/y;
const jsonWhitespace = /[ \t\n\r]*/y;
const charsetParameter = /^charset=(?:utf-8|"utf-8")$/i;

export class RequestBodyError extends Error {
  constructor(readonly status: 400 | 415) {
    super(status === 415 ? "Request body must be application/json" : "Request body is invalid");
    this.name = "RequestBodyError";
  }
}

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const [mediaType, ...parameters] = value.split(";").map((part) => part.trim());
  return mediaType.toLowerCase() === "application/json"
    && parameters.length <= 1
    && parameters.every((parameter) => charsetParameter.test(parameter));
}

function parseStringObject(text: string): Map<string, string> {
  let index = 0;
  const fail = (): never => {
    throw new RequestBodyError(400);
  };
  const skipWhitespace = () => {
    jsonWhitespace.lastIndex = index;
    jsonWhitespace.exec(text);
    index = jsonWhitespace.lastIndex;
  };
  const expect = (character: string) => {
    skipWhitespace();
    if (text[index] !== character) fail();
    index += 1;
  };
  const readString = (): string => {
    skipWhitespace();
    jsonStringToken.lastIndex = index;
    const match = jsonStringToken.exec(text);
    if (!match) return fail();
    index = jsonStringToken.lastIndex;
    try {
      return JSON.parse(match[0]) as string;
    } catch {
      return fail();
    }
  };

  const entries = new Map<string, string>();
  expect("{");
  skipWhitespace();
  if (text[index] !== "}") {
    for (;;) {
      const key = readString();
      expect(":");
      const value = readString();
      if (entries.has(key)) fail();
      entries.set(key, value);
      skipWhitespace();
      if (text[index] !== ",") break;
      index += 1;
    }
  }
  expect("}");
  skipWhitespace();
  if (index !== text.length) fail();
  return entries;
}

export async function readJsonBody<Required extends string, Optional extends string = never>(
  request: IncomingMessage,
  required: readonly Required[],
  optional: readonly Optional[] = []
): Promise<Record<Required, string> & Partial<Record<Optional, string>>> {
  if (!isJsonContentType(request.headers["content-type"])) throw new RequestBodyError(415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new RequestBodyError(400);
    chunks.push(buffer);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(Buffer.concat(chunks));
  } catch {
    throw new RequestBodyError(400);
  }
  const entries = parseStringObject(text);
  const allowed = new Set<string>([...required, ...optional]);
  for (const key of entries.keys()) {
    if (!allowed.has(key)) throw new RequestBodyError(400);
  }
  for (const key of required) {
    if (!entries.has(key)) throw new RequestBodyError(400);
  }
  return Object.fromEntries(entries) as Record<Required, string>
    & Partial<Record<Optional, string>>;
}
