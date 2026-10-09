export type SupportCategory = "question" | "operation_problem" | "complaint" | "data_request";
export type SupportStatus = "received" | "in_review" | "answered" | "closed";

export const supportCategories: readonly SupportCategory[] = Object.freeze([
  "question",
  "operation_problem",
  "complaint",
  "data_request"
]);
export const supportStatuses: readonly SupportStatus[] = Object.freeze([
  "received",
  "in_review",
  "answered",
  "closed"
]);

export const maxSupportTopicLength = 120;
export const maxSupportMessageLength = 1_000;

const topicForbidden = /[\p{Cc}\p{Cs}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const messageForbidden = /[\p{Cs}\u2028\u2029\u202a-\u202e\u2066-\u2069]|(?!\n)\p{Cc}/u;

export function isSupportCategory(value: unknown): value is SupportCategory {
  return typeof value === "string" && (supportCategories as readonly string[]).includes(value);
}

export function isSupportStatus(value: unknown): value is SupportStatus {
  return typeof value === "string" && (supportStatuses as readonly string[]).includes(value);
}

/** Plain single-line text: no control, bidi-override or unpaired surrogate characters. */
export function isValidSupportTopic(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxSupportTopicLength && !topicForbidden.test(trimmed);
}

/** Plain text where only line feeds are allowed as control characters. */
export function isValidSupportMessage(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxSupportMessageLength && !messageForbidden.test(trimmed);
}
