import { type RefObject, useEffect, useRef, useState } from "react";
import type { DocumentView } from "../shared/api";
import { api } from "./api";
import { documentsViewOf } from "./documents";
import { useI18n } from "./i18n-context";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./ui";

const kindIcons: Readonly<Record<DocumentView["kind"], IconName>> = {
  agreement: "file",
  statement: "receipt",
  check: "bookmark-check"
};

export function DocumentsSheet({ close }: { close: () => void }) {
  const [view, setView] = useState<unknown>();
  const [listFailed, setListFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const { t, format } = useI18n();

  useEffect(() => {
    let active = true;
    api.documents()
      .then((next) => {
        if (active) {
          setView(next);
        }
      })
      .catch(() => {
        if (active) {
          setListFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const adapted = documentsViewOf(view);
  const documents = adapted?.rows ?? [];
  const failed = listFailed || (view !== undefined && adapted === undefined);

  return (
    <Sheet title={t("documents.title")} onClose={close}>
      <h3 className="section-label" ref={heading} tabIndex={-1}>
        {t("documents.listTitle")}
      </h3>
      {failed ? (
        <p className="form-error" role="alert">
          {t("documents.loadFailed")}
        </p>
      ) : null}
      {view === undefined && !failed ? <p className="sheet__note">{t("common.loading")}</p> : null}
      {adapted !== undefined && documents.length === 0 ? (
        <p className="sheet__note">{t("documents.empty")}</p>
      ) : null}
      {documents.length > 0 ? (
        <ul className="list" aria-label={t("documents.listLabel")}>
          {documents.map((document) => (
            <li key={document.id}>
              <span className="row row--static">
                <span className="coin coin--menu" aria-hidden="true"><Icon name={kindIcons[document.kind] ?? "file"} size="sm" /></span>
                <span className="row__main">
                  <strong>{document.title}</strong>
                  <span className="num">{format.epochMs(document.createdAt)}</span>
                </span>
                <span className={`pill pill--${document.status === "available" ? "ok" : "muted"}`}>
                  {t(document.status === "available" ? "documents.statusAvailable" : "documents.statusDraft")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {adapted !== undefined && adapted.total > documents.length ? (
        <p className="sheet__note">{t("common.truncated", { shown: documents.length, total: adapted.total })}</p>
      ) : null}
      <p className="sheet__note">{t("documents.note")}</p>
    </Sheet>
  );
}
