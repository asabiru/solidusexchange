import { useMemo, useState } from "react";
import type { OperationKind, OperationStatus, OperationSummary } from "../../shared/api";
import { type AssetCode, assetCodes } from "../../shared/assets";
import type { SheetRequest } from "../navigation";
import { EmptyState, OperationRow, ScreenTitle } from "../ui";
import { statusLabels } from "../format";

const kindFilters: readonly { value: OperationKind | "all"; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "exchange", label: "Обмен" },
  { value: "deposit", label: "Пополнение" },
  { value: "withdrawal", label: "Вывод" },
  { value: "qr", label: "QR" }
];

const statusFilters: readonly (OperationStatus | "all")[] = ["all", "completed", "in-review", "needs-action", "failed"];

export function OperationsScreen({
  operations,
  openSheet
}: {
  operations: readonly OperationSummary[];
  openSheet: (sheet: SheetRequest) => void;
}) {
  const [kind, setKind] = useState<OperationKind | "all">("all");
  const [status, setStatus] = useState<OperationStatus | "all">("all");
  const [asset, setAsset] = useState<AssetCode | "all">("all");

  const filtered = useMemo(() => operations.filter((operation) =>
    (kind === "all" || operation.kind === kind)
    && (status === "all" || operation.status === status)
    && (asset === "all" || operation.legs.some((leg) => leg.asset === asset))
  ), [operations, kind, status, asset]);

  const resetFilters = () => {
    setKind("all");
    setStatus("all");
    setAsset("all");
  };

  return (
    <section className="screen" aria-label="Операции">
      <ScreenTitle>Операции</ScreenTitle>
      <fieldset className="filter-row" aria-label="Тип операции">
        {kindFilters.map((filter) => (
          <button
            type="button"
            key={filter.value}
            className="filter"
            aria-pressed={kind === filter.value}
            onClick={() => setKind(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </fieldset>
      <fieldset className="filter-row" aria-label="Статус">
        {statusFilters.map((value) => (
          <button
            type="button"
            key={value}
            className="filter filter--quiet"
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
          >
            {value === "all" ? "Все статусы" : statusLabels[value]}
          </button>
        ))}
      </fieldset>
      <div className="filter-tools">
        <label className="select-label">
          <span>Актив</span>
          <select
            className="asset-select"
            value={asset}
            onChange={(event) => {
              const value = event.target.value;
              setAsset(value === "RUB" || value === "USDT" || value === "TON" ? value : "all");
            }}
          >
            <option value="all">Все активы</option>
            {assetCodes.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <span className="filter-tools__count num" aria-live="polite">Найдено: {filtered.length}</span>
      </div>

      {operations.length === 0 ? (
        <EmptyState title="Операций пока нет">
          Здесь появятся обмены, пополнения и выводы после прохождения идентификации.
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="По выбранному фильтру операций нет."
          action={<button type="button" className="link" onClick={resetFilters}>Сбросить фильтры</button>}
        />
      ) : (
        <div className="list">
          {filtered.map((operation) => (
            <OperationRow key={operation.id} operation={operation} onOpen={(id) => openSheet({ kind: "operation", id })} />
          ))}
        </div>
      )}
    </section>
  );
}
