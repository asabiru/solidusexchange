import { type RefObject, useEffect, useId, useRef, useState } from "react";
import type { CheckPreview, CheckView } from "../shared/api";
import { type AssetCode, assets } from "../shared/assets";
import { isCheckReference } from "../shared/checks";
import { isDecimalString, toUnits } from "../shared/decimal";
import { ApiError, api } from "./api";
import { checkDirectionKey, checkStatusBadge } from "./checks-badges";
import { type MessageKey, messageKeyFor } from "./i18n";
import { useI18n } from "./i18n-context";
import { Icon } from "./Icon";
import { arrayOf } from "./server-fields";
import { Coin, DisabledCta, Sheet } from "./ui";

type CheckAsset = Exclude<AssetCode, "RUB">;
const checkAssets: readonly CheckAsset[] = Object.freeze(["USDT", "TON"]);

const previewErrors: Readonly<Record<string, MessageKey>> = {
  invalid_asset: "checks.errorInvalidAsset",
  invalid_amount: "checks.errorInvalidAmount"
};

const previewIdPattern = /^CHK-[0-9A-F]{12}$/;

type Mode = { kind: "compose" } | { kind: "detail"; reference: string };

export function ChecksSheet({ close, initial }: { close: () => void; initial?: string }) {
  const [checks, setChecks] = useState<readonly CheckView[] | undefined>();
  const [listFailed, setListFailed] = useState(false);
  const [mode, setMode] = useState<Mode>(() => (initial ? { kind: "detail", reference: initial } : { kind: "compose" }));
  const [asset, setAsset] = useState<CheckAsset>("USDT");
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<CheckPreview | undefined>();
  const [error, setError] = useState<MessageKey | undefined>();
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState("");
  const [refError, setRefError] = useState<MessageKey | undefined>();
  const [refBusy, setRefBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [switches, setSwitches] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const amountId = useId();
  const errorId = useId();
  const refId = useId();
  const refErrorId = useId();
  const { t, format } = useI18n();
  const { money } = format;

  useEffect(() => {
    let active = true;
    api.checks()
      .then((view) => { if (active) setChecks(arrayOf(view.checks)); })
      .catch(() => { if (active) setListFailed(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (switches > 0) heading.current?.focus();
  }, [switches]);

  const normalized = format.parseAmountInput(input);
  const valid = isDecimalString(normalized, assets[asset].scale) && toUnits(normalized, assets[asset].scale) > 0n;

  const show = (next: Mode) => {
    setSwitches((count) => count + 1);
    setAnnouncement(next.kind === "detail" ? t("checks.detailTitle") : "");
    setMode(next);
  };

  const reset = () => {
    setPreview(undefined);
    setError(undefined);
  };

  async function requestPreview() {
    if (!valid) {
      setError("checks.errorInvalidAmount");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const value = await api.checkPreview(asset, normalized);
      setPreview(previewIdPattern.test(value.id) && !value.executable ? value : undefined);
      if (!previewIdPattern.test(value.id)) setError("checks.errorFailed");
    } catch (caught) {
      setPreview(undefined);
      setError(caught instanceof ApiError ? messageKeyFor(previewErrors, caught.code) ?? "checks.errorFailed" : "common.serverUnreachable");
    } finally {
      setBusy(false);
    }
  }

  async function openReference() {
    const trimmed = reference.trim();
    if (!isCheckReference(trimmed)) {
      setRefError("checks.errorInvalidReference");
      return;
    }
    setRefBusy(true);
    setRefError(undefined);
    try {
      const check = await api.check(trimmed);
      if (check.reference === trimmed) show({ kind: "detail", reference: check.reference });
      else setRefError("checks.notFound");
    } catch (caught) {
      setRefError(caught instanceof ApiError && caught.status === 404 ? "checks.notFound" : "common.serverUnreachable");
    } finally {
      setRefBusy(false);
    }
  }

  return (
    <Sheet title={t("checks.title")} onClose={close}>
      <p className="notice-banner">
        <Icon name="info" size="sm" />
        {t("checks.banner")}
      </p>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>
      {mode.kind === "detail" ? (
        <CheckDetail reference={mode.reference} heading={heading} onBack={() => show({ kind: "compose" })} />
      ) : (
        <>
          <h3 className="section-label" ref={heading} tabIndex={-1}>{t("checks.composeTitle")}</h3>
          <fieldset className="segment" aria-label={t("checks.assetLabel")}>
            {checkAssets.map((code) => (
              <button
                type="button"
                key={code}
                aria-pressed={asset === code}
                onClick={() => {
                  setAsset(code);
                  reset();
                }}
              >
                {code}
              </button>
            ))}
          </fieldset>
          <label className="form-control" htmlFor={amountId}>
            <span>{t("checks.amountLabel")} · {asset}</span>
            <input
              id={amountId}
              className="num"
              inputMode="decimal"
              autoComplete="off"
              value={input}
              aria-invalid={(input !== "" && !valid) || error === "checks.errorInvalidAmount"}
              aria-describedby={errorId}
              onChange={(event) => {
                setInput(event.target.value);
                reset();
              }}
            />
          </label>
          <button type="button" className="cta cta--secondary" disabled={busy} onClick={requestPreview}>
            {t(busy ? "checks.requesting" : "checks.preview")}
          </button>
          <p className="form-error" id={errorId} aria-live="polite">
            {error ? t(error) : input !== "" && !valid ? t("checks.errorInvalidAmount") : ""}
          </p>
          {preview ? (
            <>
              <dl className="meta-list">
                <div><dt>{t("checks.amount")}</dt><dd className="num">{money(preview.asset, preview.amount)}</dd></div>
                <div><dt>{t("common.fee")}</dt><dd className="num">{money(preview.feeAsset, preview.fee)}</dd></div>
                <div><dt>{t("checks.total")}</dt><dd className="num">{money(preview.asset, preview.total)}</dd></div>
                <div><dt>{t("checks.claimRule")}</dt><dd>{t("checks.claimRulePersonal")}</dd></div>
                <div><dt>{t("checks.expires")}</dt><dd className="num">{format.epochMs(preview.expiresAt)} · {t("checks.ttl", { hours: preview.ttlSeconds / 3600 })}</dd></div>
              </dl>
              {preview.kycRequired ? <p className="sheet__note">{t("checks.kycRequired")}</p> : null}
              {preview.insufficientBalance ? <p className="form-error">{t("checks.insufficientBalance")}</p> : null}
              <DisabledCta label={t("checks.confirm")} hint={t("checks.confirmHint")} />
            </>
          ) : null}
          <p className="sheet__note">{t("checks.note")}</p>

          <h3 className="section-label">{t("checks.listTitle")}</h3>
          {listFailed ? <p className="form-error" role="alert">{t("checks.loadFailed")}</p> : null}
          {checks === undefined && !listFailed ? <p className="sheet__note">{t("common.loading")}</p> : null}
          {checks?.length === 0 ? <p className="sheet__note">{t("checks.empty")}</p> : null}
          {checks && checks.length > 0 ? (
            <ul className="list" aria-label={t("checks.listLabel")}>
              {checks.map((check, index) => {
                const badge = checkStatusBadge(check.status);
                const direction = checkDirectionKey(check.direction);
                return (
                  <li key={`${check.reference}:${index}`}>
                    <button type="button" className="row" onClick={() => show({ kind: "detail", reference: check.reference })}>
                      <Coin asset={check.asset} />
                      <span className="row__main">
                        <strong className="num">{money(check.asset, check.amount)}</strong>
                        <span className="num">{direction ? t(direction) : check.direction} · {format.epochMs(check.createdAt)}</span>
                      </span>
                      <span className={`pill pill--${badge?.tone ?? "muted"}`}>{badge ? t(badge.label) : check.status}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <h3 className="section-label">{t("checks.openByLink")}</h3>
          <label className="form-control" htmlFor={refId}>
            <span>{t("checks.referenceLabel")}</span>
            <input
              id={refId}
              value={reference}
              placeholder={t("checks.referencePlaceholder")}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={refError === "checks.errorInvalidReference"}
              aria-describedby={refErrorId}
              onChange={(event) => {
                setReference(event.target.value);
                setRefError(undefined);
              }}
            />
          </label>
          <button type="button" className="cta cta--secondary" disabled={refBusy || reference.trim() === ""} onClick={openReference}>
            {t("checks.open")}
          </button>
          <p className="form-error" id={refErrorId} aria-live="polite">{refError ? t(refError) : ""}</p>
        </>
      )}
    </Sheet>
  );
}

function CheckDetail({ reference, heading, onBack }: { reference: string; heading: RefObject<HTMLHeadingElement | null>; onBack: () => void }) {
  const [check, setCheck] = useState<CheckView | undefined>();
  const [failed, setFailed] = useState<MessageKey | undefined>();
  const { t, format } = useI18n();
  const { money } = format;

  useEffect(() => {
    let active = true;
    api.check(reference)
      .then((value) => { if (active) setCheck(value); })
      .catch((caught: unknown) => {
        if (active) setFailed(caught instanceof ApiError && caught.status === 404 ? "checks.notFound" : "common.serverUnreachable");
      });
    return () => { active = false; };
  }, [reference]);

  const badge = check ? checkStatusBadge(check.status) : undefined;
  const direction = check ? checkDirectionKey(check.direction) : undefined;
  return (
    <>
      <h3 className="section-label" ref={heading} tabIndex={-1}>{t("checks.detailTitle")}</h3>
      {failed ? <p className="sheet__note" role="alert">{t(failed)}</p> : null}
      {!check && !failed ? <p className="sheet__note">{t("common.loading")}</p> : null}
      {check ? (
        <>
          <div className="sheet__summary" aria-live="polite" aria-atomic="true">
            <span className="sheet__eyebrow">{direction ? t(direction) : check.direction}</span>
            <span className="sheet__amount num">{money(check.asset, check.amount)}</span>
            <span className="sheet__summary-meta">
              <span className="num">{format.epochMs(check.createdAt)}</span>
              <span className={`pill pill--${badge?.tone ?? "muted"}`}>{badge ? t(badge.label) : check.status}</span>
            </span>
          </div>
          <dl className="meta-list">
            <div><dt>{t("common.fee")}</dt><dd className="num">{money(check.asset, check.fee)}</dd></div>
            <div><dt>{t("checks.total")}</dt><dd className="num">{money(check.asset, check.total)}</dd></div>
            <div><dt>{t("checks.claimRule")}</dt><dd>{t("checks.claimRulePersonal")}</dd></div>
            <div><dt>{t("checks.created")}</dt><dd className="num">{format.epochMs(check.createdAt)}</dd></div>
            <div><dt>{t("checks.expires")}</dt><dd className="num">{format.epochMs(check.expiresAt)}</dd></div>
            {check.comment ? <div><dt>{t("checks.comment")}</dt><dd>{check.comment}</dd></div> : null}
            <div><dt>{t("checks.reference")}</dt><dd className="num">{check.reference}</dd></div>
          </dl>
          <p className="sheet__note">{t("checks.linkNote")}</p>
          <ol className="timeline" aria-label={t("checks.timelineLabel")}>
            {arrayOf<CheckView["timeline"][number]>(check.timeline).map((entry, index) => {
              const step = checkStatusBadge(entry.status);
              return (
                <li key={`${entry.status}:${index}`} className="timeline__step is-done">
                  <span className="timeline__mark"><Icon name="check" size="xs" /></span>
                  <span>
                    <strong>{step ? t(step.label) : entry.status}</strong>
                    <span className="num">{format.epochMs(entry.at)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          {check.status === "awaiting_recipient_kyc" ? <p className="sheet__note">{t("checks.kycWait")}</p> : null}
          {check.direction === "received" && (check.status === "created" || check.status === "awaiting_recipient_kyc") ? (
            <DisabledCta label={t("checks.claim")} hint={t("checks.claimHint")} />
          ) : null}
          {check.direction === "sent" && check.status === "created" ? (
            <DisabledCta label={t("checks.cancel")} hint={t("checks.cancelHint")} />
          ) : null}
        </>
      ) : null}
      <button type="button" className="cta cta--ghost" onClick={onBack}>{t("checks.back")}</button>
    </>
  );
}
