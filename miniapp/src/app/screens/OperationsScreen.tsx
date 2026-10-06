import { useEffect, useMemo, useState } from "react";
import type { ActivityItem, ActivityKind, KycActivity, SessionSource } from "../../shared/api";
import { screeningTargetOf } from "../../shared/address-screening";
import { api } from "../api";
import type { MessageKey } from "../i18n";
import { useI18n } from "../i18n-context";
import { Icon, type IconName } from "../Icon";
import { screeningBadges, screeningNetworkKeys } from "../sheets";
import { EmptyState, ScreenTitle } from "../ui";

type ActivityGroup = "all" | "login" | "kyc" | "quote" | "screening";

const groupFilters: readonly { value: ActivityGroup; label: MessageKey }[] = [
  { value: "all", label: "activity.filterAll" },
  { value: "login", label: "activity.filterLogin" },
  { value: "kyc", label: "activity.filterKyc" },
  { value: "quote", label: "activity.filterQuote" },
  { value: "screening", label: "activity.filterScreening" }
];

const sourceLabels: Readonly<Record<SessionSource, MessageKey>> = {
  telegram: "activity.sourceTelegram",
  "dev-synthetic": "activity.sourceDev"
};

const kycTexts: Readonly<Record<KycActivity["kind"], { title: MessageKey; tone: string; icon: IconName }>> = {
  kyc_submitted: { title: "activity.kycSubmitted", tone: "warning", icon: "id-card" },
  kyc_in_review: { title: "activity.kycInReview", tone: "warning", icon: "clock" },
  kyc_approved: { title: "activity.kycApproved", tone: "success", icon: "shield-check" },
  kyc_rejected: { title: "activity.kycRejected", tone: "risk", icon: "close" },
  kyc_needs_more_data: { title: "activity.kycNeedsMoreData", tone: "risk", icon: "alert" },
  kyc_timed_out: { title: "activity.kycTimedOut", tone: "risk", icon: "clock" },
  kyc_unavailable: { title: "activity.kycUnavailable", tone: "risk", icon: "alert" }
};

function groupOf(kind: ActivityKind): Exclude<ActivityGroup, "all"> {
  if (kind === "session_login" || kind === "session_revoked") return "login";
  if (kind === "quote_previewed") return "quote";
  if (kind === "address_screened") return "screening";
  return "kyc";
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const { t, format } = useI18n();
  const when = (at: number) => format.dateTime(new Date(at).toISOString());
  if (item.kind === "session_login") {
    return (
      <li className="row">
        <span className="coin coin--menu" aria-hidden="true"><Icon name="user" size="sm" /></span>
        <span className="row__main">
          <strong>{t("activity.login")}</strong>
          <span className="num">{when(item.at)} · {t(sourceLabels[item.source])}</span>
        </span>
      </li>
    );
  }
  if (item.kind === "quote_previewed") {
    return (
      <li className="row">
        <span className="coin coin--menu" aria-hidden="true"><Icon name="swap" size="sm" /></span>
        <span className="row__main">
          <strong>{t("activity.quoteTitle", { from: item.from, to: item.to })}</strong>
          <span className="num">{when(item.at)} · {item.pair}</span>
          <span className="pill pill--muted">{t("activity.quoteOnly")}</span>
        </span>
        <span className="row__amount">
          <strong className="num">{format.money(item.from, item.amountIn)}</strong>
          <span className="num">≈ {format.money(item.to, item.amountOut)}</span>
        </span>
      </li>
    );
  }
  if (item.kind === "address_screened") {
    const badge = screeningBadges[item.status];
    const target = screeningTargetOf(item.asset, item.network);
    return (
      <li className="row">
        <span className="coin coin--menu" aria-hidden="true"><Icon name="shield" size="sm" /></span>
        <span className="row__main">
          <strong>{t("activity.screeningTitle", { target: target?.label ?? item.asset })}</strong>
          <span className="num">{when(item.at)} · {t(screeningNetworkKeys[item.network])}</span>
          <span className={`pill pill--${badge.tone}`}>{t(badge.label)}</span>
        </span>
      </li>
    );
  }
  if (item.kind === "session_revoked") {
    return (
      <li className="row">
        <span className="coin coin--menu" aria-hidden="true"><Icon name="device" size="sm" /></span>
        <span className="row__main">
          <strong>{item.scope === "single" ? t("activity.sessionRevokedOne") : t("activity.sessionRevokedOthers", { count: String(item.count) })}</strong>
          <span className="num">{when(item.at)}</span>
        </span>
      </li>
    );
  }
  const kyc = kycTexts[item.kind];
  return (
    <li className="row">
      <span className={`coin coin--status coin--${kyc.tone}`} aria-hidden="true"><Icon name={kyc.icon} size="sm" /></span>
      <span className="row__main">
        <strong>{t(kyc.title)}</strong>
        <span className="num">{when(item.at)} · {t("activity.kycSource")}</span>
      </span>
    </li>
  );
}

export function OperationsScreen() {
  const [items, setItems] = useState<readonly ActivityItem[] | undefined>();
  const [failed, setFailed] = useState(false);
  const [group, setGroup] = useState<ActivityGroup>("all");
  const { t } = useI18n();

  useEffect(() => {
    let active = true;
    api.activity()
      .then((view) => { if (active) setItems(view.items); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(
    () => (items ?? []).filter((item) => group === "all" || groupOf(item.kind) === group),
    [items, group]
  );

  return (
    <section className="screen" aria-label={t("tab.activity")}>
      <ScreenTitle>{t("tab.activity")}</ScreenTitle>
      <div className="notice-banner">
        <Icon name="info" size="sm" />
        <span>{t("activity.banner")}</span>
      </div>
      <fieldset className="filter-row" aria-label={t("activity.filterLabel")}>
        {groupFilters.map((filter) => (
          <button
            type="button"
            key={filter.value}
            className="filter"
            aria-pressed={group === filter.value}
            onClick={() => setGroup(filter.value)}
          >
            {t(filter.label)}
          </button>
        ))}
      </fieldset>
      <div className="filter-tools">
        <span className="filter-tools__count num" aria-live="polite">
          {failed ? t("activity.loadFailed") : items === undefined ? t("common.loading") : t("activity.found", { count: filtered.length })}
        </span>
      </div>

      {items?.length === 0 ? (
        <EmptyState title={t("activity.emptyTitle")}>{t("activity.emptyDetail")}</EmptyState>
      ) : items && filtered.length === 0 ? (
        <EmptyState
          title={t("activity.filterEmpty")}
          action={<button type="button" className="link" onClick={() => setGroup("all")}>{t("activity.resetFilter")}</button>}
        />
      ) : filtered.length > 0 ? (
        <ul className="list activity" aria-label={t("activity.listLabel")}>
          {filtered.map((item) => <ActivityRow key={item.id} item={item} />)}
        </ul>
      ) : null}
      <p className="note">{t("activity.note")}</p>
    </section>
  );
}
