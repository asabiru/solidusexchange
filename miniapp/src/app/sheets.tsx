import { useEffect, useId, useRef, useState } from "react";
import type {
  AddressScreeningStatus,
  AddressScreeningView,
  DeviceSessionView,
  DeviceSessionsView,
  KycVerificationView,
  NotificationDraft,
  NotificationTemplate,
  NotificationsView,
  OperationDetail,
  ProfileView,
  WalletView
} from "../shared/api";
import { screeningTargets } from "../shared/address-screening";
import type { ScreeningNetwork } from "../shared/address-screening";
import type { AssetCode } from "../shared/assets";
import { ApiError, api } from "./api";
import { ChecksSheet } from "./ChecksSheet";
import { assetNameKey, assetNetworkKey } from "./format";
import { type MessageKey, messageKeyFor } from "./i18n";
import { useI18n } from "./i18n-context";
import {
  loadSeenIds,
  notificationSeenStorage,
  rememberSeenIds,
  unseenNotifications
} from "./notification-seen";
import { Icon } from "./Icon";
import type { SheetRequest } from "./navigation";
import {
  arrayOf,
  kycDecisionStepOf,
  kycOutcomeOf,
  kycStateOf,
  screeningBadgeOf,
  screeningNetworkKeyOf,
  sessionClientKeyOf,
  timelineStepState
} from "./server-fields";
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
    case "sessions":
      return <SessionsSheet close={close} />;
    case "support":
      return <SupportSheet close={close} />;
    case "operation":
      return <OperationSheet id={sheet.id} close={close} />;
    case "qr-manual":
      return <QrManualSheet close={close} />;
    case "address-screening":
      return <AddressScreeningSheet close={close} />;
    case "checks":
      return <ChecksSheet close={close} />;
    case "check":
      return <ChecksSheet close={close} initial={sheet.reference} />;
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
  const nameKey = assetNameKey(asset);
  const networkKey = assetNetworkKey(asset);
  return (
    <Sheet title={nameKey ? t(nameKey) : asset} onClose={close}>
      <div className="sheet__summary">
        <span className="sheet__eyebrow">{t("asset.availableBalance")}</span>
        <span className="sheet__amount num">{money(asset, balance.available, true)}</span>
        <span className="sheet__summary-meta">
          <span>{networkKey ? t(networkKey) : "—"}</span>
          <span className="sheet__status num">{t("asset.holdSuffix", { amount: money(asset, balance.hold) })}</span>
        </span>
      </div>
      <dl className="meta-list">
        <div><dt>{t("common.available")}</dt><dd className="num">{money(asset, balance.available, true)}</dd></div>
        <div><dt>{t("common.hold")}</dt><dd className="num">{money(asset, balance.hold, true)}</dd></div>
        <div><dt>{t("asset.estimate")}</dt><dd className="num">≈ {money("RUB", balance.valueRub)}</dd></div>
        <div><dt>{t("common.network")}</dt><dd>{networkKey ? t(networkKey) : "—"}</dd></div>
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

function kycSteps(rawState: string): (KycText & { state: StepState })[] {
  const state = kycStateOf(rawState);
  const started = state !== "not_started" && state !== "unavailable";
  const reviewing = state === "in_review";
  return [
    { title: "kyc.stepSubmittedTitle", detail: "kyc.stepSubmittedDetail", state: started ? "done" : "pending" },
    {
      title: "kyc.stepReviewTitle",
      detail: "kyc.stepReviewDetail",
      state: reviewing ? "current" : started && state !== "submitted" ? "done" : "pending"
    },
    kycDecisionStepOf(state) ?? { title: "kyc.stepDecisionTitle", detail: "kyc.stepDecisionDetail", state: "pending" }
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

  const outcome = kycOutcomeOf(state ?? "not_started");
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
          <li key={`${step.title}:${index}`} className={`timeline__step is-${step.state}`}>
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
        <span className="sheet__eyebrow">{profile.kyc?.level ?? "—"}</span>
        <span className="sheet__amount">{t("kyc.identityConfirmed")}</span>
        <span className="sheet__summary-meta">{profile.kyc?.detail ?? "—"}</span>
      </div>
      <ol className="timeline">
        {arrayOf<NonNullable<ProfileView["kyc"]>["steps"][number]>(profile.kyc?.steps).map((step, index) => (
          <li key={`${step.title}:${index}`} className={`timeline__step is-${step.state === "done" ? "done" : "pending"}`}>
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
          <span>{profile.limits?.message ?? "—"}</span>
          <span className="pill pill--muted num">{t("limits.decision", { decision: profile.limits?.decision ?? "—" })}</span>
        </div>
      </div>
      <h3 className="section-label">{t("limits.fees")}</h3>
      <dl className="meta-list">
        {arrayOf<ProfileView["fees"][number]>(profile.fees).map((fee, index) => (
          <div key={`${fee.title}:${index}`}><dt>{fee.title}</dt><dd>{fee.value}</dd></div>
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
        {arrayOf<ProfileView["security"][number]>(profile.security).map((item, index) => (
          <div key={`${item.title}:${index}`} className="row">
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
  const [primary, secondary] = arrayOf<OperationDetail["legs"][number]>(detail.legs);
  if (!primary) {
    return (
      <Sheet title={detail.title} onClose={close}>
        <p className="sheet__note">{t("operation.loadFailed")}</p>
      </Sheet>
    );
  }
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
        {arrayOf<OperationDetail["timeline"][number]>(detail.timeline).map((step, index) => {
          const state = timelineStepState(step.state);
          return (
            <li key={`${step.title}:${index}`} className={`timeline__step is-${state}`}>
              <span className="timeline__mark">
                <Icon name={state === "done" ? "check" : state === "blocked" ? "alert" : "clock"} size="xs" />
            </span>
              <span>
                <strong>{step.title}</strong>
                <span>{step.detail}{step.at ? ` · ${format.dateTime(step.at)}` : ""}</span>
              </span>
            </li>
          );
        })}
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
  // The result status is server-supplied: only declared members resolve to a badge.
  const badge = status ? screeningBadgeOf(status) : undefined;

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
        <span>{t("screening.addressLabel", { network: target ? t(screeningNetworkKeyOf(target.network) ?? "network.TON_TESTNET") : "" })}</span>
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

type SessionRevocation = { scope: "single"; session: DeviceSessionView } | { scope: "others"; count: number };

function SessionsSheet({ close }: { close: () => void }) {
  const [view, setView] = useState<DeviceSessionsView | undefined>();
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<SessionRevocation | undefined>();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<MessageKey | undefined>();
  const opener = useRef<HTMLElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const confirmId = useId();
  const { t, format } = useI18n();
  const when = (at: number) => format.epochMs(at);

  useEffect(() => {
    let active = true;
    api.sessions()
      .then((next) => { if (active) setView(next); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (pending) cancelButton.current?.focus();
  }, [pending]);

  const ask = (next: SessionRevocation) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOutcome(undefined);
    setPending(next);
  };

  const cancel = () => {
    setPending(undefined);
    if (opener.current?.isConnected) opener.current.focus();
  };

  const confirm = async (target: SessionRevocation) => {
    setBusy(true);
    try {
      setView(target.scope === "single" ? await api.revokeSession(target.session.handle) : await api.revokeOtherSessions());
      setOutcome(target.scope === "single" ? "sessions.revokedOne" : "sessions.revokedOthers");
    } catch (error) {
      const ended = error instanceof ApiError && error.status === 404;
      setOutcome(ended ? "sessions.alreadyEnded" : "sessions.revokeFailed");
      if (ended) setView(await api.sessions().catch(() => view));
    } finally {
      setBusy(false);
      setPending(undefined);
      status.current?.focus();
    }
  };

  const sessions = arrayOf<DeviceSessionView>(view?.sessions);
  const others = sessions.filter((session) => !session.current).length;
  const clientOf = (session: DeviceSessionView) => {
    const key = sessionClientKeyOf(session.client);
    return key ? t(key) : session.client;
  };

  return (
    <Sheet title={t("sessions.title")} onClose={close}>
      <p className="sheet__note">{t("sessions.note")}</p>
      {failed ? <p className="form-error" role="alert">{t("sessions.loadFailed")}</p> : null}
      {view === undefined && !failed ? <p className="sheet__note">{t("common.loading")}</p> : null}
      {view ? (
        <ul className="list sessions" aria-label={t("sessions.listLabel")}>
          {sessions.map((session, index) => (
            <li key={`${session.handle}:${index}`} className="row">
              <span className="coin coin--menu" aria-hidden="true"><Icon name="device" size="sm" /></span>
              <span className="row__main">
                <strong>{clientOf(session)}</strong>
                <span className="num">{t("sessions.meta", { created: when(session.createdAt), seen: when(session.lastSeenAt) })}</span>
                {session.current ? <span className="pill pill--success">{t("sessions.current")}</span> : null}
              </span>
              {session.current ? null : (
                <button
                  type="button"
                  className="row-action"
                  aria-label={t("sessions.signOutLabel", { client: clientOf(session), created: when(session.createdAt) })}
                  disabled={busy}
                  onClick={() => ask({ scope: "single", session })}
                >
                  {t("sessions.signOut")}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {pending ? (
        <div className="confirm-panel">
          <p id={confirmId}>
            {pending.scope === "single"
              ? t("sessions.confirmOne", { client: clientOf(pending.session), created: when(pending.session.createdAt) })
              : t("sessions.confirmOthers", { count: String(pending.count) })}
          </p>
          <div className="sheet__actions sheet__actions--split">
            <button type="button" className="cta cta--danger" aria-describedby={confirmId} disabled={busy} onClick={() => confirm(pending)}>{t("sessions.confirmSignOut")}</button>
            <button ref={cancelButton} type="button" className="cta cta--secondary" disabled={busy} onClick={cancel}>{t("common.cancel")}</button>
          </div>
        </div>
      ) : null}
      {view && others > 0 && !pending ? (
        <div className="sheet__actions">
          <button type="button" className="cta cta--secondary" disabled={busy} onClick={() => ask({ scope: "others", count: others })}>
            {t("sessions.signOutOthers")}
          </button>
        </div>
      ) : null}
      {view && others === 0 ? <p className="sheet__note">{t("sessions.noOthers")}</p> : null}
      <p ref={status} tabIndex={-1} className="sheet__note" aria-live="polite" aria-atomic="true">{outcome ? t(outcome) : null}</p>
      <button type="button" className="cta cta--ghost" onClick={close}>{t("common.close")}</button>
    </Sheet>
  );
}

const notificationTemplateKeys: Readonly<Record<NotificationTemplate, { title: MessageKey; body: MessageKey }>> = {
  session_login: { title: "notifications.template.sessionLogin.title", body: "notifications.template.sessionLogin.body" },
  kyc_submitted: { title: "notifications.template.kycSubmitted.title", body: "notifications.template.kycSubmitted.body" },
  kyc_in_review: { title: "notifications.template.kycInReview.title", body: "notifications.template.kycInReview.body" },
  kyc_approved: { title: "notifications.template.kycApproved.title", body: "notifications.template.kycApproved.body" },
  kyc_rejected: { title: "notifications.template.kycRejected.title", body: "notifications.template.kycRejected.body" },
  kyc_needs_more_data: { title: "notifications.template.kycNeedsMoreData.title", body: "notifications.template.kycNeedsMoreData.body" },
  kyc_timed_out: { title: "notifications.template.kycTimedOut.title", body: "notifications.template.kycTimedOut.body" },
  kyc_unavailable: { title: "notifications.template.kycUnavailable.title", body: "notifications.template.kycUnavailable.body" },
  support_received: { title: "notifications.template.supportReceived.title", body: "notifications.template.supportReceived.body" },
  complaint_received: { title: "notifications.template.complaintReceived.title", body: "notifications.template.complaintReceived.body" }
};

function NotificationsSheet({ close, onRead }: { close: () => void; onRead: (view: NotificationsView) => void }) {
  const [drafts, setDrafts] = useState<readonly NotificationDraft[] | undefined>();
  const [seenAtOpen, setSeenAtOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState(false);
  const { t, format } = useI18n();
  useEffect(() => {
    let active = true;
    async function load() {
      const view = await api.notifications();
      if (!active) return;
      const storage = notificationSeenStorage();
      setSeenAtOpen(loadSeenIds(storage));
      const notifications = arrayOf<NotificationDraft>(view.notifications);
      setDrafts(notifications);
      // Seen state is a cosmetic per-browser marker kept in web storage.
      const seen = rememberSeenIds(storage, notifications.map((draft) => draft.id));
      if (active) onRead({ ...view, notifications, unread: unseenNotifications({ ...view, notifications }, seen) });
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
          {drafts.map((draft, index) => {
            const copy = Object.hasOwn(notificationTemplateKeys, draft.template)
              ? notificationTemplateKeys[draft.template]
              : undefined;
            const unseen = !draft.read && !seenAtOpen.has(draft.id);
            return (
              <li key={`${draft.id}:${index}`} className={`row row--static${unseen ? " is-unread" : " is-seen"}`}>
                <span className="coin coin--menu" aria-hidden="true"><Icon name="bell" size="sm" /></span>
                <span className="row__main">
                  <strong>{copy ? t(copy.title) : draft.text}</strong>
                  {copy ? <span>{t(copy.body)}</span> : null}
                  <span className="num">{t("notifications.draftMeta", { when: format.epochMs(draft.createdAt) })}</span>
                </span>
                {unseen ? <span className="unread-dot"><span className="visually-hidden">{t("notifications.new")}</span></span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="sheet__note">{t("notifications.note")}</p>
      <button type="button" className="cta cta--ghost" onClick={close}>{t("common.close")}</button>
    </Sheet>
  );
}
