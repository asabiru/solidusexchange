import type { DocumentsView } from "../shared/api.js";

export const documentIdPattern = /^doc_[0-9a-f]{24}$/;

const documents: DocumentsView = Object.freeze({
  mode: "test",
  delivery: "disabled",
  documents: Object.freeze([
    Object.freeze({
      id: "doc_0f1e2d3c4b5a69788796a5b4",
      kind: "agreement" as const,
      title: "Пользовательское соглашение SOLID",
      status: "available" as const,
      createdAt: Date.parse("2026-09-01T09:00:00.000Z"),
      posting: "none" as const
    }),
    Object.freeze({
      id: "doc_a5b4c3d2e1f0099887766554",
      kind: "agreement" as const,
      title: "Политика конфиденциальности",
      status: "available" as const,
      createdAt: Date.parse("2026-09-01T09:00:00.000Z"),
      posting: "none" as const
    }),
    Object.freeze({
      id: "doc_102030405060708090a0b0c0",
      kind: "statement" as const,
      title: "Выписка по счёту · сентябрь 2026",
      status: "draft" as const,
      createdAt: Date.parse("2026-10-01T00:00:00.000Z"),
      posting: "none" as const
    }),
    Object.freeze({
      id: "doc_d0e0f0a0b0c0112233445566",
      kind: "check" as const,
      title: "Чек об оплате · демонстрационный",
      status: "draft" as const,
      createdAt: Date.parse("2026-10-05T12:30:00.000Z"),
      posting: "none" as const
    })
  ])
});

/**
 * The local synthetic documents view. No upstream contract endpoint exists
 * for documents, so every session — verified or gated — reads this fixture;
 * entries are observational only and no download or signature path is served.
 */
export function documentsView(): DocumentsView {
  return documents;
}
