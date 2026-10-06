import { useEffect, useId, useRef, useState } from "react";
import type {
  AddressScreeningStatus,
  AddressScreeningView,
  KycVerificationState,
  KycVerificationView,
  NotificationDraft,
  NotificationsView,
  OperationDetail,
  ProfileView,
  WalletView
} from "../shared/api";
import { type ScreeningNetwork, screeningTargets } from "../shared/address-screening";
import type { AssetCode } from "../shared/assets";
import { ApiError, api } from "./api";
import { assetNameKeys, assetNetworkKeys } from "./format";
import { type MessageKey, messageKeyFor } from "./i18n";
import { useI18n } from "./i18n-context";
import { Icon } from "./Icon";
import type { SheetRequest } from "./navigation";
import { SupportSheet } from "./SupportSheet";
import { Coin, DisabledCta, Sheet, StatusPill, Unavailable } from "./ui";

interface Props {
  sheet: SheetRequest;
  wallet: WalletView;
  profile: ProfileView;
  close: () => void;
  open: (sheet: SheetRequest) => void;
  onKycVerified: () => Promise<void>;
  onNotificationsRead: (view: NotificationsView) => void;
}

export function SheetHost({ sheet, wallet, profile, close, open, onKycVerified, onNotificationsRead }: Props) {
  const { t } = useI18n();
  switch (sheet.kind) {
    case "asset":
      return <AssetSheet asset={sheet.asset} wallet={wallet} close={close} open={open} />;
    case "deposit":
      return <MoneyFlowSheet mode="deposit" initial={sheet.asset} close={close} />;
    case "withdraw":
      return <MoneyFlowSheet mode="withdraw" initial={sheet.asset} close={close} />;
    case "kyc-required":
      return <KycOnboardingSheet close={close} onVerified={onKycVerified} />;
    case "kyc":
      return <KycSheet profile={profile} close={close} />;
    case "limits":
      return <LimitsSheet profile={profile} close={close} />;
    case "security":
      return <SecuritySheet profile={profile} close={close} />;
    case "support":
      return <SupportSheet close={close} />;
    case "operation":
      return <OperationSheet id={sheet.id} close={close} />;
    case "qr-manual":
      return <QrManualSheet close={close} />;
    case "address-screening":
      return <AddressScreeningSheet close={close} />;
    case "notifications":
      return <NotificationsSheet close={close} onRead={onNotificationsRead} />;
    case "qr-image":
      return (
        <Sheet title={t("qr.pickImage")} onClose={close}>
          <p className="sheet__note">{t("qr.imageNote")}</p>
          <Unavailable>{t("qr.unavailable")}</Unavailable>
        </Sheet>
      );
  }
}

function AssetSheet({ asset, wallet, close, open }: { asset: AssetCode; wallet: WalletView; close: () => void; open: (sheet: SheetRequest) => void }) {
  const balance = wallet.assets.find((entry) => entry.code === asset);
  const { t, format } = useI18n();
  const { money } = format;
  if (!balance) return null;
  const verified = wallet.kyc === "verified";
  return (
    <Sheet title={t(assetNameKeys[asset])} onClose={close}>
      <div className="sheet__summary">
        <span className="sheet__eyebrow">{t("asset.availableBalance")}</span>
        <span className="sheet__amount num">{money(asset, balance.available, true)}</span>
        <span className="sheet__summary-meta">
          <span>{t(assetNetworkKeys[asset])}</span>
          <span className="sheet__status num">{t("asset.holdSuffix", { amount: money(asset, balance.hold) })}</span>
        </span>
      </div>
      <dl className="meta-list">
        <div><dt>{t("common.available")}</dt><dd className="num">{money(asset, balance.available, true)}</dd></div>
        <div><dt>{t("common.hold")}</dt><dd className="num">{money(asset, balance.hold, true)}</dd></div>
        <div><dt>{t("asset.estimate")}</dt><dd className="num">≈ {money("RUB", balance.valueRub)}</dd></div>
        <div><dt>{t("common.network")}</dt><dd>{t(assetNetworkKeys[asset])}</dd></div>
      </dl>
      <p className="sheet__note">{t("asset.holdNote")}</p>
      <div className="sheet__actions sheet__actions--split">
        <button type="button" className="cta" onClick={() => open(verified ? { kind: "deposit", asset } : { kind: "kyc-required" })}>
          <Icon name="plus" size="sm" />{t("common.deposit")}
        </button>
        <button type="button" className="cta cta--secondary" onClick={() => open(verified ? { kind: "withdraw", asset } : { kind: "kyc-required" })}>
          <Icon name="up" size="sm" />{t("common.withdraw")}
        </button>
      </div>
    </Sheet>
  );
}

interface MoneyFlow {
  title: MessageKey;
  note: MessageKey;
  options: readonly { asset: AssetCode; title: MessageKey; detail: MessageKey }[];
  cta: MessageKey;
  unavailable: MessageKey;
}

const flows: Readonly<Record<"deposit" | "withdraw", MoneyFlow>> = {
  deposit: {
    title: "common.deposit",
    note: "deposit.note",
    options: [
      { asset: "RUB", title: "deposit.RUB.title", detail: "deposit.RUB.detail" },
      { asset: "USDT", title: "deposit.USDT.title", detail: "deposit.USDT.detail" },
      { asset: "TON", title: "deposit.TON.title", detail: "deposit.TON.detail" }
    ],
    cta: "deposit.cta",
    unavailable: "deposit.unavailable"
  },
  withdraw: {
    title: "withdraw.title",
    note: "withdraw.note",
    options: [
      { asset: "RUB", title: "withdraw.RUB.title", detail: "withdraw.RUB.detail" },
      { asset: "USDT", title: "withdraw.USDT.title", detail: "withdraw.USDT.detail" },
      { asset: "TON", title: "withdraw.TON.title", detail: "withdraw.TON.detail" }
    ],
    cta: "withdraw.cta",
    unavailable: "withdraw.unavailable"
  }
};

function MoneyFlowSheet({ mode, initial, close }: { mode: "deposit" | "withdraw"; initial?: AssetCode; close: () => void }) {
  const flow = flows[mode];
  const [selected, setSelected] = useState<AssetCode | undefined>(initial);
  const { t } = useI18n();
  return (
    <Sheet title={t(flow.title)} onClose={close}>
      <p className="sheet__note">{t(flow.note)}</p>
      <fieldset className="options" aria-label={t("flow.methodLabel")}>
        {flow.options.map((option) => (
          <button
            type="button"
            key={option.asset}
            className="option"
            aria-pressed={selected === option.asset}
            onClick={() => setSelected(option.asset)}
          >
            <Coin asset={option.asset} />
            <span className="row__main">
              <strong>{t(option.title)}</strong>
              <span>{t(option.detail)}</span>
            </span>
            {selected === option.asset ? <Icon name="check" size="sm" /> : null}
          </button>
        ))}
      </fieldset>
      {selected ? (
        <>
          <Unavailable>{t(flow.unavailable)}</Unavailable>
          <DisabledCta label={t(flow.cta)} />
        </>
      ) : null}
    </Sheet>
  );
}

type StepState = "done" | "current" | "pending" | "blocked";

interface KycText {
  title: MessageKey;
  detail: MessageKey;
}

const kycOutcomes: Readonly<Record<KycVerificationState, KycText>> = {
  not_started: { title: "kyc.notStartedTitle", detail: "kyc.notStartedDetail" },
  submitted: { title: "kyc.submittedTitle", detail: "kyc.submittedDetail" },
  in_review: { title: "kyc.inReviewTitle", detail: "kyc.inReviewDetail" },
  approved: { title: "kyc.approvedTitle", detail: "kyc.approvedDetail" },
  rejected: { title: "kyc.rejectedTitle", detail: "kyc.rejectedDetail" },
  needs_more_data: { title: "kyc.needsMoreDataTitle", detail: "kyc.needsMoreDataDetail" },
  timed_out: { title: "kyc.timedOutTitle", detail: "kyc.timedOutDetail" },
  unavailable: { title: "kyc.unavailableTitle", detail: "kyc.unavailableDetail" }
};

const decisionSteps: Readonly<Partial<Record<KycVerificationState, KycText & { state: StepState }>>> = {
  approved: { title: "kyc.stepApprovedTitle", detail: "kyc.stepApprovedDetail", state: "done" },
  rejected: { title: "kyc.stepRejectedTitle", detail: "kyc.stepRejectedDetail", state: "blocked" },
  needs_more_data: { title: "kyc.stepNeedsMoreDataTitle", detail: "kyc.stepNeedsMoreDataDetail", state: "blocked" },
  timed_out: { title: "kyc.stepTimedOutTitle", detail: "kyc.stepTimedOutDetail", state: "blocked" }
};

function kycSteps(state: KycVerificationState): (KycText & { state: StepState })[] {
  const started = state !== "not_started" && state !== "unavailable";
  const reviewing = state === "in_review";
  return [
    { title: "kyc.stepSubmittedTitle", detail: "kyc.stepSubmittedDetail", state: started ? "done" : "pending" },
    {
      title: "kyc.stepReviewTitle",
      detail: "kyc.stepReviewDetail",
      state: reviewing ? "current" : started && state !== "submitted" ? "done" : "pending"
    },
    decisionSteps[state] ?? { title: "kyc.stepDecisionTitle", detail: "kyc.stepDecisionDetail", state: "pending" }
  ];
}

function KycOnboardingSheet({ close, onVerified }: { close: () => void; onVerified: () => Promise<void> }) {
  const [view, setView] = useState<KycVerificationView | undefined>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const notified = useRef(false);
  const state = view?.state;
  const { t } = useI18n();

  useEffect(() => {
    let active = true;
    const load = () => api.kycStatus()
      .then((value) => { if (active) setView(value); })
      .catch(() => { if (active) setFailed(true); });
    if (state === undefined) void load();
    if (state !== "submitted" && state !== "in_review") return () => { active = false; };
    const timer = window.setInterval(load, 4_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [state]);

  useEffect(() => {
    if (view?.sessionKyc === "verified" && !notified.current) {
      notified.current = true;
      void onVerified();
    }
  }, [view, onVerified]);

  async function submit() {
    setBusy(true);
    setFailed(false);
    try {
      setView(await api.submitKyc());
    } catch (error) {
      if (error instanceof ApiError && error.code === "kyc_unavailable") setView(await api.kycStatus().catch(() => view));
      else setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const outcome = kycOutcomes[state ?? "not_started"];
  return (
    <Sheet title={t("kyc.title")} onClose={close}>
      <div className="sheet__summary" aria-live="polite" aria-atomic="true">
        <span className="sheet__eyebrow">{t("kyc.eyebrow")}</span>
        <span className="sheet__amount">{t(busy || !view ? "common.loading" : outcome.title)}</span>
        <span className="sheet__summary-meta">
          <span>{t(outcome.detail)}</span>
          <span className="pill pill--warning">{t("common.test")}</span>
        </span>
      </div>
      <ol className="timeline" aria-label={t("kyc.stepsLabel")}>
        {kycSteps(state ?? "not_started").map((step, index) => (
          <li key={step.title} className={`timeline__step is-${step.state}`}>
            <span className="timeline__mark num">
              {step.state === "done" ? <Icon name="check" size="xs" /> : step.state === "blocked" ? <Icon name="alert" size="xs" /> : index + 1}
            </span>
            <span><strong>{t(step.title)}</strong><span>{t(step.detail)}</span></span>
          </li>
        ))}
      </ol>
      <p className="sheet__note">{t("kyc.testNote")}</p>
      <p className="form-error" aria-live="polite">{failed ? t("common.serverUnreachable") : ""}</p>
      <div className="sheet__actions">
        {view?.canSubmit ? (
          <button type="button" className="cta" disabled={busy} onClick={submit}>
            <Icon name="id-card" size="sm" />
            {t(state === "unavailable" ? "kyc.retry" : "kyc.start")}
          </button>
        ) : null}
        <button type="button" className="cta cta--ghost" onClick={close}>{t(state === "approved" ? "common.done" : "common.close")}</button>
      </div>
    </Sheet>
  );
}

function KycSheet({ profile, close }: { profile: ProfileView; close: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet title={t("kyc.title")} onClose={close}>
      <div className="sheet__summary">
        <span className="sheet__eyebrow">{profile.kyc.level}</span>
        <span className="sheet__amount">{t("kyc.identityConfirmed")}</span>
        <span className="sheet__summary-meta">{profile.kyc.detail}</span>
      </div>
      <ol className="timeline">
        {profile.kyc.steps.map((step) => (
          <li key={step.title} className={`timeline__step is-${step.state === "done" ? "done" : "pending"}`}>
            <span className="timeline__mark"><Icon name={step.state === "done" ? "check" : "clock"} size="xs" /></span>
            <span><strong>{step.title}</strong><span>{step.detail}</span></span>
          </li>
        ))}
      </ol>
      <button type="button" className="cta cta--ghost" onClick={close}>{t("common.close")}</button>
    </Sheet>
  );
}

function LimitsSheet({ profile, close }: { profile: ProfileView; close: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet title={t("profile.limitsTitle")} onClose={close}>
      <div className="limits-state">
        <span className="limits-state__mark"><Icon name="sliders" size="sm" /></span>
        <div>
          <strong>{t("limits.notConfigured")}</strong>
          <span>{profile.limits.message}</span>
          <span className="pill pill--muted num">{t("limits.decision", { decision: profile.limits.decision })}</span>
        </div>
      </div>
      <h3 className="section-label">{t("limits.fees")}</h3>
      <dl className="meta-list">
        {profile.fees.map((fee) => (
          <div key={fee.title}><dt>{fee.title}</dt><dd>{fee.value}</dd></div>
        ))}
      </dl>
      <button type="button" className="cta cta--ghost" onClick={close}>{t("common.close")}</button>
    </Sheet>
  );
}

function SecuritySheet({ profile, close }: { profile: ProfileView; close: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet title={t("security.title")} onClose={close}>
      <p className="sheet__note">{t("security.note")}</p>
      <div className="list">
        {profile.security.map((item) => (
          <div key={item.title} className="row row--static">
            <span className="coin coin--menu" aria-hidden="true"><Icon name="lock" size="sm" /></span>
            <span className="row__main"><strong>{item.title}</strong><span>{item.detail}</span></span>
            <span className="pill pill--muted">{t("common.soon")}</span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function OperationSheet({ id, close }: { id: string; close: () => void }) {
  const [detail, setDetail] = useState<OperationDetail | undefined>();
  const [failed, setFailed] = useState(false);
  const { t, format } = useI18n();
  const { money } = format;
  useEffect(() => {
    let active = true;
    api.operation(id)
      .then((value) => { if (active) setDetail(value); })
      .catch((error: unknown) => { if (active) setFailed(error instanceof ApiError || error instanceof Error); });
    return () => { active = false; };
  }, [id]);

  if (failed) {
    return <Sheet title={t("operation.title")} onClose={close}><p className="sheet__note">{t("operation.loadFailed")}</p></Sheet>;
  }
  if (!detail) {
    return <Sheet title={t("operation.title")} onClose={close}><p className="sheet__note">{t("common.loading")}</p></Sheet>;
  }
  const [primary, secondary] = detail.legs;
  return (
    <Sheet title={detail.title} onClose={close}>
      <div className="sheet__summary">
        <span className="sheet__eyebrow">{t(primary.direction === "in" ? "operation.received" : "operation.debited")}</span>
        <span className="sheet__amount num">{money(primary.asset, primary.amount)}</span>
        <span className="sheet__summary-meta">
          <span className="num">{detail.reference} · {format.dateTime(detail.createdAt)}</span>
          <StatusPill status={detail.status} />
        </span>
      </div>
      <dl className="meta-list">
        {secondary ? <div><dt>{t(secondary.direction === "out" ? "operation.debited" : "operation.received")}</dt><dd className="num">{money(secondary.asset, secondary.amount)}</dd></div> : null}
        {detail.fee ? <div><dt>{t("common.fee")}</dt><dd className="num">{money(detail.fee.asset, detail.fee.amount)}</dd></div> : null}
        {detail.rate ? <div><dt>{t("common.rate")}</dt><dd className="num">{format.rate(detail.rate)}</dd></div> : null}
        <div><dt>{t("operation.channel")}</dt><dd>{detail.channel}</dd></div>
      </dl>
      <h3 className="section-label">{t("operation.progress")}</h3>
      <ol className="timeline">
        {detail.timeline.map((step) => (
          <li key={step.title} className={`timeline__step is-${step.state}`}>
            <span className="timeline__mark">
              <Icon name={step.state === "done" ? "check" : step.state === "blocked" ? "alert" : "clock"} size="xs" />
            </span>
            <span>
              <strong>{step.title}</strong>
              <span>{step.detail}{step.at ? ` · ${format.dateTime(step.at)}` : ""}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="sheet__note">{detail.note}</p>
    </Sheet>
  );
}

function QrManualSheet({ close }: { close: () => void }) {
  const [code, setCode] = useState("");
  const [checked, setChecked] = useState(false);
  const inputId = useId();
  const { t } = useI18n();
  return (
    <Sheet title={t("qr.enterManually")} onClose={close}>
      <label className="form-control" htmlFor={inputId}>
        <span>{t("qr.codeLabel")}</span>
        <input
          id={inputId}
          value={code}
          autoComplete="off"
          onChange={(event) => {
            setCode(event.target.value);
            setChecked(false);
          }}
        />
      </label>
      <button type="button" className="cta cta--secondary" disabled={code.trim() === ""} onClick={() => setChecked(true)}>
        {t("qr.checkDetails")}
      </button>
      {checked ? (
        <Unavailable>{t("qr.manualUnavailable")}</Unavailable>
      ) : null}
    </Sheet>
  );
}

export const screeningBadges: Readonly<Record<AddressScreeningStatus, { label: MessageKey; tone: string; detail: MessageKey }>> = {
  pending: { label: "screening.pendingLabel", tone: "muted", detail: "screening.pendingDetail" },
  low: { label: "screening.lowLabel", tone: "success", detail: "screening.lowDetail" },
  medium: { label: "screening.mediumLabel", tone: "warning", detail: "screening.mediumDetail" },
  high: { label: "screening.highLabel", tone: "risk", detail: "screening.highDetail" },
  severe: { label: "screening.severeLabel", tone: "risk", detail: "screening.severeDetail" },
  unavailable: { label: "screening.unavailableLabel", tone: "muted", detail: "screening.unavailableDetail" },
  timed_out: { label: "screening.timedOutLabel", tone: "muted", detail: "screening.timedOutDetail" }
};

export const screeningNetworkKeys: Readonly<Record<ScreeningNetwork, MessageKey>> = {
  TON_TESTNET: "network.TON_TESTNET",
  TRON_TESTNET: "network.TRON_TESTNET"
};

const screeningPlaceholderKeys: Readonly<Record<ScreeningNetwork, MessageKey>> = {
  TON_TESTNET: "screening.placeholderTon",
  TRON_TESTNET: "screening.placeholderTron"
};

const screeningErrors: Readonly<Record<string, MessageKey>> = {
  invalid_address: "screening.errorInvalidAddress",
  invalid_target: "screening.errorInvalidTarget",
  kyc_required: "screening.errorKycRequired",
  screening_rate_limited: "screening.errorRateLimited"
};

function AddressScreeningSheet({ close }: { close: () => void }) {
  const [targetId, setTargetId] = useState(screeningTargets[0]?.id ?? "");
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<AddressScreeningView | undefined>();
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<MessageKey | undefined>();
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const errorId = useId();
  const { t } = useI18n();
  const target = screeningTargets.find((entry) => entry.id === targetId) ?? screeningTargets[0];
  const pendingId = result?.status === "pending" ? result.id : undefined;

  useEffect(() => {
    if (!pendingId) return;
    const timer = window.setInterval(() => {
      api.addressScreening(pendingId).then(setResult).catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [pendingId]);

  const reset = () => {
    setResult(undefined);
    setUnavailable(false);
    setError(undefined);
  };

  const check = () => {
    if (!target) return;
    reset();
    setBusy(true);
    api.screenAddress(target.asset, target.network, address.trim())
      .then(setResult)
      .catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.code === "screening_unavailable") {
          setUnavailable(true);
          return;
        }
        setError(reason instanceof ApiError ? messageKeyFor(screeningErrors, reason.code) ?? "screening.errorFailed" : "common.serverUnreachable");
      })
      .finally(() => setBusy(false));
  };

  const status: AddressScreeningStatus | undefined = unavailable ? "unavailable" : result?.status;
  const badge = status ? screeningBadges[status] : undefined;

  return (
    <Sheet title={t("screening.title")} onClose={close}>
      <p className="notice-banner">
        <Icon name="shield-check" size="sm" />
        {t("screening.banner")}
      </p>
      <p className="sheet__note">{t("screening.note")}</p>
      <fieldset className="segment" aria-label={t("screening.targetLabel")}>
        {screeningTargets.map((entry) => (
          <button
            type="button"
            key={entry.id}
            aria-pressed={entry.id === target?.id}
            onClick={() => {
              setTargetId(entry.id);
              reset();
            }}
          >
            {entry.label}
          </button>
        ))}
      </fieldset>
      <label className="form-control" htmlFor={inputId}>
        <span>{t("screening.addressLabel", { network: target ? t(screeningNetworkKeys[target.network]) : "" })}</span>
        <input
          id={inputId}
          value={address}
          placeholder={target ? t(screeningPlaceholderKeys[target.network]) : undefined}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={64}
          aria-invalid={error === "screening.errorInvalidAddress"}
          aria-describedby={errorId}
          onChange={(event) => {
            setAddress(event.target.value);
            reset();
          }}
        />
      </label>
      <button type="button" className="cta cta--secondary" disabled={busy || address.trim() === ""} onClick={check}>
        {t("screening.check")}
      </button>
      <p className="form-error" id={errorId} aria-live="polite">{error ? t(error) : ""}</p>
      <div aria-live="polite" aria-atomic="true">
        {busy ? <p className="sheet__note">{t("common.loading")}</p> : badge ? (
          <div className="screening-result">
            <span className={`pill pill--${badge.tone}`}>{t(badge.label)}</span>
            <span>{t(badge.detail)}</span>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function NotificationsSheet({ close, onRead }: { close: () => void; onRead: (view: NotificationsView) => void }) {
  const [drafts, setDrafts] = useState<readonly NotificationDraft[] | undefined>();
  const [failed, setFailed] = useState(false);
  const { t, format } = useI18n();
  useEffect(() => {
    let active = true;
    async function load() {
      const view = await api.notifications();
      if (!active) return;
      setDrafts(view.notifications);
      const unread = view.notifications.filter((draft) => !draft.read).map((draft) => draft.id);
      if (unread.length === 0) return;
      const marked = await api.markNotificationsRead(unread);
      if (active) {
        onRead({
          ...view,
          unread: marked.unread,
          notifications: view.notifications.map((draft) => ({ ...draft, read: true }))
        });
      }
    }
    load().catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [onRead]);

  return (
    <Sheet title={t("notifications.title")} onClose={close}>
      <div className="notice-banner">
        <Icon name="info" size="sm" />
        <span>{t("notifications.banner")}</span>
      </div>
      {failed ? <p className="form-error" role="alert">{t("notifications.loadFailed")}</p> : null}
      {drafts === undefined && !failed ? <p className="sheet__note">{t("common.loading")}</p> : null}
      {drafts?.length === 0 ? <p className="sheet__note">{t("notifications.empty")}</p> : null}
      {drafts && drafts.length > 0 ? (
        <ul className="list notifications" aria-label={t("notifications.listLabel")}>
          {drafts.map((draft) => (
            <li key={draft.id} className={`row row--static${draft.read ? "" : " is-unread"}`}>
              <span className="coin coin--menu" aria-hidden="true"><Icon name="bell" size="sm" /></span>
              <span className="row__main">
                <strong>{draft.text}</strong>
                <span className="num">{t("notifications.draftMeta", { when: format.dateTime(new Date(draft.createdAt).toISOString()) })}</span>
              </span>
              {draft.read ? null : <span className="unread-dot"><span className="visually-hidden">{t("notifications.new")}</span></span>}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="sheet__note">{t("notifications.note")}</p>
      <button type="button" className="cta cta--ghost" onClick={close}>{t("common.close")}</button>
    </Sheet>
  );
}
