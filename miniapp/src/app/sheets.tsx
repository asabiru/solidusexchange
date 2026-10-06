import { useEffect, useId, useRef, useState } from "react";
import type { KycVerificationState, KycVerificationView, OperationDetail, ProfileView, WalletView } from "../shared/api";
import { type AssetCode, assets } from "../shared/assets";
import { ApiError, api } from "./api";
import { dateTime, money, rate } from "./format";
import { Icon } from "./Icon";
import type { SheetRequest } from "./navigation";
import { Coin, DisabledCta, Sheet, StatusPill, Unavailable } from "./ui";

interface Props {
  sheet: SheetRequest;
  wallet: WalletView;
  profile: ProfileView;
  close: () => void;
  open: (sheet: SheetRequest) => void;
  onKycVerified: () => Promise<void>;
}

export function SheetHost({ sheet, wallet, profile, close, open, onKycVerified }: Props) {
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
      return (
        <Sheet title="Поддержка" onClose={close}>
          <p className="sheet__note">Чат поддержки и обращения будут подключены в следующих версиях.</p>
          <Unavailable>Обращения не отправляются: внешние сервисы в тестовой версии не подключены.</Unavailable>
        </Sheet>
      );
    case "operation":
      return <OperationSheet id={sheet.id} close={close} />;
    case "qr-manual":
      return <QrManualSheet close={close} />;
    case "qr-image":
      return (
        <Sheet title="Выбрать изображение" onClose={close}>
          <p className="sheet__note">Распознавание QR из галереи появится позже. Файлы не загружаются и не отправляются.</p>
          <Unavailable>Оплата по QR недоступна в тестовой версии.</Unavailable>
        </Sheet>
      );
  }
}

function AssetSheet({ asset, wallet, close, open }: { asset: AssetCode; wallet: WalletView; close: () => void; open: (sheet: SheetRequest) => void }) {
  const balance = wallet.assets.find((entry) => entry.code === asset);
  if (!balance) return null;
  const verified = wallet.kyc === "verified";
  return (
    <Sheet title={assets[asset].name} onClose={close}>
      <div className="sheet__summary">
        <span className="sheet__eyebrow">Доступный баланс</span>
        <span className="sheet__amount num">{money(asset, balance.available, true)}</span>
        <span className="sheet__summary-meta">
          <span>{assets[asset].network}</span>
          <span className="sheet__status num">{money(asset, balance.hold)} hold</span>
        </span>
      </div>
      <dl className="meta-list">
        <div><dt>Доступно</dt><dd className="num">{money(asset, balance.available, true)}</dd></div>
        <div><dt>Hold</dt><dd className="num">{money(asset, balance.hold, true)}</dd></div>
        <div><dt>Оценка</dt><dd className="num">≈ {money("RUB", balance.valueRub)}</dd></div>
        <div><dt>Сеть</dt><dd>{assets[asset].network}</dd></div>
      </dl>
      <p className="sheet__note">
        Hold — средства, зарезервированные под операции в обработке. Балансы синтетические.
      </p>
      <div className="sheet__actions sheet__actions--split">
        <button type="button" className="cta" onClick={() => open(verified ? { kind: "deposit", asset } : { kind: "kyc-required" })}>
          <Icon name="plus" size="sm" />Пополнить
        </button>
        <button type="button" className="cta cta--secondary" onClick={() => open(verified ? { kind: "withdraw", asset } : { kind: "kyc-required" })}>
          <Icon name="up" size="sm" />Вывести
        </button>
      </div>
    </Sheet>
  );
}

const flows = {
  deposit: {
    title: "Пополнить",
    note: "Сначала выберите актив. Доступные способы зависят от KYC, страны и лимитов.",
    options: [
      { asset: "RUB", title: "Российские рубли", detail: "Банковский перевод · только свои реквизиты" },
      { asset: "USDT", title: "USDT", detail: "TON · адрес и QR-код" },
      { asset: "TON", title: "TON", detail: "TON network · memo не требуется" }
    ],
    cta: "Получить реквизиты",
    unavailable: "Реквизиты, адреса и QR-коды не выдаются: банки и блокчейн-сети не подключены."
  },
  withdraw: {
    title: "Вывести средства",
    note: "Вывод проходит проверку лимитов и AML/KYT. До подтверждения вы увидите комиссию и ожидаемое время.",
    options: [
      { asset: "RUB", title: "На банковский счёт", detail: "Только свои реквизиты" },
      { asset: "USDT", title: "На криптоадрес · USDT", detail: "USDT TON · адрес из whitelist" },
      { asset: "TON", title: "На криптоадрес · TON", detail: "TON network · комиссия сети" }
    ],
    cta: "Продолжить",
    unavailable: "Вывод не исполняется: подписи, отправка в сеть и банковские платежи отключены."
  }
} as const;

function MoneyFlowSheet({ mode, initial, close }: { mode: "deposit" | "withdraw"; initial?: AssetCode; close: () => void }) {
  const flow = flows[mode];
  const [selected, setSelected] = useState<AssetCode | undefined>(initial);
  return (
    <Sheet title={flow.title} onClose={close}>
      <p className="sheet__note">{flow.note}</p>
      <fieldset className="options" aria-label="Способ">
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
              <strong>{option.title}</strong>
              <span>{option.detail}</span>
            </span>
            {selected === option.asset ? <Icon name="check" size="sm" /> : null}
          </button>
        ))}
      </fieldset>
      {selected ? (
        <>
          <Unavailable>{flow.unavailable}</Unavailable>
          <DisabledCta label={flow.cta} />
        </>
      ) : null}
    </Sheet>
  );
}

type StepState = "done" | "current" | "pending" | "blocked";

const kycOutcomes: Readonly<Record<KycVerificationState, { title: string; detail: string }>> = {
  not_started: { title: "Подтвердите личность", detail: "Проверка открывает обмен, пополнение и вывод." },
  submitted: { title: "Заявка отправлена", detail: "Ожидает начала проверки. Статус обновляется автоматически." },
  in_review: { title: "Заявка на проверке", detail: "Симулятор провайдера рассматривает заявку. Статус обновляется автоматически." },
  approved: { title: "Проверка пройдена", detail: "Решение пришло подписанным уведомлением. Обмен и кошелёк открыты." },
  rejected: { title: "Проверка отклонена", detail: "Так завершился тестовый сценарий. Обмен и вывод остаются закрыты." },
  needs_more_data: { title: "Нужны дополнительные данные", detail: "В тестовой версии документы не загружаются, поэтому продолжить нельзя." },
  timed_out: { title: "Проверка не завершилась вовремя", detail: "Решение не пришло до срока. Обмен и вывод остаются закрыты." },
  unavailable: { title: "Провайдер недоступен", detail: "Симулятор провайдера не ответил. Попробуйте ещё раз." }
};

const decisionSteps: Readonly<Partial<Record<KycVerificationState, { title: string; detail: string; state: StepState }>>> = {
  approved: { title: "Одобрено", detail: "Личность подтверждена в тестовом режиме", state: "done" },
  rejected: { title: "Отклонено", detail: "Тестовый сценарий отказа", state: "blocked" },
  needs_more_data: { title: "Нужны данные", detail: "Загрузка документов не поддерживается", state: "blocked" },
  timed_out: { title: "Нет решения", detail: "Срок проверки истёк", state: "blocked" }
};

function kycSteps(state: KycVerificationState): { title: string; detail: string; state: StepState }[] {
  const started = state !== "not_started" && state !== "unavailable";
  const reviewing = state === "in_review";
  return [
    { title: "Заявка отправлена", detail: "Синтетическая заявка без документов и личных данных", state: started ? "done" : "pending" },
    {
      title: "На проверке",
      detail: "Решение принимает симулятор KYC-провайдера",
      state: reviewing ? "current" : started && state !== "submitted" ? "done" : "pending"
    },
    decisionSteps[state] ?? { title: "Решение", detail: "Одобрено, отклонено или нужны данные", state: "pending" }
  ];
}

function KycOnboardingSheet({ close, onVerified }: { close: () => void; onVerified: () => Promise<void> }) {
  const [view, setView] = useState<KycVerificationView | undefined>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const notified = useRef(false);
  const state = view?.state;

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
    <Sheet title="Идентификация" onClose={close}>
      <div className="sheet__summary">
        <span className="sheet__eyebrow">Тестовый режим · симулятор KYC</span>
        <span className="sheet__amount">{outcome.title}</span>
        <span className="sheet__summary-meta">
          <span>{outcome.detail}</span>
          <span className="pill pill--warning">Тест</span>
        </span>
      </div>
      <ol className="timeline" aria-label="Шаги проверки (тест)">
        {kycSteps(state ?? "not_started").map((step, index) => (
          <li key={step.title} className={`timeline__step is-${step.state}`}>
            <span className="timeline__mark num">
              {step.state === "done" ? <Icon name="check" size="xs" /> : step.state === "blocked" ? <Icon name="alert" size="xs" /> : index + 1}
            </span>
            <span><strong>{step.title}</strong><span>{step.detail}</span></span>
          </li>
        ))}
      </ol>
      <p className="sheet__note">
        Тестовый режим: заявка синтетическая, документы и фото не загружаются, реальные провайдеры не подключены.
      </p>
      {failed ? <p className="form-error" role="alert">Не удалось связаться с тестовым сервером.</p> : null}
      <div className="sheet__actions">
        {view?.canSubmit ? (
          <button type="button" className="cta" disabled={busy} onClick={submit}>
            <Icon name="id-card" size="sm" />
            {state === "unavailable" ? "Повторить проверку (тест)" : "Пройти проверку (тест)"}
          </button>
        ) : null}
        <button type="button" className="cta cta--ghost" onClick={close}>{state === "approved" ? "Готово" : "Закрыть"}</button>
      </div>
    </Sheet>
  );
}

function KycSheet({ profile, close }: { profile: ProfileView; close: () => void }) {
  return (
    <Sheet title="Идентификация" onClose={close}>
      <div className="sheet__summary">
        <span className="sheet__eyebrow">{profile.kyc.level}</span>
        <span className="sheet__amount">Личность подтверждена</span>
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
      <button type="button" className="cta cta--ghost" onClick={close}>Закрыть</button>
    </Sheet>
  );
}

function LimitsSheet({ profile, close }: { profile: ProfileView; close: () => void }) {
  return (
    <Sheet title="Лимиты и комиссии" onClose={close}>
      <div className="limits-state">
        <span className="limits-state__mark"><Icon name="sliders" size="sm" /></span>
        <div>
          <strong>Лимиты не настроены</strong>
          <span>{profile.limits.message}</span>
          <span className="pill pill--muted num">Решение {profile.limits.decision} · Open</span>
        </div>
      </div>
      <span className="section-label">Комиссии</span>
      <dl className="meta-list">
        {profile.fees.map((fee) => (
          <div key={fee.title}><dt>{fee.title}</dt><dd>{fee.value}</dd></div>
        ))}
      </dl>
      <button type="button" className="cta cta--ghost" onClick={close}>Закрыть</button>
    </Sheet>
  );
}

function SecuritySheet({ profile, close }: { profile: ProfileView; close: () => void }) {
  return (
    <Sheet title="Центр безопасности" onClose={close}>
      <p className="sheet__note">
        Критические действия будут требовать повторного подтверждения. В тестовой версии настройки безопасности — заглушки.
      </p>
      <div className="list">
        {profile.security.map((item) => (
          <div key={item.title} className="row row--static">
            <span className="coin coin--menu" aria-hidden="true"><Icon name="lock" size="sm" /></span>
            <span className="row__main"><strong>{item.title}</strong><span>{item.detail}</span></span>
            <span className="pill pill--muted">Скоро</span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function OperationSheet({ id, close }: { id: string; close: () => void }) {
  const [detail, setDetail] = useState<OperationDetail | undefined>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    api.operation(id)
      .then((value) => { if (active) setDetail(value); })
      .catch((error: unknown) => { if (active) setFailed(error instanceof ApiError || error instanceof Error); });
    return () => { active = false; };
  }, [id]);

  if (failed) {
    return <Sheet title="Операция" onClose={close}><p className="sheet__note">Не удалось загрузить операцию.</p></Sheet>;
  }
  if (!detail) {
    return <Sheet title="Операция" onClose={close}><p className="sheet__note">Загружаем…</p></Sheet>;
  }
  const [primary, secondary] = detail.legs;
  return (
    <Sheet title={detail.title} onClose={close}>
      <div className="sheet__summary">
        <span className="sheet__eyebrow">{primary.direction === "in" ? "Получено" : "Списано"}</span>
        <span className="sheet__amount num">{money(primary.asset, primary.amount)}</span>
        <span className="sheet__summary-meta">
          <span className="num">{detail.reference} · {dateTime(detail.createdAt)}</span>
          <StatusPill status={detail.status} />
        </span>
      </div>
      <dl className="meta-list">
        {secondary ? <div><dt>{secondary.direction === "out" ? "Списано" : "Получено"}</dt><dd className="num">{money(secondary.asset, secondary.amount)}</dd></div> : null}
        {detail.fee ? <div><dt>Комиссия</dt><dd className="num">{money(detail.fee.asset, detail.fee.amount)}</dd></div> : null}
        {detail.rate ? <div><dt>Курс</dt><dd className="num">{rate(detail.rate)}</dd></div> : null}
        <div><dt>Канал</dt><dd>{detail.channel}</dd></div>
      </dl>
      <span className="section-label">Ход операции</span>
      <ol className="timeline">
        {detail.timeline.map((step) => (
          <li key={step.title} className={`timeline__step is-${step.state}`}>
            <span className="timeline__mark">
              <Icon name={step.state === "done" ? "check" : step.state === "blocked" ? "alert" : "clock"} size="xs" />
            </span>
            <span>
              <strong>{step.title}</strong>
              <span>{step.detail}{step.at ? ` · ${dateTime(step.at)}` : ""}</span>
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
  return (
    <Sheet title="Ввести вручную" onClose={close}>
      <label className="form-control" htmlFor={inputId}>
        <span>Ссылка или платёжный код</span>
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
        Проверить реквизиты
      </button>
      {checked ? (
        <Unavailable>Оплата по QR недоступна в тестовой версии. Код не проверяется и не отправляется на сервер.</Unavailable>
      ) : null}
    </Sheet>
  );
}
