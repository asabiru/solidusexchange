import type { DocumentKind, DocumentView } from "../shared/api";
import { boundedRows, hasExactKeys, isEpochMs, isRecord, type ServedRows } from "./served-views";

const documentIdPattern = /^doc_[0-9a-f]{24}$/;
const documentKinds = new Set<DocumentKind>(["agreement", "statement", "check"]);
const documentStatuses = new Set(["available", "draft"]);

const documentViewKeys = ["id", "kind", "title", "status", "createdAt", "posting"] as const;

function isDocumentRow(value: unknown): value is DocumentView {
  return (
    isRecord(value)
    && hasExactKeys(value, documentViewKeys)
    && typeof value.id === "string"
    && documentIdPattern.test(value.id)
    && typeof value.kind === "string"
    && documentKinds.has(value.kind as DocumentKind)
    && typeof value.title === "string"
    && value.title.trim().length > 0
    && typeof value.status === "string"
    && documentStatuses.has(value.status)
    && isEpochMs(value.createdAt)
    && value.posting === "none"
  );
}

/** Validates the served documents view (exact keys, doc_* ids, pinned flags). */
export function documentsViewOf(view: unknown): ServedRows<DocumentView> | undefined {
  if (
    !isRecord(view)
    || !hasExactKeys(view, ["mode", "delivery", "documents"])
    || view.mode !== "test"
    || view.delivery !== "disabled"
    || !Array.isArray(view.documents)
    || !(view.documents as readonly unknown[]).every(isDocumentRow)
  ) {
    return undefined;
  }
  return boundedRows(view.documents as readonly DocumentView[]);
}
