import { type ReactNode, useEffect, useId, useRef } from "react";
import type { OperationStatus, OperationSummary } from "../shared/api";
import { type AssetCode, assets } from "../shared/assets";
import { statusLabelKeys } from "./format";
import { useI18n } from "./i18n-context";
import { Icon, type IconName } from "./Icon";

export function Unavailable({ title, children }: { title?: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="unavailable" aria-live="polite">
      <span className="unavailable__mark">
        <Icon name="lock" size="sm" />
      </span>
      <div>
        <strong>{title ?? t("common.unavailable")}</strong>
        <span>{children}</span>
      </div>
    </div>
  );
}

export function DisabledCta({ label, hint }: { label: string; hint?: string }) {
  const hintId = useId();
  const { t } = useI18n();
  return (
    <div className="disabled-cta">
      <button type="button" className="cta" disabled aria-describedby={hintId}>
        <Icon name="lock" size="sm" />
        {label}
      </button>
      <span id={hintId} className="disabled-cta__hint">{hint ?? t("common.unavailable")}</span>
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useI18n();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="sheet__panel">
        <div className="sheet__grabber" />
        <header className="sheet__head">
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="icon-btn icon-btn--outlined" aria-label={t("common.close")} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

const statusIcons: Readonly<Record<OperationStatus, IconName>> = {
  completed: "check",
  "in-review": "clock",
  "needs-action": "alert",
  failed: "close"
};

const statusTones: Readonly<Record<OperationStatus, string>> = {
  completed: "success",
  "in-review": "warning",
  "needs-action": "risk",
  failed: "risk"
};

export function StatusPill({ status }: { status: OperationStatus }) {
  const { t } = useI18n();
  return <span className={`pill pill--${statusTones[status]}`}>{t(statusLabelKeys[status])}</span>;
}

export function Coin({ asset }: { asset: AssetCode }) {
  return <span className={`coin coin--${asset.toLowerCase()}`} aria-hidden="true">{assets[asset].symbol}</span>;
}

export function OperationRow({ operation, onOpen }: { operation: OperationSummary; onOpen: (id: string) => void }) {
  const [primary, secondary] = operation.legs;
  const { format } = useI18n();
  return (
    <button type="button" className="row" onClick={() => onOpen(operation.id)}>
      <span className={`coin coin--status coin--${statusTones[operation.status]}`} aria-hidden="true">
        <Icon name={statusIcons[operation.status]} size="sm" />
      </span>
      <span className="row__main">
        <strong>{operation.title}</strong>
        <span className="num">{format.dateTime(operation.createdAt)} · {operation.reference}</span>
        <StatusPill status={operation.status} />
      </span>
      <span className="row__amount">
        <strong className={`num${primary.direction === "in" ? " is-credit" : ""}`}>{format.signedLeg(primary)}</strong>
        <span className="num">{secondary ? format.signedLeg(secondary) : operation.channel}</span>
      </span>
    </button>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state__mark"><Icon name="receipt" /></span>
      <strong>{title}</strong>
      {children ? <span>{children}</span> : null}
      {action}
    </div>
  );
}

export function ScreenTitle({ children, detail }: { children: ReactNode; detail?: ReactNode }) {
  return (
    <div className="large-title">
      <h1>{children}</h1>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

export function Tick({ value, className }: { value: string; className?: string }) {
  return (
    <span className={className}>
      <span key={value} className="tick">{value}</span>
    </span>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="switch"
      aria-label={label}
      aria-checked={checked}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
