import type { ScreenId } from "./navigation";

const screenPaths: Readonly<Record<ScreenId, string>> = {
  dashboard: "M4 13h6V4H4zM14 20h6v-9h-6zM14 8h6V4h-6zM4 20h6v-3H4z",
  customers: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18.5 14.5A6.5 6.5 0 0 1 21.5 20",
  kyc: "M3 5h18v14H3zM8.5 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.5 16a3 3 0 0 1 6 0M14 9h4M14 13h4",
  aml: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6zM9 12l2 2 4-4",
  investigations: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L21 21",
  fraud: "M12 3l9.5 17h-19zM12 10v4M12 17h.01",
  subjects: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  operations: "M4 7h13M13 3l4 4-4 4M20 17H7M11 13l-4 4 4 4",
  withdrawal: "M12 4v11M7.5 10.5L12 15l4.5-4.5M4 20h16",
  payments: "M3 6h18v12H3zM3 10h18M7 15h3",
  checks: "M6 3h9l4 4v14H6zM9.5 9h2M9 14l2.5 2.5L16 12",
  custody: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2",
  liquidity: "M12 3c3.5 4.5 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 2.5-6.5 6-11z",
  "treasury-planning": "M4 20V10M10 20V4M16 20v-7M22 20H2",
  ledger: "M5 3h11l3 3v15H5zM9 9h6M9 13h6M9 17h4",
  cards: "M2.5 6.5h19v11h-19zM2.5 10h19M6 14.5h4",
  support: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  channels: "M4 12a8 8 0 1 0 3-6.2L4 4v5h5M12 8v4l3 2",
  approvals: "M4 4h16v16H4zM8 12l3 3 5-6",
  analytics: "M4 19l5-6 4 3 7-9M15 7h5v5",
  regulatory: "M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18",
  "vendor-risk": "M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8",
  reports: "M6 3h9l4 4v14H6zM9.5 13h6M9.5 17h6M9.5 9h2",
  privacy: "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 20L20 4",
  incidents: "M12 3a6 6 0 0 1 6 6v5l2 3H4l2-3V9a6 6 0 0 1 6-6zM10 20h4",
  resilience: "M3 12h4l3-7 4 14 3-7h4",
  admin: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 20.9 10H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  audit: "M4 6h16M4 12h10M4 18h7M17 15l2 2 3-4"
};

const uiPaths = {
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L21 21",
  density: "M4 6h16M4 12h16M4 18h16",
  comfortable: "M4 7h16M4 17h16",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  expand: "M9 6l6 6-6 6",
  collapse: "M15 6l-6 6 6 6",
  shield: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"
} as const;

export type UiIconName = keyof typeof uiPaths;

function Svg({ d }: { d: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

export function ScreenIcon({ id }: { id: ScreenId }) {
  return <Svg d={screenPaths[id]} />;
}

export function UiIcon({ name }: { name: UiIconName }) {
  return <Svg d={uiPaths[name]} />;
}
