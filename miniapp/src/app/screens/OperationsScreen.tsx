import { useEffect, useMemo, useState } from "react";
import type { ActivityItem, ActivityKind, KycActivity, SessionSource } from "../../shared/api";
import { screeningTargetOf } from "../../shared/address-screening";
import { api } from "../api";
import { dateTime, money } from "../format";
import { Icon, type IconName } from "../Icon";
import { screeningBadges } from "../sheets";
import { EmptyState, ScreenTitle } from "../ui";

type ActivityGroup = "all" | "login" | "kyc" | "quote" | "screening";

const groupFilters: readonly { value: ActivityGroup; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "login", label: "Входы" },
  { value: "kyc", label: "Проверка личности" },
  { value: "quote", label: "Котировки" },
  { value: "screening", label: "Проверка адреса" }
];

const sourceLabels: Readonly<Record<SessionSource, string>> = {
  telegram: "Telegram",
  "dev-synthetic": "Тестовый вход"
};

const kycTexts: Readonly<Record<KycActivity["kind"], { title: string; tone: string; icon: IconName }>> = {
  kyc_submitted: { title: "Заявка на проверку личности принята", tone: "warning", icon: "id-card" },
  kyc_in_review: { title: "Заявка на проверку рассматривается", tone: "warning", icon: "clock" },
  kyc_approved: { title: "Проверка личности пройдена", tone: "success", icon: "shield-check" },
  kyc_rejected: { title: "Проверка личности не пройдена", tone: "risk", icon: "close" },
  kyc_needs_more_data: { title: "Нужны дополнительные данные", tone: "risk", icon: "alert" },
  kyc_timed_out: { title: "Срок рассмотрения заявки истёк", tone: "risk", icon: "clock" },
  kyc_unavailable: { title: "Сервис проверки временно недоступен", tone: "risk", icon: "alert" }
};

function groupOf(kind: ActivityKind): Exclude<ActivityGroup, "all"> {
  if (kind === "session_login") return "login";
  if (kind === "quote_previewed") return "quote";
  if (kind === "address_screened") return "screening";
  return "kyc";
}

function when(at: number): string {
  return dateTime(new Date(at).toISOString());
}

function ActivityRow({ item }: { item: ActivityItem }) {
  if (item.kind === "session_login") {
    return (
      <li className="row">
        <span className="coin coin--menu" aria-hidden="true"><Icon name="user" size="sm" /></span>
        <span className="row__main">
          <strong>Вход в SolidChange</strong>
          <span className="num">{when(item.at)} · {sourceLabels[item.source]}</span>
        </span>
      </li>
    );
  }
  if (item.kind === "quote_previewed") {
    return (
      <li className="row">
        <span className="coin coin--menu" aria-hidden="true"><Icon name="swap" size="sm" /></span>
        <span className="row__main">
          <strong>Расчёт обмена {item.from} → {item.to}</strong>
          <span className="num">{when(item.at)} · {item.pair}</span>
          <span className="pill pill--muted">Только расчёт</span>
        </span>
        <span className="row__amount">
          <strong className="num">{money(item.from, item.amountIn)}</strong>
          <span className="num">≈ {money(item.to, item.amountOut)}</span>
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
          <strong>Проверка адреса · {target?.label ?? item.asset}</strong>
          <span className="num">{when(item.at)} · {target?.networkLabel ?? item.network}</span>
          <span className={`pill pill--${badge.tone}`}>{badge.label}</span>
        </span>
      </li>
    );
  }
  const kyc = kycTexts[item.kind];
  return (
    <li className="row">
      <span className={`coin coin--status coin--${kyc.tone}`} aria-hidden="true"><Icon name={kyc.icon} size="sm" /></span>
      <span className="row__main">
        <strong>{kyc.title}</strong>
        <span className="num">{when(item.at)} · симулятор KYC</span>
      </span>
    </li>
  );
}

export function OperationsScreen() {
  const [items, setItems] = useState<readonly ActivityItem[] | undefined>();
  const [failed, setFailed] = useState(false);
  const [group, setGroup] = useState<ActivityGroup>("all");

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
    <section className="screen" aria-label="Операции">
      <ScreenTitle>Операции</ScreenTitle>
      <div className="notice-banner">
        <Icon name="info" size="sm" />
        <span>Тестовый режим — операции не выполняются</span>
      </div>
      <fieldset className="filter-row" aria-label="Тип события">
        {groupFilters.map((filter) => (
          <button
            type="button"
            key={filter.value}
            className="filter"
            aria-pressed={group === filter.value}
            onClick={() => setGroup(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </fieldset>
      <div className="filter-tools">
        <span className="filter-tools__count num" aria-live="polite">
          {items === undefined ? "Загружаем…" : `Найдено: ${filtered.length}`}
        </span>
      </div>

      {failed ? <p className="form-error" role="alert">Не удалось загрузить историю.</p> : null}
      {items?.length === 0 ? (
        <EmptyState title="Событий пока нет">
          Здесь появятся входы, этапы проверки личности, расчёты обмена и проверки адресов.
        </EmptyState>
      ) : items && filtered.length === 0 ? (
        <EmptyState
          title="По выбранному фильтру событий нет."
          action={<button type="button" className="link" onClick={() => setGroup("all")}>Сбросить фильтр</button>}
        />
      ) : filtered.length > 0 ? (
        <ul className="list activity" aria-label="История тестового режима">
          {filtered.map((item) => <ActivityRow key={item.id} item={item} />)}
        </ul>
      ) : null}
      <p className="note">
        История ведётся только на сервере и хранится в памяти. Расчёты обмена не исполняются, деньги не двигаются.
      </p>
    </section>
  );
}
