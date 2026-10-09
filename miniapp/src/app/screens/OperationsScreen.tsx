import { useEffect, useMemo, useState } from "react";
import type { ActivityItem, ActivityKind } from "../../shared/api";
import { screeningTargetOf } from "../../shared/address-screening";
import { api } from "../api";
import type { MessageKey } from "../i18n";
import { useI18n } from "../i18n-context";
import { Icon } from "../Icon";
import {
  activitySourceKeyOf,
  arrayOf,
  kycActivityOf,
  screeningBadgeOf,
  screeningNetworkKeyOf,
  supportCategoryKeyOf
} from "../server-fields";
import { EmptyState, ScreenTitle } from "../ui";

type ActivityGroup = "all" | "login" | "kyc" | "quote" | "screening" | "support";

const groupFilters: readonly { value: ActivityGroup; label: MessageKey }[] = [
  { value: "all", label: "activity.filterAll" },
  { value: "login", label: "activity.filterLogin" },
  { value: "kyc", label: "activity.filterKyc" },
  { value: "quote", label: "activity.filterQuote" },
  { value: "screening", label: "activity.filterScreening" },
  { value: "support", label: "activity.filterSupport" }
];

function groupOf(kind: ActivityKind): Exclude<ActivityGroup, "all"> {
  if (kind === "session_login" || kind === "session_revoked") return "login";
  if (kind === "quote_previewed") return "quote";
  if (kind === "address_screened") return "screening";
  if (kind === "support_requested") return "support";
  return "kyc";
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const { t, format } = useI18n();
  const when = (at: number) => format.epochMs(at);
  if (item.kind === "session_login") {
    const source = activitySourceKeyOf(item.source);
    return (
      <li className="row">
        <span className="coin coin--menu" aria-hidden="true"><Icon name="user" size="sm" /></span>
        <span className="row__main">
          <strong>{t("activity.login")}</strong>
          <span className="num">{when(item.at)} · {source ? t(source) : item.source}</span>
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
    const badge = screeningBadgeOf(item.status);
    const target = screeningTargetOf(item.asset, item.network);
    const network = screeningNetworkKeyOf(item.network);
    return (
      <li className="row">
        <span className="coin coin--menu" aria-hidden="true"><Icon name="shield" size="sm" /></span>
        <span className="row__main">
          <strong>{t("activity.screeningTitle", { target: target?.label ?? item.asset })}</strong>
          <span className="num">{when(item.at)} · {network ? t(network) : item.network}</span>
          <span className={`pill pill--${badge?.tone ?? "muted"}`}>{badge ? t(badge.label) : item.status}</span>
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
  if (item.kind === "support_requested") {
    const category = supportCategoryKeyOf(item.category);
    return (
      <li className="row">
        <span className="coin coin--menu" aria-hidden="true"><Icon name="help" size="sm" /></span>
        <span className="row__main">
          <strong>{t("activity.supportTitle", { category: category ? t(category) : item.category })}</strong>
          <span className="num">{when(item.at)}</span>
          <span className="pill pill--muted">{t("activity.supportOnly")}</span>
        </span>
      </li>
    );
  }
  const kyc = kycActivityOf(item.kind);
  if (!kyc) {
    return (
      <li className="row">
        <span className="coin coin--menu" aria-hidden="true"><Icon name="info" size="sm" /></span>
        <span className="row__main">
          <strong>{item.kind}</strong>
          <span className="num">{when(item.at)}</span>
        </span>
      </li>
    );
  }
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
      .then((view) => { if (active) setItems(arrayOf(view.items)); })
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
          {filtered.map((item, index) => <ActivityRow key={`${item.id}:${index}`} item={item} />)}
        </ul>
      ) : null}
      <p className="note">{t("activity.note")}</p>
    </section>
  );
}
