import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(
  process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..")
);
const rootReal = realpathSync(root);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readContained(path) {
  const normalized = resolve(join(root, path));
  const resolvedReal = realpathSync(normalized);
  assert(
    resolvedReal === rootReal || resolvedReal.startsWith(`${rootReal}${sep}`),
    `Reference escapes contract package through a link: ${path}`
  );
  return readFileSync(normalized, "utf8");
}

function assertNoDuplicateKeys(text, label) {
  const stack = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (char === '"') {
      const start = index;
      index++;
      while (index < text.length) {
        if (text[index] === "\\") {
          index += 2;
          continue;
        }
        if (text[index] === '"') {
          index++;
          break;
        }
        index++;
      }
      let cursor = index;
      while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
      const top = stack[stack.length - 1];
      if (top instanceof Set && text[cursor] === ":") {
        const key = JSON.parse(text.slice(start, index));
        assert(!top.has(key), `${label}: duplicate JSON key ${JSON.stringify(key)}`);
        top.add(key);
      }
      continue;
    }
    if (char === "{") {
      stack.push(new Set());
      index++;
      continue;
    }
    if (char === "[") {
      stack.push(true);
      index++;
      continue;
    }
    if (char === "}" || char === "]") {
      stack.pop();
      index++;
      continue;
    }
    index++;
  }
}

function parseJsonStrict(text, label) {
  assertNoDuplicateKeys(text, label);
  return JSON.parse(text);
}

function readJson(path) {
  return parseJsonStrict(readContained(path), path);
}

function checkCompatibilityPolicy() {
  const policy = readContained("COMPATIBILITY.md");
  for (const requirement of [
    "## Compatible changes",
    "## Breaking changes",
    "## Deprecation",
    "## Event evolution",
    "## Review gates"
  ]) {
    assert(policy.includes(requirement), `Compatibility policy is missing ${requirement}`);
  }
}

function resolvePointer(document, pointer, label) {
  if (pointer === "" || pointer === "#") return document;
  assert(pointer.startsWith("#/"), `${label}: unsupported JSON pointer ${pointer}`);
  return pointer.slice(2).split("/").reduce((value, segment) => {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    assert(value && Object.hasOwn(value, key), `${label}: missing JSON pointer ${pointer}`);
    return value[key];
  }, document);
}

const parsedFiles = new Map();

function loadAbsolute(path) {
  const normalized = resolve(path);
  assert(
    normalized === root || normalized.startsWith(`${root}${sep}`),
    `Reference escapes contract package: ${normalized}`
  );
  const resolvedReal = realpathSync(normalized);
  assert(
    resolvedReal === rootReal || resolvedReal.startsWith(`${rootReal}${sep}`),
    `Reference escapes contract package through a link: ${normalized}`
  );
  if (!parsedFiles.has(normalized)) {
    parsedFiles.set(normalized, parseJsonStrict(readFileSync(normalized, "utf8"), normalized));
  }
  return parsedFiles.get(normalized);
}

function resolveRef(sourcePath, reference) {
  assert(
    reference.indexOf("#") === reference.lastIndexOf("#"),
    `Ambiguous $ref is prohibited: ${reference}`
  );
  const [filePart, fragment = ""] = reference.split("#", 2);
  const targetPath = filePart ? resolve(dirname(sourcePath), filePart) : sourcePath;
  const target = loadAbsolute(targetPath);
  return {
    document: target,
    path: targetPath,
    value: resolvePointer(target, fragment ? `#${fragment}` : "#", reference)
  };
}

function verifyReferences(value, sourcePath, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (Object.hasOwn(value, "$ref")) {
    assert(typeof value.$ref === "string", `$ref must be a string: ${sourcePath}`);
    assert(!/^[a-z][a-z0-9+.-]*:/i.test(value.$ref) && !value.$ref.startsWith("//"), `Remote $ref is prohibited: ${value.$ref}`);
    // `~` escapes are resolved by this checker but not by consumer validators,
    // so a reference the package accepts could be unresolvable downstream.
    assert(
      !["%", "\\", "~"].some((mark) => value.$ref.includes(mark)),
      `Encoded $ref is prohibited: ${value.$ref}`
    );
    for (const key of Object.keys(value)) {
      assert(allowedReferenceSiblings.has(key), `$ref sibling ${key} is prohibited: ${value.$ref}`);
    }
    const key = `${sourcePath}:${value.$ref}`;
    if (!seen.has(key)) {
      seen.add(key);
      const resolved = resolveRef(sourcePath, value.$ref);
      verifyReferences(resolved.value, resolved.path, seen);
    }
  }
  for (const child of Object.values(value)) verifyReferences(child, sourcePath, seen);
}

function sameSet(left, right, label) {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  assert(
    JSON.stringify(leftSorted) === JSON.stringify(rightSorted),
    `${label}: ${JSON.stringify(leftSorted)} != ${JSON.stringify(rightSorted)}`
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const boundedString = { type: "string", minLength: 1, maxLength: 128 };
const pinnedResponseSchemas = {
  ApiMetadata: {
    type: "object",
    additionalProperties: false,
    required: [
      "api_version",
      "contract_version",
      "runtime_boundary",
      "financial_commands_enabled",
      "production_providers_enabled"
    ],
    properties: {
      api_version: { const: "v1" },
      contract_version: { type: "string", const: "1.0.0-draft" },
      runtime_boundary: { const: "contract-only" },
      financial_commands_enabled: { const: false },
      production_providers_enabled: { const: false }
    }
  },
  SessionView: {
    type: "object",
    additionalProperties: false,
    required: ["subject", "actor_type", "scopes", "expires_at"],
    properties: {
      subject: boundedString,
      actor_type: { type: "string", enum: ["customer", "operator", "service"] },
      scopes: { type: "array", uniqueItems: true, items: boundedString },
      expires_at: { type: "string", format: "date-time" }
    }
  },
  CapabilitiesView: {
    type: "object",
    additionalProperties: false,
    required: ["capabilities", "commands_enabled"],
    properties: {
      capabilities: { type: "array", uniqueItems: true, items: boundedString },
      commands_enabled: { const: false }
    }
  },
  OperatorAdminView: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "operator_id", "subject", "role", "granted_capabilities", "created_at", "updated_at"],
    properties: {
      mode: { const: "test" },
      operator_id: { type: "string", pattern: "^opr_[0-9a-f]{24}$" },
      subject: { type: "string", pattern: "^syn_oper_[a-z0-9]{8,32}$" },
      role: {
        type: "string",
        enum: ["compliance-lead", "support-l1", "aml-investigator", "fraud-investigator", "auditor"]
      },
      granted_capabilities: {
        type: "array",
        uniqueItems: true,
        maxItems: 32,
        items: boundedString
      },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" }
    }
  },
  WalletsView: {
    type: "object",
    additionalProperties: false,
    required: ["wallets"],
    properties: {
      wallets: {
        type: "array",
        items: { $ref: "#/components/schemas/WalletView" }
      }
    }
  },
  WalletView: {
    type: "object",
    additionalProperties: false,
    required: ["wallet_id", "asset", "available", "hold"],
    properties: {
      wallet_id: { type: "string", pattern: "^syn_wal_[a-z0-9]{8,32}$" },
      asset: { $ref: "#/$defs/assetCode" },
      available: { $ref: "#/$defs/decimalAmount" },
      hold: { $ref: "#/$defs/decimalAmount" }
    }
  },
  NotificationsView: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "delivery", "unread", "notifications"],
    properties: {
      mode: { const: "test" },
      delivery: { const: "disabled" },
      unread: { type: "integer", minimum: 0 },
      notifications: {
        type: "array",
        items: { $ref: "#/components/schemas/NotificationView" }
      }
    }
  },
  NotificationView: {
    type: "object",
    additionalProperties: false,
    required: [
      "notification_id",
      "created_at",
      "channel",
      "template",
      "locale",
      "text",
      "mode",
      "delivered",
      "read"
    ],
    properties: {
      notification_id: { type: "string", pattern: "^ntf_[0-9a-f]{24}$" },
      created_at: { type: "string", format: "date-time" },
      channel: { const: "telegram-draft" },
      template: {
        type: "string",
        enum: [
          "session_login",
          "kyc_submitted",
          "kyc_in_review",
          "kyc_approved",
          "kyc_rejected",
          "kyc_needs_more_data",
          "kyc_timed_out",
          "kyc_unavailable",
          "support_received",
          "complaint_received"
        ]
      },
      locale: { const: "ru" },
      text: boundedString,
      mode: { const: "test" },
      delivered: { const: false },
      read: { type: "boolean" }
    }
  },
  KycStatusView: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "provider", "session_kyc", "status", "updated_at", "can_submit"],
    properties: {
      mode: { const: "test" },
      provider: { const: "simulator" },
      session_kyc: { type: "string", enum: ["unverified", "pending", "verified"] },
      status: {
        type: "string",
        enum: [
          "not_started",
          "submitted",
          "in_review",
          "approved",
          "rejected",
          "needs_more_data",
          "timed_out",
          "unavailable"
        ]
      },
      application_id: { type: "string", pattern: "^kyc_[0-9a-f]{24}$" },
      submitted_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
      review_deadline: { type: "string", format: "date-time" },
      reason_codes: {
        type: "array",
        uniqueItems: true,
        maxItems: 2,
        items: { type: "string", enum: ["SIM_DOCUMENT_UNREADABLE", "SIM_DATA_MISMATCH"] }
      },
      requested_items: {
        type: "array",
        uniqueItems: true,
        maxItems: 2,
        items: { type: "string", enum: ["proof_of_address", "selfie_retake"] }
      },
      can_submit: { type: "boolean" }
    }
  },
  ProfileView: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "customer_ref", "display_name", "locale", "registered_at"],
    properties: {
      mode: { const: "test" },
      customer_ref: { type: "string", pattern: "^SC-DEV-[0-9A-Z]{5}$" },
      display_name: {
        type: "string",
        minLength: 1,
        maxLength: 64,
        pattern: "^Customer [0-9a-f]{8}$"
      },
      locale: { type: "string", enum: ["en", "ky", "ru"] },
      registered_at: { type: "string", format: "date-time" }
    }
  },
  SupportTicketsView: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "delivery", "tickets"],
    properties: {
      mode: { const: "test" },
      delivery: { const: "disabled" },
      tickets: {
        type: "array",
        items: { $ref: "#/components/schemas/TicketView" }
      }
    }
  },
  TicketView: {
    type: "object",
    additionalProperties: false,
    required: [
      "ticket_id",
      "category",
      "topic",
      "message",
      "status",
      "timeline",
      "complaint_acknowledged",
      "created_at",
      "expires_at"
    ],
    properties: {
      ticket_id: { type: "string", pattern: "^tck_[0-9a-f]{24}$" },
      category: {
        type: "string",
        enum: ["question", "operation_problem", "complaint", "data_request"]
      },
      topic: { type: "string", minLength: 1, maxLength: 120 },
      message: { type: "string", minLength: 1, maxLength: 1000 },
      status: {
        type: "string",
        enum: ["received", "in_review", "answered", "closed"]
      },
      timeline: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["status", "at"],
          properties: {
            status: {
              type: "string",
              enum: ["received", "in_review", "answered", "closed"]
            },
            at: { type: "string", format: "date-time" }
          }
        }
      },
      complaint_acknowledged: { type: "boolean" },
      created_at: { type: "string", format: "date-time" },
      expires_at: { type: "string", format: "date-time" }
    }
  },
  DepositsView: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "deposits"],
    properties: {
      mode: { const: "test" },
      deposits: {
        type: "array",
        items: { $ref: "#/components/schemas/DepositView" }
      }
    }
  },
  DepositView: {
    type: "object",
    additionalProperties: false,
    required: [
      "deposit_id",
      "asset",
      "method",
      "status",
      "expected_amount",
      "received_total",
      "reversed_total",
      "payment_reference",
      "created_at",
      "updated_at",
      "posting"
    ],
    properties: {
      deposit_id: { type: "string", pattern: "^dep_[0-9a-f]{24}$" },
      asset: { $ref: "#/$defs/assetCode" },
      method: { const: "sbp" },
      status: {
        type: "string",
        enum: [
          "awaiting_payment",
          "payment_received",
          "partial_payment",
          "duplicate_payment",
          "payment_reversed",
          "expired_no_payment"
        ]
      },
      expected_amount: { $ref: "#/$defs/decimalAmount" },
      received_total: { $ref: "#/$defs/decimalAmount" },
      reversed_total: { $ref: "#/$defs/decimalAmount" },
      payment_reference: { type: "string", pattern: "^SIMSBP[0-9A-F]{12}$" },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
      posting: { const: "none" }
    }
  },
  WithdrawalsView: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "withdrawals"],
    properties: {
      mode: { const: "test" },
      withdrawals: {
        type: "array",
        items: { $ref: "#/components/schemas/WithdrawalView" }
      }
    }
  },
  WithdrawalView: {
    type: "object",
    additionalProperties: false,
    required: [
      "withdrawal_id",
      "asset",
      "network",
      "status",
      "amount",
      "fee_amount",
      "destination_reference",
      "legs",
      "created_at",
      "updated_at",
      "expires_at",
      "posting"
    ],
    properties: {
      withdrawal_id: { type: "string", pattern: "^wdr_[0-9a-f]{24}$" },
      asset: { $ref: "#/$defs/assetCode" },
      network: { type: "string", pattern: "^[A-Z0-9]+_TESTNET$" },
      status: {
        type: "string",
        enum: [
          "draft",
          "screened",
          "pending_maker_approval",
          "pending_checker_approval",
          "unsigned_intent_ready",
          "broadcast",
          "confirmed",
          "rejected",
          "cancelled",
          "expired"
        ]
      },
      amount: { $ref: "#/$defs/decimalAmount" },
      fee_amount: { $ref: "#/$defs/decimalAmount" },
      destination_reference: {
        type: "string",
        pattern: "^destination_ref_[a-z0-9_]{2,32}$"
      },
      legs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["leg_id", "asset", "amount", "direction"],
          properties: {
            leg_id: { type: "string", pattern: "^wdl_[0-9a-f]{24}$" },
            asset: { $ref: "#/$defs/assetCode" },
            amount: { $ref: "#/$defs/decimalAmount" },
            direction: { const: "out" }
          }
        }
      },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
      expires_at: { type: "string", format: "date-time" },
      posting: { const: "none" }
    }
  },
  QuotesView: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "quotes"],
    properties: {
      mode: { const: "test" },
      quotes: {
        type: "array",
        items: { $ref: "#/components/schemas/QuoteView" }
      }
    }
  },
  QuoteView: {
    type: "object",
    additionalProperties: false,
    required: [
      "quote_id",
      "pair",
      "base_asset",
      "quote_asset",
      "side",
      "base_amount",
      "mid_price",
      "price",
      "spread_bps",
      "fee_bps",
      "quote_amount",
      "fee_amount",
      "total_quote_amount",
      "rounding",
      "price_observed_at",
      "issued_at",
      "expires_at",
      "ttl_seconds",
      "status",
      "execution",
      "posting"
    ],
    properties: {
      quote_id: { type: "string", pattern: "^qte_[0-9a-f]{24}$" },
      pair: { type: "string", enum: ["USDT/RUB", "TON/RUB", "TON/USDT"] },
      base_asset: { $ref: "#/$defs/assetCode" },
      quote_asset: { $ref: "#/$defs/assetCode" },
      side: { type: "string", enum: ["buy", "sell"] },
      base_amount: { $ref: "#/$defs/decimalAmount" },
      mid_price: { $ref: "#/$defs/decimalAmount" },
      price: { $ref: "#/$defs/decimalAmount" },
      spread_bps: { type: "integer", minimum: 0, maximum: 1000 },
      fee_bps: { type: "integer", minimum: 0, maximum: 1000 },
      quote_amount: { $ref: "#/$defs/decimalAmount" },
      fee_amount: { $ref: "#/$defs/decimalAmount" },
      total_quote_amount: { $ref: "#/$defs/decimalAmount" },
      rounding: { type: "string", enum: ["up", "down"] },
      price_observed_at: { type: "string", format: "date-time" },
      issued_at: { type: "string", format: "date-time" },
      expires_at: { type: "string", format: "date-time" },
      ttl_seconds: { type: "integer", minimum: 1, maximum: 300 },
      status: { const: "indicative" },
      execution: { const: "not_supported" },
      posting: { const: "none" }
    }
  },
  ExchangeOrdersView: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "orders"],
    properties: {
      mode: { const: "test" },
      orders: {
        type: "array",
        items: { $ref: "#/components/schemas/ExchangeOrderView" }
      }
    }
  },
  ExchangeOrderView: {
    type: "object",
    additionalProperties: false,
    required: [
      "order_id",
      "pair",
      "base_asset",
      "quote_asset",
      "side",
      "order_type",
      "base_amount",
      "price",
      "quote_amount",
      "fee_bps",
      "fee_amount",
      "total_quote_amount",
      "status",
      "created_at",
      "updated_at",
      "execution",
      "posting"
    ],
    properties: {
      order_id: { type: "string", pattern: "^ord_[0-9a-f]{24}$" },
      pair: { type: "string", enum: ["USDT/RUB", "TON/RUB", "TON/USDT"] },
      base_asset: { $ref: "#/$defs/assetCode" },
      quote_asset: { $ref: "#/$defs/assetCode" },
      side: { type: "string", enum: ["buy", "sell"] },
      order_type: { type: "string", enum: ["market", "limit"] },
      base_amount: { $ref: "#/$defs/decimalAmount" },
      price: { $ref: "#/$defs/decimalAmount" },
      quote_amount: { $ref: "#/$defs/decimalAmount" },
      fee_bps: { type: "integer", minimum: 0, maximum: 1000 },
      fee_amount: { $ref: "#/$defs/decimalAmount" },
      total_quote_amount: { $ref: "#/$defs/decimalAmount" },
      status: { type: "string", enum: ["open", "cancelled", "expired", "rejected"] },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
      execution: { const: "not_supported" },
      posting: { const: "none" }
    }
  },
  PaymentsView: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "payments"],
    properties: {
      mode: { const: "test" },
      payments: {
        type: "array",
        items: { $ref: "#/components/schemas/PaymentView" }
      }
    }
  },
  PaymentView: {
    type: "object",
    additionalProperties: false,
    required: [
      "payment_id",
      "asset",
      "method",
      "status",
      "amount",
      "fee_amount",
      "total_amount",
      "recipient_reference",
      "provider_reference",
      "created_at",
      "updated_at",
      "posting"
    ],
    properties: {
      payment_id: { type: "string", pattern: "^pay_[0-9a-f]{24}$" },
      asset: { $ref: "#/$defs/assetCode" },
      method: { const: "sbp" },
      status: {
        type: "string",
        enum: ["created", "processing", "completed", "failed", "reversed", "cancelled", "expired"]
      },
      amount: { $ref: "#/$defs/decimalAmount" },
      fee_amount: { $ref: "#/$defs/decimalAmount" },
      total_amount: { $ref: "#/$defs/decimalAmount" },
      recipient_reference: { type: "string", pattern: "^recipient_ref_[a-z0-9_]{2,32}$" },
      provider_reference: { type: ["string", "null"], pattern: "^SIMBANK[0-9A-F]{16}$" },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
      posting: { const: "none" }
    }
  },
  CardsView: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "cards"],
    properties: {
      mode: { const: "test" },
      cards: {
        type: "array",
        items: { $ref: "#/components/schemas/CardView" }
      }
    }
  },
  CardView: {
    type: "object",
    additionalProperties: false,
    required: [
      "card_id",
      "brand",
      "kind",
      "status",
      "last4",
      "token_reference",
      "asset",
      "monthly_limit",
      "created_at",
      "expires_at",
      "updated_at",
      "posting"
    ],
    properties: {
      card_id: { type: "string", pattern: "^crd_[0-9a-f]{24}$" },
      brand: { type: "string", enum: ["visa", "mastercard", "mir"] },
      kind: { type: "string", enum: ["virtual", "physical"] },
      status: {
        type: "string",
        enum: ["pending_activation", "active", "frozen", "blocked", "expired", "terminated"]
      },
      last4: { type: "string", pattern: "^[0-9]{4}$" },
      token_reference: { type: "string", pattern: "^tok_[0-9a-f]{24}$" },
      asset: { $ref: "#/$defs/assetCode" },
      monthly_limit: { $ref: "#/$defs/decimalAmount" },
      created_at: { type: "string", format: "date-time" },
      expires_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
      posting: { const: "none" }
    }
  },
  AuthSessionsView: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "sessions"],
    properties: {
      mode: { const: "test" },
      sessions: {
        type: "array",
        items: { $ref: "#/components/schemas/AuthSessionView" }
      }
    }
  },
  AuthSessionView: {
    type: "object",
    additionalProperties: false,
    required: ["session_id", "platform", "state", "created_at", "last_seen_at", "current"],
    properties: {
      session_id: { type: "string", pattern: "^sess_[0-9a-f]{24}$" },
      platform: { type: "string", enum: ["web", "ios", "android", "telegram-mini-app"] },
      state: { type: "string", enum: ["active", "revoked", "expired"] },
      created_at: { type: "string", format: "date-time" },
      last_seen_at: { type: "string", format: "date-time" },
      current: { type: "boolean" }
    }
  },
  UserView: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "user_id", "subject", "status", "flags", "created_at", "updated_at"],
    properties: {
      mode: { const: "test" },
      user_id: { type: "string", pattern: "^usr_[0-9a-f]{24}$" },
      subject: { type: "string", pattern: "^syn_cust_[a-z0-9]{8,32}$" },
      status: { type: "string", enum: ["pending", "active", "suspended", "closed"] },
      flags: {
        type: "object",
        additionalProperties: false,
        required: ["terms_accepted", "two_factor_enabled", "marketing_opt_in"],
        properties: {
          terms_accepted: { type: "boolean" },
          two_factor_enabled: { type: "boolean" },
          marketing_opt_in: { type: "boolean" }
        }
      },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" }
    }
  },
  CheckPreviewRequest: {
    type: "object",
    additionalProperties: false,
    required: ["check_type", "recipient_ref", "amount", "asset"],
    properties: {
      check_type: { const: "personal" },
      recipient_ref: boundedString,
      amount: { $ref: "#/$defs/decimalAmount" },
      asset: { $ref: "#/$defs/assetCode" },
      comment: { type: "string", maxLength: 140 }
    }
  },
  CheckClaimRequest: {
    type: "object",
    additionalProperties: false,
    required: ["claim_reference"],
    properties: {
      claim_reference: {
        type: "string",
        minLength: 16,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$"
      }
    }
  },
  CheckPreview: {
    type: "object",
    additionalProperties: false,
    required: [
      "check_type",
      "recipient_ref",
      "amount",
      "asset",
      "fee_amount",
      "preview_reference",
      "expires_at",
      "posting"
    ],
    properties: {
      check_type: { const: "personal" },
      recipient_ref: boundedString,
      amount: { $ref: "#/$defs/decimalAmount" },
      asset: { $ref: "#/$defs/assetCode" },
      fee_amount: { $ref: "#/$defs/decimalAmount" },
      preview_reference: {
        type: "string",
        minLength: 16,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$"
      },
      expires_at: { type: "string", format: "date-time" },
      posting: { const: "none" }
    }
  },
  ChecksView: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "checks"],
    properties: {
      mode: { const: "test" },
      checks: {
        type: "array",
        items: { $ref: "#/components/schemas/CheckView" }
      }
    }
  },
  CheckView: {
    type: "object",
    additionalProperties: false,
    required: [
      "check_id",
      "check_type",
      "status",
      "sender_ref",
      "recipient_ref",
      "amount",
      "asset",
      "fee_amount",
      "outstanding_amount",
      "created_at",
      "expires_at",
      "resolved_at",
      "posting"
    ],
    properties: {
      check_id: boundedString,
      check_type: { const: "personal" },
      status: {
        type: "string",
        enum: [
          "awaiting_confirmation",
          "created",
          "awaiting_recipient_kyc",
          "claimed",
          "cancelled",
          "expired"
        ]
      },
      sender_ref: boundedString,
      recipient_ref: boundedString,
      amount: { $ref: "#/$defs/decimalAmount" },
      asset: { $ref: "#/$defs/assetCode" },
      fee_amount: { $ref: "#/$defs/decimalAmount" },
      outstanding_amount: { $ref: "#/$defs/decimalAmount" },
      created_at: { type: "string", format: "date-time" },
      expires_at: { type: "string", format: "date-time" },
      resolved_at: { type: ["string", "null"], format: "date-time" },
      posting: { const: "none" }
    }
  }
};

function refs(operation) {
  return new Set(
    (operation.parameters ?? [])
      .map((parameter) => parameter.$ref)
      .filter(Boolean)
  );
}

const pinnedParameterNames = new Set([
  "CheckId",
  "ClientVersion",
  "DeviceId",
  "IdempotencyKey",
  "Platform",
  "RequestId"
]);

const canonicalHeaderParameters = new Map([
  ["x-request-id", "#/components/parameters/RequestId"],
  ["x-client-version", "#/components/parameters/ClientVersion"],
  ["x-platform", "#/components/parameters/Platform"],
  ["x-device-id", "#/components/parameters/DeviceId"],
  ["idempotency-key", "#/components/parameters/IdempotencyKey"]
]);

function verifyUniqueParameters(pathParameters, operationParameters, sourcePath, label) {
  const seen = new Set();
  for (const parameter of [...(pathParameters ?? []), ...(operationParameters ?? [])]) {
    const resolved = parameter.$ref ? resolveRef(sourcePath, parameter.$ref).value : parameter;
    const key = `${resolved?.in}:${String(resolved?.name ?? "").toLowerCase()}`;
    assert(!seen.has(key), `Duplicate parameter ${resolved?.in} ${resolved?.name}: ${label}`);
    seen.add(key);
  }
}

function verifyCanonicalHeaderParameters(parameters, sourcePath, label) {
  for (const parameter of parameters ?? []) {
    assert(
      parameter && typeof parameter === "object" && !Array.isArray(parameter),
      `Parameter entries must be objects: ${label}`
    );
    const resolved = parameter.$ref ? resolveRef(sourcePath, parameter.$ref).value : parameter;
    if (resolved?.in === "path") {
      assert(
        canonicalJson(parameter) === canonicalJson({ $ref: "#/components/parameters/CheckId" }),
        `Path parameter must use only the canonical CheckId parameter: ${label}`
      );
      continue;
    }
    const canonical = canonicalHeaderParameters.get(String(resolved?.name ?? "").toLowerCase());
    if (canonical) {
      assert(
        canonicalJson(parameter) === canonicalJson({ $ref: canonical }),
        `${resolved.name} must use only the canonical ${canonical} parameter: ${label}`
      );
      continue;
    }
    const refMatch = String(parameter?.$ref ?? "").match(/^#\/components\/parameters\/([^/]+)$/);
    const isPinnedReference =
      refMatch &&
      pinnedParameterNames.has(refMatch[1]) &&
      canonicalJson(parameter) === canonicalJson({ $ref: parameter.$ref });
    if (!isPinnedReference) {
      assert(
        ["header", "query"].includes(resolved?.in),
        `Parameter location ${JSON.stringify(resolved?.in)} is not allowed in this slice: ${label}`
      );
      assert(resolved?.required !== true, `Only canonical parameters may be required: ${label}`);
      assert(
        resolved?.required === undefined || typeof resolved.required === "boolean",
        `Non-canonical parameters must be explicitly optional: ${label}`
      );
    }
  }
}

function verifyRequestIdResponseHeader(response, label) {
  const headers = response?.headers ?? {};
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() !== "x-request-id") continue;
    assert(name === "X-Request-Id", `Response request ID header must be spelled X-Request-Id: ${label}`);
  }
  assert(
    canonicalJson(headers["X-Request-Id"]) === canonicalJson({ $ref: "#/components/headers/RequestId" }),
    `Response must echo the canonical X-Request-Id header: ${label}`
  );
}

const allowedOpenApiExtensions = [
  "x-solidchange-runtime-boundary",
  "x-solidchange-financial-commands-enabled",
  "x-solidchange-production-providers-enabled",
  "x-solidchange-planned-namespaces"
];

function checkOpenApi() {
  const path = join(root, "openapi.yaml");
  const openapi = loadAbsolute(path);
  assert(!Object.hasOwn(openapi, "webhooks"), "OpenAPI webhooks are prohibited in this slice");
  assert(openapi.openapi === "3.1.0", "OpenAPI version must be 3.1.0");
  assert(openapi.info?.version === "1.0.0-draft", "Contract version mismatch");
  assert(openapi["x-solidchange-runtime-boundary"] === "contract-only", "Runtime boundary must remain contract-only");
  assert(openapi["x-solidchange-financial-commands-enabled"] === false, "Financial commands must remain disabled");
  assert(openapi["x-solidchange-production-providers-enabled"] === false, "Production providers must remain disabled");
  sameSet(
    Object.keys(openapi).filter((key) => !key.startsWith("x-")),
    ["$defs", "components", "info", "jsonSchemaDialect", "openapi", "paths", "servers", "tags"],
    "Top-level OpenAPI fields"
  );
  assert(
    openapi.jsonSchemaDialect === "https://json-schema.org/draft/2020-12/schema",
    "OpenAPI JSON Schema dialect must remain pinned"
  );
  sameSet(Object.keys(openapi.info ?? {}), ["description", "title", "version"], "OpenAPI info fields");
  assert(
    canonicalJson(openapi.servers) === canonicalJson([
      { url: "https://api.sandbox.invalid", description: "Non-routable contract placeholder" }
    ]),
    "OpenAPI servers must remain non-routable placeholders"
  );
  sameSet(
    (openapi.tags ?? []).map((tag) => tag?.name),
    ["Customer", "Metadata", "Operator"],
    "OpenAPI tags"
  );
  sameSet(
    Object.keys(openapi["x-solidchange-planned-namespaces"] ?? {}),
    ["customer", "operator"],
    "Planned namespaces"
  );
  sameSet(
    openapi["x-solidchange-planned-namespaces"]?.customer ?? [],
    [],
    "Planned customer namespaces"
  );
  sameSet(
    openapi["x-solidchange-planned-namespaces"]?.operator ?? [],
    [],
    "Planned operator namespaces"
  );

  const securitySchemes = openapi.components?.securitySchemes ?? {};
  sameSet(
    Object.keys(securitySchemes),
    ["CustomerBearer", "OperatorBearer"],
    "OpenAPI securitySchemes"
  );
  for (const name of ["CustomerBearer", "OperatorBearer"]) {
    const scheme = securitySchemes[name];
    assert(scheme?.type === "http", `${name} must remain an HTTP security scheme`);
    assert(scheme.scheme === "bearer", `${name} must remain a bearer security scheme`);
    assert(
      scheme.bearerFormat === "OIDC access token",
      `${name} must remain an OIDC access-token scheme`
    );
  }

  const operationIds = new Set();
  const pinnedOperationPaths = new Map([
    ["getApiMetadata", "/api/v1/meta"],
    ["getCustomerSession", "/api/v1/customer/session"],
    ["getCustomerCapabilities", "/api/v1/customer/capabilities"],
    ["getCustomerWallets", "/api/v1/customer/wallets"],
    ["getCustomerNotifications", "/api/v1/customer/notifications"],
    ["getCustomerKyc", "/api/v1/customer/kyc"],
    ["getCustomerProfile", "/api/v1/customer/profile"],
    ["getCustomerSupport", "/api/v1/customer/support"],
    ["getCustomerDeposits", "/api/v1/customer/deposits"],
    ["getCustomerWithdrawals", "/api/v1/customer/withdrawals"],
    ["getCustomerQuotes", "/api/v1/customer/quotes"],
    ["getCustomerExchangeOrders", "/api/v1/customer/exchange-orders"],
    ["getCustomerPayments", "/api/v1/customer/payments"],
    ["getCustomerCards", "/api/v1/customer/cards"],
    ["getCustomerAuth", "/api/v1/customer/auth"],
    ["getCustomerUsers", "/api/v1/customer/users"],
    ["getOperatorSession", "/api/v1/operator/session"],
    ["getOperatorCapabilities", "/api/v1/operator/capabilities"],
    ["getOperatorAdmin", "/api/v1/operator/admin"],
    ["getCustomerChecks", "/api/v1/customer/checks"],
    ["previewCustomerCheck", "/api/v1/customer/checks/preview"],
    ["getCustomerCheckStatus", "/api/v1/customer/checks/{checkId}"],
    ["claimCustomerCheck", "/api/v1/customer/checks/{checkId}/claim"],
    ["cancelCustomerCheck", "/api/v1/customer/checks/{checkId}/cancel"]
  ]);
  const commandOperations = new Set([
    "previewCustomerCheck",
    "claimCustomerCheck",
    "cancelCustomerCheck"
  ]);
  const commandRequestSchemas = new Map([
    ["previewCustomerCheck", "#/components/schemas/CheckPreviewRequest"],
    ["claimCustomerCheck", "#/components/schemas/CheckClaimRequest"]
  ]);
  const methodNames = new Set(["get", "put", "post", "delete", "patch", "options", "head", "trace"]);
  // Every declared non-2xx status must be a pure $ref to the canonical
  // component for that status, and the status set itself is pinned so an
  // operation can neither grow nor silently drop an error response.
  const canonicalErrorResponses = new Map([
    ["401", "#/components/responses/Unauthenticated"],
    ["403", "#/components/responses/Forbidden"],
    ["404", "#/components/responses/NotFound"],
    ["409", "#/components/responses/Conflict"],
    ["429", "#/components/responses/RateLimited"],
    ["500", "#/components/responses/InternalError"]
  ]);
  const readStatuses = ["200", "401", "429", "500"];
  const gatedReadStatuses = ["200", "401", "403", "429", "500"];
  const pinnedResponseStatuses = new Map([
    ["getApiMetadata", ["200", "500"]],
    ["getCustomerSession", readStatuses],
    ["getCustomerCapabilities", readStatuses],
    ["getCustomerWallets", gatedReadStatuses],
    ["getCustomerNotifications", gatedReadStatuses],
    ["getCustomerKyc", readStatuses],
    ["getCustomerProfile", readStatuses],
    ["getCustomerSupport", readStatuses],
    ["getCustomerDeposits", gatedReadStatuses],
    ["getCustomerWithdrawals", gatedReadStatuses],
    ["getCustomerQuotes", gatedReadStatuses],
    ["getCustomerExchangeOrders", gatedReadStatuses],
    ["getCustomerPayments", gatedReadStatuses],
    ["getCustomerCards", gatedReadStatuses],
    ["getCustomerAuth", readStatuses],
    ["getCustomerUsers", readStatuses],
    ["getOperatorSession", gatedReadStatuses],
    ["getOperatorCapabilities", gatedReadStatuses],
    ["getOperatorAdmin", readStatuses],
    ["getCustomerChecks", gatedReadStatuses],
    ["previewCustomerCheck", gatedReadStatuses],
    ["getCustomerCheckStatus", ["200", "401", "403", "404", "429", "500"]],
    ["claimCustomerCheck", ["200", "401", "403", "404", "409", "429", "500"]],
    ["cancelCustomerCheck", ["200", "401", "403", "404", "409", "429", "500"]]
  ]);
  const successSchemas = new Map([
    ["getApiMetadata", "#/components/schemas/ApiMetadata"],
    ["getCustomerSession", "#/components/schemas/SessionView"],
    ["getCustomerCapabilities", "#/components/schemas/CapabilitiesView"],
    ["getCustomerWallets", "#/components/schemas/WalletsView"],
    ["getCustomerNotifications", "#/components/schemas/NotificationsView"],
    ["getCustomerKyc", "#/components/schemas/KycStatusView"],
    ["getCustomerProfile", "#/components/schemas/ProfileView"],
    ["getCustomerSupport", "#/components/schemas/SupportTicketsView"],
    ["getCustomerDeposits", "#/components/schemas/DepositsView"],
    ["getCustomerWithdrawals", "#/components/schemas/WithdrawalsView"],
    ["getCustomerQuotes", "#/components/schemas/QuotesView"],
    ["getCustomerExchangeOrders", "#/components/schemas/ExchangeOrdersView"],
    ["getCustomerPayments", "#/components/schemas/PaymentsView"],
    ["getCustomerCards", "#/components/schemas/CardsView"],
    ["getCustomerAuth", "#/components/schemas/AuthSessionsView"],
    ["getCustomerUsers", "#/components/schemas/UserView"],
    ["getOperatorSession", "#/components/schemas/SessionView"],
    ["getOperatorCapabilities", "#/components/schemas/CapabilitiesView"],
    ["getOperatorAdmin", "#/components/schemas/OperatorAdminView"],
    ["getCustomerChecks", "#/components/schemas/ChecksView"],
    ["previewCustomerCheck", "#/components/schemas/CheckPreview"],
    ["getCustomerCheckStatus", "#/components/schemas/CheckView"],
    ["claimCustomerCheck", "#/components/schemas/CheckView"],
    ["cancelCustomerCheck", "#/components/schemas/CheckView"]
  ]);
  const allowedPathItemFields = new Set([...methodNames, "parameters"]);
  const allowedOperationFields = new Set([
    "callbacks",
    "description",
    "operationId",
    "parameters",
    "requestBody",
    "responses",
    "security",
    "summary",
    "tags"
  ]);
  for (const [pathName, pathItem] of Object.entries(openapi.paths ?? {})) {
    assert(pathName.startsWith("/api/v1/"), `Unversioned API path: ${pathName}`);
    assert(!Object.hasOwn(pathItem, "$ref"), `Path item $ref is prohibited: ${pathName}`);
    for (const key of Object.keys(pathItem ?? {})) {
      assert(
        allowedPathItemFields.has(key),
        `Path item field ${key} is not allowed in this slice: ${pathName}`
      );
    }
    assert(
      [...methodNames].some((method) => Object.hasOwn(pathItem ?? {}, method)),
      `Path item must declare at least one operation: ${pathName}`
    );
    verifyCanonicalHeaderParameters(pathItem.parameters, path, pathName);
    const pathParameterRefs = refs(pathItem);
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methodNames.has(method)) continue;
      assert(
        operation && typeof operation === "object" && !Array.isArray(operation),
        `Operation must be an object: ${method.toUpperCase()} ${pathName}`
      );
      for (const key of Object.keys(operation)) {
        assert(
          key.startsWith("x-") || allowedOperationFields.has(key),
          `Operation field ${key} is not allowed in this slice: ${method.toUpperCase()} ${pathName}`
        );
      }
      assert(operation.operationId, `Missing operationId: ${method.toUpperCase()} ${pathName}`);
      const commandOperation = commandOperations.has(operation.operationId);
      assert(
        commandOperation ? method === "post" : method === "get",
        commandOperation
          ? `Command operation must remain POST: ${operation.operationId} ${pathName}`
          : `Mutation method is prohibited in this slice: ${method.toUpperCase()} ${pathName}`
      );
      assert(!operationIds.has(operation.operationId), `Duplicate operationId: ${operation.operationId}`);
      operationIds.add(operation.operationId);
      assert(
        pinnedOperationPaths.get(operation.operationId) === pathName,
        `Operation path is not pinned: ${operation.operationId} ${pathName}`
      );

      const expectedRequestSchema = commandRequestSchemas.get(operation.operationId);
      if (expectedRequestSchema !== undefined) {
        const body = operation.requestBody;
        assert(body?.required === true, `Command request body must be required: ${operation.operationId}`);
        sameSet(
          Object.keys(body?.content ?? {}),
          ["application/json"],
          `Command request media types for ${operation.operationId}`
        );
        assert(
          canonicalJson(body?.content?.["application/json"]?.schema)
            === canonicalJson({ $ref: expectedRequestSchema }),
          `Command request must use canonical schema: ${operation.operationId}`
        );
      } else {
        assert(
          !Object.hasOwn(operation, "requestBody"),
          `Request bodies are prohibited in this slice: ${operation.operationId}`
        );
      }
      assert(
        !Object.hasOwn(operation, "callbacks"),
        `Callbacks are prohibited in this slice: ${operation.operationId}`
      );
      verifyCanonicalHeaderParameters(operation.parameters, path, operation.operationId);
      verifyUniqueParameters(pathItem.parameters, operation.parameters, path, operation.operationId);
      const requestHeaders = new Set([...refs(operation), ...pathParameterRefs]);
      assert(
        requestHeaders.has("#/components/parameters/RequestId"),
        `Missing X-Request-Id: ${operation.operationId}`
      );
      const isCheckPath = pathName.includes("{checkId}");
      assert(
        isCheckPath === requestHeaders.has("#/components/parameters/CheckId"),
        `checkId path parameter must be bound exactly on templated check paths: ${operation.operationId}`
      );
      if (commandOperation) {
        assert(
          requestHeaders.has("#/components/parameters/IdempotencyKey"),
          `Missing Idempotency-Key: ${operation.operationId}`
        );
      } else {
        assert(
          !requestHeaders.has("#/components/parameters/IdempotencyKey"),
          `Read-only operation must not require Idempotency-Key: ${operation.operationId}`
        );
      }
      if (pathName.startsWith("/api/v1/operator/")) {
        assert(
          requestHeaders.has("#/components/parameters/DeviceId"),
          `Missing X-Device-Id: ${operation.operationId}`
        );
      } else {
        assert(
          !requestHeaders.has("#/components/parameters/DeviceId"),
          `X-Device-Id is approved only for operator operations: ${operation.operationId}`
        );
      }
      if (pathName === "/api/v1/meta") {
        assert(
          canonicalJson(operation.security) === "[]",
          `Metadata operation must stay unauthenticated: ${operation.operationId}`
        );
      } else {
        const expectedScheme = pathName.startsWith("/api/v1/customer/")
          ? "CustomerBearer"
          : "OperatorBearer";
        assert(
          Array.isArray(operation.security) && operation.security.length === 1,
          `Security must contain exactly one ${expectedScheme} requirement: ${operation.operationId}`
        );
        const securityRequirement = operation.security[0];
        sameSet(
          Object.keys(securityRequirement),
          [expectedScheme],
          `Security schemes for ${operation.operationId}`
        );
        assert(
          Array.isArray(securityRequirement[expectedScheme])
            && securityRequirement[expectedScheme].length === 0,
          `Bearer security scopes must be empty: ${operation.operationId}`
        );
        assert(
          requestHeaders.has("#/components/parameters/ClientVersion"),
          `Missing X-Client-Version: ${operation.operationId}`
        );
        assert(
          requestHeaders.has("#/components/parameters/Platform"),
          `Missing X-Platform: ${operation.operationId}`
        );
      }

      const success = operation.responses?.["200"];
      verifyRequestIdResponseHeader(success, `${operation.operationId} 200`);
      const expectedSchema = successSchemas.get(operation.operationId);
      assert(expectedSchema, `Success schema is not pinned: ${operation.operationId}`);
      sameSet(
        Object.keys(operation.responses ?? {}).filter((status) => status.startsWith("2")),
        ["200"],
        `Success response statuses for ${operation.operationId}`
      );
      sameSet(
        Object.keys(success.content ?? {}),
        ["application/json"],
        `Success response media types for ${operation.operationId} 200`
      );
      assert(
        canonicalJson(success.content?.["application/json"]?.schema) === canonicalJson({ $ref: expectedSchema }),
        `Success response must use canonical schema: ${operation.operationId} 200`
      );
      sameSet(
        Object.keys(operation.responses ?? {}),
        pinnedResponseStatuses.get(operation.operationId) ?? [],
        `Response statuses for ${operation.operationId}`
      );
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (status.startsWith("2")) continue;
        const canonicalError = canonicalErrorResponses.get(status);
        const resolvedResponse = response.$ref
          ? resolveRef(path, response.$ref).value
          : response;
        sameSet(
          Object.keys(resolvedResponse.content ?? {}),
          ["application/json"],
          `Error response media types for ${operation.operationId} ${status}`
        );
        assert(
          canonicalJson(resolvedResponse.content?.["application/json"]?.schema)
            === canonicalJson({ $ref: "#/components/schemas/Error" }),
          `Error response must use canonical Error schema: ${operation.operationId} ${status}`
        );
        verifyRequestIdResponseHeader(resolvedResponse, `${operation.operationId} ${status}`);
        assert(
          canonicalJson(response) === canonicalJson({ $ref: canonicalError }),
          `Error response ${status} must reference the canonical component: ${operation.operationId}`
        );
      }
    }
  }
  sameSet(operationIds, pinnedOperationPaths.keys(), "Pinned API operations");
  for (const name of ["pathItems", "callbacks", "requestBodies"]) {
    assert(
      !Object.hasOwn(openapi.components ?? {}, name),
      `OpenAPI components.${name} are prohibited in this slice`
    );
  }

  const parameters = openapi.components?.parameters ?? {};
  const parameterNames = {
    RequestId: "X-Request-Id",
    ClientVersion: "X-Client-Version",
    Platform: "X-Platform",
    DeviceId: "X-Device-Id",
    IdempotencyKey: "Idempotency-Key"
  };
  for (const [name, headerName] of Object.entries(parameterNames)) {
    assert(parameters[name]?.required === true, `${name} must be required when used`);
    assert(parameters[name]?.in === "header", `${name} must remain a header parameter`);
    assert(parameters[name]?.name === headerName, `${name} must use ${headerName}`);
  }
  const clientVersionSchema = parameters.ClientVersion?.schema;
  assert(
    clientVersionSchema?.type === "string"
      && clientVersionSchema.minLength === 1
      && clientVersionSchema.maxLength === 64,
    "Canonical ClientVersion constraints must remain pinned"
  );
  const platformSchema = parameters.Platform?.schema;
  assert(
    platformSchema?.type === "string",
    "Canonical Platform type must remain pinned"
  );
  sameSet(
    platformSchema.enum ?? [],
    ["web", "ios", "android", "telegram-mini-app", "operator-web", "service"],
    "Canonical Platform enum"
  );
  assert(
    parameters.DeviceId?.schema?.$ref === "#/components/schemas/DeviceId",
    "DeviceId must use canonical DeviceId schema"
  );
  const deviceIdSchema = openapi.components?.schemas?.DeviceId;
  assert(
    canonicalJson(deviceIdSchema) === canonicalJson({
      type: "string",
      format: "uuid",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    }),
    "Canonical DeviceId constraints must remain pinned"
  );
  assert(
    parameters.RequestId?.schema?.$ref === "#/components/schemas/UuidV7",
    "RequestId must use canonical UuidV7 schema"
  );
  const uuidV7Schema = openapi.components?.schemas?.UuidV7;
  assert(
    uuidV7Schema?.type === "string"
      && uuidV7Schema.format === "uuid"
      && uuidV7Schema.pattern === "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    "Canonical UuidV7 constraints must remain pinned"
  );
  assert(
    parameters.IdempotencyKey?.schema?.$ref === "#/components/schemas/IdempotencyKey",
    "IdempotencyKey must use canonical IdempotencyKey schema"
  );
  const idempotencyKeySchema = openapi.components?.schemas?.IdempotencyKey;
  assert(
    idempotencyKeySchema?.type === "string"
      && idempotencyKeySchema.minLength === 16
      && idempotencyKeySchema.maxLength === 128
      && idempotencyKeySchema.pattern === "^[A-Za-z0-9._:-]+$",
    "Canonical IdempotencyKey constraints must remain pinned"
  );
  const checkIdParameter = parameters.CheckId;
  assert(checkIdParameter?.required === true, "CheckId must be required when used");
  assert(checkIdParameter?.in === "path", "CheckId must remain a path parameter");
  assert(checkIdParameter?.name === "checkId", "CheckId must use checkId");
  assert(
    canonicalJson(checkIdParameter?.schema) === canonicalJson({
      type: "string",
      pattern: "^[a-z][a-z0-9_-]{2,127}$"
    }),
    "Canonical CheckId constraints must remain pinned"
  );
  for (const name of ["decimalAmount", "assetCode"]) {
    assert(
      canonicalJson(openapi.$defs?.[name]) === canonicalJson(pinnedEventEnvelopeDefinitions[name]),
      `Canonical OpenAPI ${name} definition must remain pinned`
    );
  }
  for (const [name, expected] of Object.entries(pinnedResponseSchemas)) {
    assert(
      canonicalJson(openapi.components?.schemas?.[name]) === canonicalJson(expected),
      `Canonical ${name} schema must remain pinned`
    );
  }
  assert(
    canonicalJson(openapi.components?.schemas?.Error) === canonicalJson({ $ref: "./schemas/error.schema.json" }),
    "Canonical error schema is not referenced"
  );
  for (const [name, response] of Object.entries(openapi.components?.responses ?? {})) {
    verifyRequestIdResponseHeader(response, `${name} response`);
    sameSet(
      Object.keys(response?.headers ?? {}),
      name === "RateLimited" ? ["Retry-After", "X-Request-Id"] : ["X-Request-Id"],
      `${name} response headers`
    );
  }
  const { description: _requestIdDescription, ...requestIdHeader } = openapi.components?.headers?.RequestId ?? {};
  assert(
    canonicalJson(requestIdHeader) === canonicalJson({
      required: true,
      schema: { $ref: "#/components/schemas/UuidV7" }
    }),
    "Canonical RequestId response header must remain required with the UuidV7 schema"
  );
  const { description: _retryAfterDescription, ...retryAfterHeader } =
    openapi.components?.headers?.RetryAfter ?? {};
  assert(
    canonicalJson(retryAfterHeader) === canonicalJson({
      required: true,
      schema: { type: "integer", minimum: 1 }
    }),
    "Canonical RetryAfter response header must remain required with a positive-integer schema"
  );
  verifyNoNestedSchemaIdentifiers(openapi, "OpenAPI");
  verifyReferences(openapi, path);
  verifyNoExtensions(openapi, "OpenAPI", new Set(allowedOpenApiExtensions));
  verifyMoneyFieldSchemas(openapi, "OpenAPI");
  verifySafeFields(openapi, "OpenAPI");
  // The container sets are pinned last so dedicated checks keep their
  // dedicated rejections when a fixture mutates a member's shape.
  sameSet(
    Object.keys(openapi.components ?? {}),
    ["headers", "parameters", "responses", "schemas", "securitySchemes"],
    "OpenAPI components fields"
  );
  sameSet(
    Object.keys(openapi.components?.schemas ?? {}),
    ["UuidV7", "DeviceId", "IdempotencyKey", ...Object.keys(pinnedResponseSchemas), "Error"],
    "OpenAPI components.schemas"
  );
  sameSet(
    Object.keys(openapi.components?.responses ?? {}),
    ["Unauthenticated", "Forbidden", "NotFound", "Conflict", "RateLimited", "InternalError"],
    "OpenAPI components.responses"
  );
  sameSet(
    Object.keys(openapi.components?.parameters ?? {}),
    [...pinnedParameterNames],
    "OpenAPI components.parameters"
  );
  sameSet(
    Object.keys(openapi.components?.headers ?? {}),
    ["RequestId", "RetryAfter"],
    "OpenAPI components.headers"
  );
}

const pinnedErrorProperties = {
  code: {
    type: "string",
    enum: [
      "AUTHENTICATION_REQUIRED",
      "CAPABILITY_DENIED",
      "IDEMPOTENCY_CONFLICT",
      "INTERNAL_ERROR",
      "OPERATION_REQUIRES_REVIEW",
      "RATE_LIMITED",
      "VALIDATION_FAILED",
      "VERSION_UNSUPPORTED"
    ]
  },
  message: { type: "string", minLength: 1, maxLength: 256 },
  request_id: { type: "string", format: "uuid" },
  details: { type: "object" }
};

function withoutDescription(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { description: _description, ...rest } = value;
  return rest;
}

function checkErrorSchema() {
  const path = join(root, "schemas/error.schema.json");
  const schema = readJson("schemas/error.schema.json");
  sameSet(
    Object.keys(schema),
    ["$schema", "$id", "title", "type", "additionalProperties", "required", "properties"],
    "Error envelope schema keywords"
  );
  assert(schema.$schema === "https://json-schema.org/draft/2020-12/schema", "Error envelope dialect must remain pinned");
  assert(
    schema.$id === "https://contracts.solidchange.invalid/schemas/error.schema.json",
    "Error envelope $id must remain pinned"
  );
  assert(schema.type === "object", "Error envelope must remain an object");
  sameSet(
    schema.required,
    ["code", "message", "request_id", "details"],
    "Error envelope required fields"
  );
  assert(schema.additionalProperties === false, "Error envelope must reject unknown top-level fields");
  assert(schema.properties?.code?.enum?.length >= 1, "Error codes must be an explicit stable enum");
  sameSet(Object.keys(schema.properties ?? {}), Object.keys(pinnedErrorProperties), "Error envelope properties");
  for (const [name, expected] of Object.entries(pinnedErrorProperties)) {
    assert(
      canonicalJson(withoutDescription(schema.properties[name])) === canonicalJson(expected),
      `Canonical error ${name} schema must remain pinned`
    );
  }
  verifyReferences(schema, path);
  verifyMoneyFieldSchemas(schema, "error schema");
  verifyNoExtensions(schema, "error schema");
  verifySafeFields(schema, "error schema");
}

function payloadSchemas(eventSchema) {
  const result = new Map();
  for (const condition of eventSchema.allOf ?? []) {
    const name = condition.if?.properties?.event_type?.const;
    const payloadRef = condition.then?.properties?.payload?.$ref;
    const aggregateType = condition.then?.properties?.aggregate_type?.const;
    assert(name && payloadRef && aggregateType, "Every event condition must bind type, aggregate and payload");
    assert(!result.has(name), `Duplicate event condition: ${name}`);
    result.set(name, { aggregateType, payloadRef });
  }
  return result;
}

function schemaTypeMatches(value, expected) {
  if (expected === "null") return value === null;
  if (expected === "array") return Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === expected;
}

function validateValue(value, schema, rootSchema, label) {
  if (schema.$ref) {
    assert(schema.$ref.startsWith("#/"), `${label}: example validator only supports local refs`);
    return validateValue(value, resolvePointer(rootSchema, schema.$ref, label), rootSchema, label);
  }
  if (schema.anyOf) {
    const accepted = schema.anyOf.some((candidate) => {
      try {
        validateValue(value, candidate, rootSchema, label);
        return true;
      } catch {
        return false;
      }
    });
    assert(accepted, `${label}: value does not match any allowed schema`);
    return;
  }
  if (schema.const !== undefined) assert(value === schema.const, `${label}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum) assert(schema.enum.includes(value), `${label}: value is outside enum`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    assert(types.some((type) => schemaTypeMatches(value, type)), `${label}: type mismatch`);
  }
  if (typeof value === "string") {
    const length = [...value].length;
    if (schema.minLength !== undefined) assert(length >= schema.minLength, `${label}: string is too short`);
    if (schema.maxLength !== undefined) assert(length <= schema.maxLength, `${label}: string is too long`);
    if (schema.pattern) assert(new RegExp(schema.pattern, "u").test(value), `${label}: pattern mismatch`);
    if (schema.format === "uuid") {
      assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value), `${label}: invalid UUID`);
    }
    if (schema.format === "date-time") {
      assert(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
          && Number.isFinite(Date.parse(value)),
        `${label}: invalid date-time`
      );
    }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined) assert(value >= schema.minimum, `${label}: below minimum`);
    if (schema.maximum !== undefined) assert(value <= schema.maximum, `${label}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined) assert(value.length >= schema.minItems, `${label}: too few items`);
    if (schema.maxItems !== undefined) assert(value.length <= schema.maxItems, `${label}: too many items`);
    if (schema.uniqueItems) {
      assert(new Set(value.map((item) => canonicalJson(item))).size === value.length, `${label}: duplicate items`);
    }
    if (schema.items) value.forEach((item, index) => validateValue(item, schema.items, rootSchema, `${label}[${index}]`));
  } else if (value !== null && typeof value === "object") {
    for (const required of schema.required ?? []) {
      assert(Object.hasOwn(value, required), `${label}: missing ${required}`);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) assert(allowed.has(key), `${label}: unknown field ${key}`);
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties?.[key];
      if (childSchema) validateValue(child, childSchema, rootSchema, `${label}.${key}`);
    }
  }
}

const prohibitedFields = new Set([
  "access_token",
  "api_key",
  "credential",
  "document_image",
  "document_number",
  "email",
  "mfa_seed",
  "mnemonic",
  "password",
  "phone",
  "private_key",
  "provider_payload",
  "raw_transaction",
  "raw_provider_payload",
  "secret",
  "seed",
  "signature",
  "signed_transaction",
  "wallet_address"
]);

function verifySafeFields(value, label) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const name = key.toLowerCase();
    assert(
      ![...prohibitedFields].some((field) => name.includes(field)),
      `${label}: prohibited field ${key}`
    );
    verifySafeFields(child, `${label}.${key}`);
  }
}

// Money-bearing names a field can pick without ever containing "amount":
// the convention would otherwise let e.g. unit_price or wallet_balance drift
// to a float or a free-form string while every check stays green.
const moneyFieldWords = new Set([
  "balance",
  "commission",
  "cost",
  "discount",
  "fee",
  "interest",
  "leverage",
  "margin",
  "notional",
  "payout",
  "premium",
  "price",
  "principal",
  "qty",
  "quantity",
  "rate",
  "spread",
  "sum",
  "tax",
  "volume"
]);

function allowedMoneyFieldSchemas(propertyName) {
  const name = propertyName.toLowerCase();
  if (name.includes("amount") || name.includes("total")) return [decimalAmountRef];
  if (name === "asset" || name.endsWith("_asset") || name === "currency" || name.endsWith("_currency")) {
    return [assetCodeRef];
  }
  if (name === "network" || name.endsWith("_network")) return [networkCodeRef, testnetNetwork];
  if (moneyFieldWords.has(name) || [...moneyFieldWords].some((word) => name.endsWith(`_${word}`))) {
    return [decimalAmountRef];
  }
  return null;
}

function verifyMoneyFieldSchemas(value, label) {
  if (!value || typeof value !== "object") return;
  if (value.properties && typeof value.properties === "object" && !Array.isArray(value.properties)) {
    for (const [propertyName, property] of Object.entries(value.properties)) {
      assert(/^[a-z][a-z0-9_]*$/.test(propertyName), `${label}: property name ${JSON.stringify(propertyName)} must be lowercase ASCII snake_case`);
      const allowed = allowedMoneyFieldSchemas(propertyName);
      if (!allowed) continue;
      assert(
        allowed.some((schema) => canonicalJson(property) === canonicalJson(schema)),
        `${label}.${propertyName} must use exactly ${allowed.map((schema) => schema.$ref ?? JSON.stringify(schema)).join(" or ")}`
      );
    }
  }
  for (const [key, child] of Object.entries(value)) verifyMoneyFieldSchemas(child, `${label}.${key}`);
}

const allowedReferenceSiblings = new Set(["$ref", "summary", "description"]);

const nameMapKeywords = new Set([
  "$defs",
  "content",
  "headers",
  "parameters",
  "paths",
  "properties",
  "responses",
  "schemas",
  "securitySchemes"
]);

function verifyNoExtensions(value, label, allowedTopLevel = new Set(), nameMap = false) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (!nameMap && key.toLowerCase().startsWith("x-")) {
      assert(allowedTopLevel.has(key), `${label}: specification extension ${key} is prohibited`);
      continue;
    }
    const childIsNameMap = !nameMap && nameMapKeywords.has(key) && child && typeof child === "object" && !Array.isArray(child);
    verifyNoExtensions(child, `${label}.${key}`, new Set(), childIsNameMap);
  }
}

const pinnedEventEnvelopeRequired = [
  "event_id",
  "event_type",
  "event_version",
  "occurred_at",
  "producer",
  "aggregate_type",
  "aggregate_id",
  "correlation_id",
  "causation_id",
  "idempotency_key",
  "actor",
  "data_classification",
  "payload"
];

const pinnedEventEnvelopeProperties = {
  event_id: { type: "string", format: "uuid" },
  event_version: { const: 1 },
  aggregate_id: { $ref: "#/$defs/identifier" },
  correlation_id: { type: "string", format: "uuid" },
  causation_id: { type: ["string", "null"], format: "uuid" },
  idempotency_key: { type: ["string", "null"], minLength: 16, maxLength: 128 },
  actor: { $ref: "#/$defs/actor" }
};

const pinnedEventEnvelopeDefinitions = {
  identifier: { type: "string", pattern: "^[a-z][a-z0-9_-]{2,127}$" },
  digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  decimalAmount: { type: "string", pattern: "^(0|[1-9][0-9]*)(\\.[0-9]+)?$" },
  assetCode: { type: "string", pattern: "^[A-Z0-9]{2,16}$" },
  networkCode: { type: "string", pattern: "^[A-Z0-9_-]{2,32}$" },
  actor: {
    type: "object",
    additionalProperties: false,
    required: ["type", "subject"],
    properties: {
      type: { type: "string", enum: ["customer", "operator", "service", "provider"] },
      subject: { $ref: "#/$defs/identifier" }
    }
  }
};

const pinnedEventSchemaKeys = ["$schema", "$id", "title", "type", "additionalProperties", "required", "properties", "allOf", "$defs"];

function pinnedEventEnvelopeContextProperties() {
  return {
    occurred_at: dateTime,
    producer: { type: "string", pattern: "^[a-z][a-z0-9-]{1,63}$" },
    aggregate_type: {
      type: "string",
      enum: [...new Set(Object.values(pinnedEventContracts).map((contract) => contract.aggregateType))]
    },
    data_classification: { type: "string", enum: ["confidential", "highly-confidential"] },
    payload: { type: "object" }
  };
}

function withSortedEnum(schema) {
  if (!schema || typeof schema !== "object" || !Array.isArray(schema.enum)) return schema;
  return { ...schema, enum: [...schema.enum].sort() };
}

function verifyEventEnvelope(eventSchema) {
  sameSet(Object.keys(eventSchema), pinnedEventSchemaKeys, "Event schema keywords");
  assert(
    eventSchema.$schema === "https://json-schema.org/draft/2020-12/schema",
    "Event schema dialect must remain pinned"
  );
  assert(
    eventSchema.$id === "https://contracts.solidchange.invalid/schemas/events/domain-event.schema.json",
    "Event schema $id must remain pinned"
  );
  assert(
    eventSchema.type === "object" && eventSchema.additionalProperties === false,
    "Event envelope must reject unknown top-level fields"
  );
  assert(Array.isArray(eventSchema.required), "Event envelope required fields must be explicit");
  sameSet(eventSchema.required, pinnedEventEnvelopeRequired, "Event envelope required fields");
  assert(
    eventSchema.properties && typeof eventSchema.properties === "object" && !Array.isArray(eventSchema.properties),
    "Event envelope properties must be explicit"
  );
  sameSet(Object.keys(eventSchema.properties), pinnedEventEnvelopeRequired, "Event envelope properties");
  for (const [name, expected] of Object.entries(pinnedEventEnvelopeProperties)) {
    assert(
      canonicalJson(eventSchema.properties?.[name]) === canonicalJson(expected),
      `Canonical event ${name} schema must remain pinned`
    );
  }
  for (const [name, expected] of Object.entries(pinnedEventEnvelopeContextProperties())) {
    assert(
      canonicalJson(withSortedEnum(eventSchema.properties?.[name])) === canonicalJson(withSortedEnum(expected)),
      `Canonical event ${name} schema must remain pinned`
    );
  }
  for (const [name, expected] of Object.entries(pinnedEventEnvelopeDefinitions)) {
    assert(
      canonicalJson(eventSchema.$defs?.[name]) === canonicalJson(expected),
      `Canonical event ${name} definition must remain pinned`
    );
  }
}

const schemaIdentifierKeywords = new Set([
  "$id",
  "$anchor",
  "$dynamicAnchor",
  "$dynamicRef",
  "$recursiveAnchor",
  "$recursiveRef",
  "$schema",
  "$vocabulary"
]);

function verifyNoNestedSchemaIdentifiers(value, label, isRoot = true) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(
      !schemaIdentifierKeywords.has(key) || (isRoot && (key === "$schema" || key === "$id")),
      `${label}: nested ${key} is prohibited because it can retarget references`
    );
    verifyNoNestedSchemaIdentifiers(child, `${label}.${key}`, false);
  }
}

const allowedEventPropertySchemaKeywords = new Set([
  "$ref",
  "additionalProperties",
  "anyOf",
  "const",
  "description",
  "enum",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "pattern",
  "properties",
  "required",
  "type",
  "uniqueItems"
]);

const allowedEventStringFormats = new Set(["date-time", "uuid"]);

const allowedEventSchemaTypes = new Set(["string", "integer", "boolean", "object", "array", "null"]);

let eventSchemaDefinitions = {};

function verifyClosedEventSchema(schema, label) {
  assert(
    schema && typeof schema === "object" && !Array.isArray(schema),
    `${label} must be an explicit schema object`
  );
  for (const key of Object.keys(schema)) {
    assert(allowedEventPropertySchemaKeywords.has(key), `${label}: schema keyword ${key} is prohibited`);
  }
  assert(
    ["$ref", "anyOf", "const", "enum", "type"].some((key) => Object.hasOwn(schema, key)),
    `${label} must declare type, const, enum, $ref or anyOf`
  );
  if (Object.hasOwn(schema, "$ref")) {
    const target = /^#\/\$defs\/([A-Za-z][A-Za-z0-9]*)$/.exec(schema.$ref)?.[1];
    assert(
      target && Object.hasOwn(eventSchemaDefinitions, target),
      `${label}: event $ref ${schema.$ref} must target a checked #/$defs definition`
    );
  }
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  assert(
    !types.includes("number"),
    `${label}: floating-point number type is prohibited; use decimal strings or integers`
  );
  if (Object.hasOwn(schema, "type")) {
    assert(
      types.length > 0
        && new Set(types).size === types.length
        && types.every((type) => allowedEventSchemaTypes.has(type))
        && (types.length === 1 || (types.length === 2 && types.includes("null"))),
      `${label}: type must be exactly one of ${[...allowedEventSchemaTypes].join(", ")}, optionally nullable`
    );
  }
  for (const keyword of ["minLength", "maxLength", "minItems", "maxItems"]) {
    assert(
      !Object.hasOwn(schema, keyword)
        || (Number.isInteger(schema[keyword]) && schema[keyword] >= 0),
      `${label}: ${keyword} must be a non-negative integer`
    );
  }
  for (const keyword of ["minimum", "maximum"]) {
    assert(
      !Object.hasOwn(schema, keyword)
        || (typeof schema[keyword] === "number" && Number.isFinite(schema[keyword])),
      `${label}: ${keyword} must be a finite number`
    );
  }
  for (const keyword of ["pattern", "format", "$ref"]) {
    assert(
      !Object.hasOwn(schema, keyword) || typeof schema[keyword] === "string",
      `${label}: ${keyword} must be a string`
    );
  }
  assert(
    !Object.hasOwn(schema, "uniqueItems") || typeof schema.uniqueItems === "boolean",
    `${label}: uniqueItems must be a boolean`
  );
  if (typeof schema.pattern === "string") {
    try {
      new RegExp(schema.pattern, "u");
    } catch {
      assert(false, `${label}: pattern must compile under the Unicode flag`);
    }
  }
  assert(
    !Object.hasOwn(schema, "enum")
      || (Array.isArray(schema.enum)
        && schema.enum.length > 0
        && new Set(schema.enum.map((member) => canonicalJson(member))).size === schema.enum.length),
    `${label}: enum must be an array of unique literals`
  );
  assert(
    !Object.hasOwn(schema, "required")
      || (Array.isArray(schema.required)
        && schema.required.every((name) => typeof name === "string")
        && new Set(schema.required).size === schema.required.length),
    `${label}: required must be an array of unique property names`
  );
  const literals = [
    ...(Object.hasOwn(schema, "const") ? [schema.const] : []),
    ...(Array.isArray(schema.enum) ? schema.enum : [])
  ];
  for (const literal of literals) {
    assert(
      typeof literal !== "number" || Number.isInteger(literal),
      `${label}: floating-point literals are prohibited`
    );
    assert(
      types.length === 0 || types.some((type) => schemaTypeMatches(literal, type)),
      `${label}: literal ${JSON.stringify(literal)} violates the declared type`
    );
  }
  if (types.length > 0) {
    for (const keyword of ["additionalProperties", "properties", "required"]) {
      assert(
        !Object.hasOwn(schema, keyword) || types.includes("object"),
        `${label}: ${keyword} requires an object type`
      );
    }
    for (const keyword of ["items", "maxItems", "minItems", "uniqueItems"]) {
      assert(
        !Object.hasOwn(schema, keyword) || types.includes("array"),
        `${label}: ${keyword} requires an array type`
      );
    }
    for (const keyword of ["format", "maxLength", "minLength", "pattern"]) {
      assert(
        !Object.hasOwn(schema, keyword) || types.includes("string"),
        `${label}: ${keyword} requires a string type`
      );
    }
    for (const keyword of ["maximum", "minimum"]) {
      assert(
        !Object.hasOwn(schema, keyword) || types.includes("integer"),
        `${label}: ${keyword} requires an integer type`
      );
    }
  }
  if (Object.hasOwn(schema, "format")) {
    assert(allowedEventStringFormats.has(schema.format), `${label}: string format ${schema.format} is prohibited`);
  }
  if (types.includes("object") || Object.hasOwn(schema, "properties") || Object.hasOwn(schema, "required")) {
    assert(schema.additionalProperties === false, `${label} object must set additionalProperties to false`);
    assert(
      schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties),
      `${label} object must declare explicit properties`
    );
    for (const name of schema.required ?? []) {
      assert(
        Object.hasOwn(schema.properties, name),
        `${label}: required property ${name} is not declared`
      );
    }
    for (const [name, child] of Object.entries(schema.properties)) {
      verifyClosedEventSchema(child, `${label}.${name}`);
    }
  } else {
    assert(!Object.hasOwn(schema, "additionalProperties"), `${label}: additionalProperties requires an object schema`);
  }
  if (types.includes("array") || Object.hasOwn(schema, "items")) {
    assert(Object.hasOwn(schema, "items"), `${label} array must declare items`);
    verifyClosedEventSchema(schema.items, `${label}.items`);
  }
  if (Object.hasOwn(schema, "anyOf")) {
    assert(Array.isArray(schema.anyOf) && schema.anyOf.length > 0, `${label}: anyOf must be a non-empty array`);
    schema.anyOf.forEach((candidate, index) => verifyClosedEventSchema(candidate, `${label}.anyOf[${index}]`));
  }
}

function verifyClosedEventSchemas(eventSchema) {
  eventSchemaDefinitions = eventSchema.$defs ?? {};
  for (const [name, property] of Object.entries(eventSchema.properties ?? {})) {
    if (name === "payload") continue;
    verifyClosedEventSchema(property, `event schema.properties.${name}`);
  }
  for (const [name, definition] of Object.entries(eventSchema.$defs ?? {})) {
    verifyClosedEventSchema(definition, `event schema.$defs.${name}`);
  }
}

const piiPropertyNameFragments = [
  "birth",
  "email",
  "firstname",
  "fullname",
  "familyname",
  "givenname",
  "lastname",
  "maiden",
  "mail",
  "msisdn",
  "nationality",
  "passport",
  "phone",
  "postal",
  "postcode",
  "street",
  "surname"
];

const piiPropertyNameTokens = new Set([
  "address",
  "addresses",
  "city",
  "dob",
  "document",
  "documents",
  "given",
  "mobile",
  "name",
  "names",
  "ssn",
  "tel",
  "zip"
]);

const allowedReferencePropertyNames = new Set(["address_reference"]);

function verifyNoPiiPropertyNames(value, label) {
  if (!value || typeof value !== "object") return;
  if (value.properties && typeof value.properties === "object" && !Array.isArray(value.properties)) {
    for (const propertyName of Object.keys(value.properties)) {
      if (allowedReferencePropertyNames.has(propertyName)) continue;
      const name = propertyName.toLowerCase();
      assert(
        !piiPropertyNameFragments.some((fragment) => name.includes(fragment))
          && !name.split("_").some((token) => piiPropertyNameTokens.has(token)),
        `${label}: PII-like property ${propertyName} is prohibited; use an opaque reference or digest`
      );
    }
  }
  for (const [key, child] of Object.entries(value)) verifyNoPiiPropertyNames(child, `${label}.${key}`);
}

const identifierRef = { $ref: "#/$defs/identifier" };
const digestRef = { $ref: "#/$defs/digest" };
const decimalAmountRef = { $ref: "#/$defs/decimalAmount" };
const assetCodeRef = { $ref: "#/$defs/assetCode" };
const networkCodeRef = { $ref: "#/$defs/networkCode" };
const testnetNetwork = { type: "string", pattern: "^[A-Z0-9]+_TESTNET$" };
const dateTime = { type: "string", format: "date-time" };
const nullableIdentifier = { anyOf: [identifierRef, { type: "null" }] };

const pinnedEventContracts = {
  UserRegistered: {
    version: 1,
    aggregateType: "user",
    owner: "identity",
    dataClassification: "confidential",
    payload: "userRegistered",
    required: ["user_id", "registration_channel"],
    properties: {
      user_id: identifierRef,
      registration_channel: { type: "string", enum: ["web", "ios", "android", "telegram-mini-app", "migration"] }
    }
  },
  KycSubmitted: {
    version: 1,
    aggregateType: "kyc_case",
    owner: "customer-risk",
    dataClassification: "highly-confidential",
    payload: "kycSubmitted",
    required: ["case_id", "user_id", "provider_reference", "evidence_digest"],
    properties: {
      case_id: identifierRef,
      user_id: identifierRef,
      provider_reference: identifierRef,
      evidence_digest: digestRef
    }
  },
  KycVerified: {
    version: 1,
    aggregateType: "kyc_case",
    owner: "customer-risk",
    dataClassification: "highly-confidential",
    payload: "kycVerified",
    required: ["case_id", "user_id", "decision", "policy_version", "evidence_digest"],
    properties: {
      case_id: identifierRef,
      user_id: identifierRef,
      decision: { type: "string", enum: ["approved", "rejected", "manual-review"] },
      policy_version: { type: "string", minLength: 1, maxLength: 64 },
      evidence_digest: digestRef
    }
  },
  WalletAddressAssigned: {
    version: 1,
    aggregateType: "wallet",
    owner: "custody-orchestrator",
    dataClassification: "highly-confidential",
    payload: "walletAddressAssigned",
    required: ["wallet_id", "user_id", "asset", "network", "address_reference", "custody_account_id"],
    properties: {
      wallet_id: identifierRef,
      user_id: identifierRef,
      asset: assetCodeRef,
      network: networkCodeRef,
      address_reference: identifierRef,
      custody_account_id: identifierRef
    }
  },
  DepositDetected: {
    version: 1,
    aggregateType: "deposit",
    owner: "deposit-orchestrator",
    dataClassification: "confidential",
    payload: "depositDetected",
    required: ["deposit_id", "wallet_id", "asset", "network", "amount", "transaction_reference", "observed_at"],
    properties: {
      deposit_id: identifierRef,
      wallet_id: identifierRef,
      asset: assetCodeRef,
      network: networkCodeRef,
      amount: decimalAmountRef,
      transaction_reference: identifierRef,
      observed_at: dateTime
    }
  },
  DepositConfirmed: {
    version: 1,
    aggregateType: "deposit",
    owner: "deposit-orchestrator",
    dataClassification: "confidential",
    payload: "depositConfirmed",
    required: ["deposit_id", "confirmations", "confirmed_at"],
    properties: {
      deposit_id: identifierRef,
      confirmations: { type: "integer", minimum: 1 },
      confirmed_at: dateTime,
      journal_id: nullableIdentifier
    }
  },
  QuoteCreated: {
    version: 1,
    aggregateType: "quote",
    owner: "pricing",
    dataClassification: "confidential",
    payload: "quoteCreated",
    required: ["quote_id", "user_id", "from_asset", "to_asset", "from_amount", "to_amount", "fee_amount", "pricing_source", "expires_at"],
    properties: {
      quote_id: identifierRef,
      user_id: identifierRef,
      from_asset: assetCodeRef,
      to_asset: assetCodeRef,
      from_amount: decimalAmountRef,
      to_amount: decimalAmountRef,
      fee_amount: decimalAmountRef,
      pricing_source: identifierRef,
      expires_at: dateTime
    }
  },
  ExchangeOrderCreated: {
    version: 1,
    aggregateType: "exchange_order",
    owner: "exchange",
    dataClassification: "confidential",
    payload: "exchangeOrderCreated",
    required: ["order_id", "quote_id", "user_id", "status"],
    properties: {
      order_id: identifierRef,
      quote_id: identifierRef,
      user_id: identifierRef,
      status: { const: "created" }
    }
  },
  ExchangeSettled: {
    version: 1,
    aggregateType: "exchange_order",
    owner: "settlement",
    dataClassification: "confidential",
    payload: "exchangeSettled",
    required: ["order_id", "journal_id", "settled_at"],
    properties: {
      order_id: identifierRef,
      journal_id: identifierRef,
      settled_at: dateTime
    }
  },
  WithdrawalRequested: {
    version: 1,
    aggregateType: "withdrawal",
    owner: "withdrawals",
    dataClassification: "highly-confidential",
    payload: "withdrawalRequested",
    required: ["withdrawal_id", "user_id", "asset", "network", "amount", "destination_reference"],
    properties: {
      withdrawal_id: identifierRef,
      user_id: identifierRef,
      asset: assetCodeRef,
      network: networkCodeRef,
      amount: decimalAmountRef,
      destination_reference: identifierRef
    }
  },
  WithdrawalHeld: {
    version: 1,
    aggregateType: "withdrawal",
    owner: "withdrawals",
    dataClassification: "highly-confidential",
    payload: "withdrawalHeld",
    required: ["withdrawal_id", "hold_id", "reason_code"],
    properties: {
      withdrawal_id: identifierRef,
      hold_id: identifierRef,
      reason_code: { type: "string", pattern: "^[A-Z][A-Z0-9_]{2,63}$" }
    }
  },
  WithdrawalApproved: {
    version: 1,
    aggregateType: "withdrawal",
    owner: "approvals",
    dataClassification: "highly-confidential",
    payload: "withdrawalApproved",
    required: ["withdrawal_id", "approval_id", "approver_count", "evidence_digest"],
    properties: {
      withdrawal_id: identifierRef,
      approval_id: identifierRef,
      approver_count: { type: "integer", minimum: 1 },
      evidence_digest: digestRef
    }
  },
  CustodyIntentPrepared: {
    version: 1,
    aggregateType: "withdrawal",
    owner: "custody-orchestrator",
    dataClassification: "highly-confidential",
    payload: "custodyIntentPrepared",
    required: ["withdrawal_id", "custody_intent_id", "intent_digest", "policy_digest", "approval_evidence_digest", "asset", "network", "expires_at", "status", "execution_authority", "production_signing_enabled"],
    properties: {
      withdrawal_id: identifierRef,
      custody_intent_id: identifierRef,
      intent_digest: digestRef,
      policy_digest: digestRef,
      approval_evidence_digest: digestRef,
      asset: assetCodeRef,
      network: testnetNetwork,
      expires_at: dateTime,
      status: { const: "unsigned_intent_ready" },
      execution_authority: { const: false },
      production_signing_enabled: { const: false }
    }
  },
  WithdrawalBroadcast: {
    version: 1,
    aggregateType: "withdrawal",
    owner: "custody-orchestrator",
    dataClassification: "highly-confidential",
    payload: "withdrawalBroadcast",
    required: ["withdrawal_id", "transaction_reference", "broadcast_at"],
    properties: {
      withdrawal_id: identifierRef,
      transaction_reference: identifierRef,
      broadcast_at: dateTime
    }
  },
  PaymentConfirmed: {
    version: 1,
    aggregateType: "payment",
    owner: "payments",
    dataClassification: "confidential",
    payload: "paymentConfirmed",
    required: ["payment_id", "provider_reference", "amount", "currency", "confirmed_at"],
    properties: {
      payment_id: identifierRef,
      provider_reference: identifierRef,
      amount: decimalAmountRef,
      currency: assetCodeRef,
      confirmed_at: dateTime
    }
  },
  PaymentRefunded: {
    version: 1,
    aggregateType: "payment",
    owner: "payments",
    dataClassification: "confidential",
    payload: "paymentRefunded",
    required: ["payment_id", "refund_id", "amount", "currency", "journal_id", "refunded_at"],
    properties: {
      payment_id: identifierRef,
      refund_id: identifierRef,
      amount: decimalAmountRef,
      currency: assetCodeRef,
      journal_id: identifierRef,
      refunded_at: dateTime
    }
  },
  AmlAlertCreated: {
    version: 1,
    aggregateType: "aml_alert",
    owner: "aml",
    dataClassification: "highly-confidential",
    payload: "amlAlertCreated",
    required: ["alert_id", "user_id", "risk_score", "rule_codes"],
    properties: {
      alert_id: identifierRef,
      user_id: identifierRef,
      risk_score: { type: "integer", minimum: 0, maximum: 100 },
      rule_codes: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", pattern: "^[A-Z][A-Z0-9_]{2,63}$" } },
      case_id: nullableIdentifier
    }
  }
};

const allowedPayloadSchemaKeys = ["type", "additionalProperties", "required", "properties"];

const pinnedEventCatalogKeys = ["catalog_version", "compatibility_policy", "execution_authority", "events"];

const pinnedEventCatalogEntryKeys = ["name", "current_version", "aggregate_type", "owner", "data_classification"];

function verifyEventCatalogShape(catalog) {
  sameSet(Object.keys(catalog), pinnedEventCatalogKeys, "Event catalog keys");
  assert(catalog.catalog_version === 1, "Event catalog version must remain 1");
  assert(
    catalog.compatibility_policy === "additive-with-versioned-breaking-changes",
    "Event catalog compatibility policy must remain pinned"
  );
  assert(Array.isArray(catalog.events), "Event catalog events must be an array");
  for (const entry of catalog.events) {
    assert(entry && typeof entry === "object" && !Array.isArray(entry), "Event catalog entries must be objects");
    sameSet(Object.keys(entry), pinnedEventCatalogEntryKeys, `Event catalog entry ${entry.name} keys`);
  }
}

function verifyPinnedEvents(eventSchema, conditions, catalog) {
  const eventTypes = eventSchema.properties?.event_type?.enum ?? [];
  assert(new Set(eventTypes).size === eventTypes.length, "Event schema contains duplicate event types");
  sameSet(eventTypes, Object.keys(pinnedEventContracts), "Pinned event types");
  const { enum: _eventTypes, ...eventTypeSchema } = eventSchema.properties.event_type;
  assert(
    canonicalJson(eventTypeSchema) === canonicalJson({ type: "string" }),
    "Canonical event event_type schema must remain pinned"
  );
  for (const [name, pinned] of Object.entries(pinnedEventContracts)) {
    const condition = conditions.get(name);
    const catalogEntry = catalog.events.find((entry) => entry.name === name);
    assert(catalogEntry?.current_version === pinned.version, `${name}: event version must remain pinned`);
    assert(
      condition?.aggregateType === pinned.aggregateType && catalogEntry.aggregate_type === pinned.aggregateType,
      `${name}: aggregate type must remain pinned`
    );
    assert(catalogEntry.owner === pinned.owner, `${name}: owner must remain pinned`);
    assert(
      catalogEntry.data_classification === pinned.dataClassification,
      `${name}: data classification must remain pinned`
    );
    assert(condition.payloadRef === `#/$defs/${pinned.payload}`, `${name}: payload schema must remain pinned`);
    const conditionSchema = eventSchema.allOf.find((entry) => entry.if?.properties?.event_type?.const === name);
    assert(
      canonicalJson(conditionSchema) === canonicalJson({
        if: { properties: { event_type: { const: name } }, required: ["event_type"] },
        then: {
          properties: {
            aggregate_type: { const: pinned.aggregateType },
            data_classification: { const: pinned.dataClassification },
            payload: { $ref: `#/$defs/${pinned.payload}` }
          }
        }
      }),
      `${name}: event condition must remain pinned`
    );
    const payload = eventSchema.$defs?.[pinned.payload];
    assert(payload && typeof payload === "object", `${name}: payload schema is missing`);
    sameSet(Object.keys(payload), allowedPayloadSchemaKeys, `${name} payload schema keywords`);
    assert(
      payload.type === "object" && payload.additionalProperties === false,
      `${name} payload must reject unknown fields`
    );
    assert(Array.isArray(payload.required), `${name} payload required fields must be explicit`);
    sameSet(payload.required, pinned.required, `${name} payload required fields`);
    for (const field of payload.required) {
      assert(Object.hasOwn(payload.properties ?? {}, field), `${name} payload required field ${field} is undefined`);
    }
    for (const [field, expected] of Object.entries(pinned.properties)) {
      assert(
        canonicalJson(payload.properties?.[field]) === canonicalJson(expected),
        `${name} payload ${field} schema must remain pinned`
      );
    }
  }
}

function checkEvents() {
  const schemaPath = join(root, "schemas/events/domain-event.schema.json");
  const eventSchema = loadAbsolute(schemaPath);
  verifyNoExtensions(eventSchema, "event schema");
  verifyEventEnvelope(eventSchema);
  const catalog = readJson("event-catalog.json");
  const examples = readJson("examples/domain-events.json");
  const schemaEvents = new Set(eventSchema.properties?.event_type?.enum ?? []);
  const conditions = payloadSchemas(eventSchema);
  const catalogEvents = new Set(catalog.events.map((event) => event.name));
  const exampleEvents = new Set(examples.map((event) => event.event_type));

  sameSet(schemaEvents, conditions.keys(), "Event schema conditions");
  sameSet(schemaEvents, catalogEvents, "Event catalog");
  sameSet(schemaEvents, exampleEvents, "Event examples");
  verifyEventCatalogShape(catalog);
  verifyPinnedEvents(eventSchema, conditions, catalog);
  assert(catalog.events.length === schemaEvents.size, "Event catalog contains duplicates");
  assert(examples.length === schemaEvents.size, "Event examples must contain exactly one sample per event");
  assert(catalog.execution_authority === false, "Events must not grant execution authority");
  assert(catalog.events.every((event) => event.current_version === 1), "Current event version must be 1");
  assert(new Set(examples.map((event) => event.event_id)).size === examples.length, "Event example IDs must be unique");

  for (const event of examples) {
    validateValue(event, eventSchema, eventSchema, event.event_type);
    const catalogEntry = catalog.events.find((entry) => entry.name === event.event_type);
    const condition = conditions.get(event.event_type);
    assert(event.aggregate_type === catalogEntry.aggregate_type, `${event.event_type}: catalog aggregate mismatch`);
    assert(event.aggregate_type === condition.aggregateType, `${event.event_type}: schema aggregate mismatch`);
    assert(
      event.data_classification === catalogEntry.data_classification,
      `${event.event_type}: classification mismatch`
    );
    validateValue(
      event.payload,
      resolvePointer(eventSchema, condition.payloadRef, event.event_type),
      eventSchema,
      `${event.event_type}.payload`
    );
  }

  const withdrawalApproved = examples.find((event) => event.event_type === "WithdrawalApproved");
  const custodyIntent = examples.find((event) => event.event_type === "CustodyIntentPrepared");
  const withdrawalBroadcast = examples.find((event) => event.event_type === "WithdrawalBroadcast");
  const custodyCatalog = catalog.events.find((event) => event.name === "CustodyIntentPrepared");
  const custodySchema = eventSchema.$defs.custodyIntentPrepared;

  assert(custodyCatalog.owner === "custody-orchestrator", "Custody intent owner must remain custody-orchestrator");
  assert(
    custodyCatalog.data_classification === "highly-confidential",
    "Custody intent classification must remain highly-confidential"
  );
  assert(
    custodySchema.properties.execution_authority.const === false,
    "Custody intent schema must prohibit execution authority"
  );
  assert(
    custodySchema.properties.production_signing_enabled.const === false,
    "Custody intent schema must prohibit production signing"
  );
  assert(
    custodySchema.properties.status.const === "unsigned_intent_ready",
    "Custody intent schema must remain unsigned"
  );
  assert(
    custodySchema.properties.network.pattern === "^[A-Z0-9]+_TESTNET$",
    "Custody intent schema must remain testnet-only"
  );
  assert(custodyIntent.actor.type === "service", "Custody intent must be produced by a service actor");
  assert(custodyIntent.payload.network.endsWith("_TESTNET"), "Custody intent must remain testnet-only");
  assert(custodyIntent.payload.execution_authority === false, "Custody intent must not grant execution authority");
  assert(
    custodyIntent.payload.production_signing_enabled === false,
    "Custody intent must not enable production signing"
  );
  assert(
    custodyIntent.payload.status === "unsigned_intent_ready",
    "Custody intent must remain unsigned"
  );
  assert(
    custodyIntent.causation_id === withdrawalApproved.event_id,
    "Custody intent must be caused by withdrawal approval evidence"
  );
  assert(
    withdrawalBroadcast.causation_id === custodyIntent.event_id,
    "Withdrawal broadcast example must follow the prepared custody intent"
  );
  assert(
    custodyIntent.aggregate_id === withdrawalApproved.aggregate_id
      && custodyIntent.aggregate_id === withdrawalBroadcast.aggregate_id,
    "Custody intent must preserve the withdrawal aggregate"
  );
  assert(
    custodyIntent.correlation_id === withdrawalApproved.correlation_id
      && custodyIntent.correlation_id === withdrawalBroadcast.correlation_id,
    "Custody intent must preserve withdrawal correlation"
  );
  assert(
    Date.parse(custodyIntent.payload.expires_at) > Date.parse(custodyIntent.occurred_at),
    "Custody intent expiry must follow preparation time"
  );

  verifyReferences(eventSchema, schemaPath);
  verifyMoneyFieldSchemas(eventSchema, "event schema");
  // PII names keep their dedicated rejection before the broader safe-field scan.
  verifyNoPiiPropertyNames(eventSchema, "event schema");
  verifySafeFields(eventSchema, "event schema");
  verifySafeFields(examples, "event examples");
  verifyNoNestedSchemaIdentifiers(eventSchema, "event schema");
  verifyClosedEventSchemas(eventSchema);
}

checkOpenApi();
checkErrorSchema();
checkEvents();
checkCompatibilityPolicy();

console.log("API and event contracts are structurally consistent and remain contract-only.");
