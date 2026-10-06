import { type CSSProperties, type PointerEvent, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import type { Tab } from "./navigation";

export interface TabItem {
  id: Tab;
  label: string;
  icon: IconName;
}

interface Drag {
  pointerId: number;
  startX: number;
  moved: boolean;
  hovered: Tab;
}

const dragThreshold = 6;

function tabAt(x: number, y: number): Tab | undefined {
  const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-tab]");
  return target?.dataset.tab as Tab | undefined;
}

export function TabBar({
  items,
  active,
  open,
  ariaLabel
}: {
  items: readonly TabItem[];
  active: Tab;
  ariaLabel: string;
  open: (tab: Tab) => void;
}) {
  const drag = useRef<Drag | undefined>(undefined);
  const suppressClick = useRef(false);
  const [hovered, setHovered] = useState<Tab | undefined>();
  const shown = hovered ?? active;
  const index = Math.max(0, items.findIndex((item) => item.id === shown));

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const tab = tabAt(event.clientX, event.clientY);
    if (!tab) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, moved: false, hovered: tab };
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved) {
      if (Math.abs(event.clientX - current.startX) < dragThreshold) return;
      current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const tab = tabAt(event.clientX, event.clientY);
    if (tab) current.hovered = tab;
    setHovered(current.hovered);
  };

  const finish = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setHovered(undefined);
    if (commit && current.moved) {
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      if (current.hovered !== active) open(current.hovered);
    }
  };

  return (
    <nav className="bottom-nav" aria-label={ariaLabel}>
      <div
        className="tabbar"
        data-dragging={hovered ? "true" : undefined}
        style={{ "--tab-index": index, "--tab-count": items.length } as CSSProperties}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={(event) => finish(event, true)}
        onPointerCancel={(event) => finish(event, false)}
      >
        <span className="tabbar__indicator" aria-hidden="true" />
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            data-tab={item.id}
            className={`nav${item.id === "qr" ? " nav--qr" : ""}`}
            data-hovered={hovered === item.id ? "true" : undefined}
            aria-current={active === item.id ? "page" : undefined}
            onClick={() => {
              if (!suppressClick.current) open(item.id);
            }}
          >
            <span className="nav__icon"><Icon name={item.icon} /></span>
            <span className="nav__label">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
