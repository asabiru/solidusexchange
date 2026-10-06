export type IconShape =
  | { tag: "path"; d: string }
  | { tag: "circle"; cx: string; cy: string; r: string }
  | { tag: "rect"; x: string; y: string; width: string; height: string; rx?: string };

export type IconName =
  | "home"
  | "swap"
  | "swap-vertical"
  | "qr"
  | "clock"
  | "user"
  | "plus"
  | "up"
  | "down"
  | "help"
  | "chevron-right"
  | "chevron-down"
  | "eye"
  | "eye-off"
  | "sun"
  | "moon"
  | "check"
  | "check-circle"
  | "alert"
  | "info"
  | "filter"
  | "shield"
  | "shield-check"
  | "percent"
  | "wallet"
  | "bank"
  | "lock"
  | "close"
  | "device"
  | "id-card"
  | "gallery"
  | "keyboard"
  | "file"
  | "receipt"
  | "network"
  | "credit-card"
  | "bookmark-check"
  | "sliders"
  | "bell";

export const iconShapes: Readonly<Record<IconName, readonly IconShape[]>> = {
  "home": [{"tag": "path", "d": "M3.5 10.5 12 3.7l8.5 6.8v9a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1Z"}],
  "swap": [{"tag": "path", "d": "M7 7h12m0 0-3-3m3 3-3 3M17 17H5m0 0 3 3m-3-3 3-3"}],
  "swap-vertical": [{"tag": "path", "d": "M8 4v16m0-16L4.5 7.5M8 4l3.5 3.5M16 20V4m0 16 3.5-3.5M16 20l-3.5-3.5"}],
  "qr": [{"tag": "path", "d": "M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"}, {"tag": "rect", "x": "8", "y": "8", "width": "3", "height": "3", "rx": ".4"}, {"tag": "path", "d": "M14 8h2M14 11h3M8 14h2M8 17h4M14 14h2v3h-2z"}],
  "clock": [{"tag": "circle", "cx": "12", "cy": "12", "r": "9"}, {"tag": "path", "d": "M12 7v5l3 2"}],
  "user": [{"tag": "circle", "cx": "12", "cy": "8", "r": "4"}, {"tag": "path", "d": "M4.5 21a7.5 7.5 0 0 1 15 0"}],
  "plus": [{"tag": "path", "d": "M12 5v14M5 12h14"}],
  "up": [{"tag": "path", "d": "M12 19V5m0 0-5 5m5-5 5 5"}],
  "down": [{"tag": "path", "d": "M12 5v14m0 0 5-5m-5 5-5-5"}],
  "help": [{"tag": "path", "d": "M8.8 9a3.3 3.3 0 0 1 6.4 1c0 2.4-3.2 2.6-3.2 5M12 19h.01"}],
  "chevron-right": [{"tag": "path", "d": "m9 18 6-6-6-6"}],
  "chevron-down": [{"tag": "path", "d": "m6 9 6 6 6-6"}],
  "eye": [{"tag": "path", "d": "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"}, {"tag": "circle", "cx": "12", "cy": "12", "r": "2.5"}],
  "eye-off": [{"tag": "path", "d": "m3 3 18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.1 2.8M6.7 6.7C4 8.5 2.5 12 2.5 12s3.5 6 9.5 6a9.7 9.7 0 0 0 4.1-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"}],
  "sun": [{"tag": "circle", "cx": "12", "cy": "12", "r": "3.5"}, {"tag": "path", "d": "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"}],
  "moon": [{"tag": "path", "d": "M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"}],
  "check": [{"tag": "path", "d": "m5.5 12.4 4.1 4.1 8.9-9"}],
  "check-circle": [{"tag": "circle", "cx": "12", "cy": "12", "r": "9"}, {"tag": "path", "d": "m8 12.5 2.7 2.7L16.5 9"}],
  "alert": [{"tag": "path", "d": "M10.3 4.4 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z"}, {"tag": "path", "d": "M12 9v4M12 17h.01"}],
  "info": [{"tag": "path", "d": "M12 10.5V17M12 7h.01"}],
  "filter": [{"tag": "path", "d": "M4 6h16M7 12h10M10 18h4"}],
  "shield": [{"tag": "path", "d": "M12 3 20 6v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6Z"}],
  "shield-check": [{"tag": "path", "d": "M12 3 20 6v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6Z"}, {"tag": "path", "d": "m8.5 12 2.2 2.2 4.8-4.8"}],
  "percent": [{"tag": "path", "d": "m19 5-14 14"}, {"tag": "circle", "cx": "7", "cy": "7", "r": "2.2"}, {"tag": "circle", "cx": "17", "cy": "17", "r": "2.2"}],
  "wallet": [{"tag": "path", "d": "M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v13H6.5A2.5 2.5 0 0 1 4 16.5Z"}, {"tag": "path", "d": "M4 7h14M15 11h5v4h-5a2 2 0 0 1 0-4Z"}],
  "bank": [{"tag": "path", "d": "m3 9 9-5 9 5M5 10v7M9 10v7M15 10v7M19 10v7M3 20h18"}],
  "lock": [{"tag": "rect", "x": "5", "y": "10", "width": "14", "height": "11", "rx": "2"}, {"tag": "path", "d": "M8 10V7a4 4 0 0 1 8 0v3M12 14v3"}],
  "close": [{"tag": "path", "d": "m7 7 10 10M17 7 7 17"}],
  "device": [{"tag": "rect", "x": "7", "y": "2", "width": "10", "height": "20", "rx": "2"}, {"tag": "path", "d": "M11 18h2"}],
  "id-card": [{"tag": "rect", "x": "3", "y": "5", "width": "18", "height": "14", "rx": "2"}, {"tag": "circle", "cx": "9", "cy": "11", "r": "2"}, {"tag": "path", "d": "M6 16c.8-1.6 1.8-2.4 3-2.4s2.2.8 3 2.4M14 10h4M14 14h4"}],
  "gallery": [{"tag": "rect", "x": "4", "y": "4", "width": "16", "height": "16", "rx": "2"}, {"tag": "circle", "cx": "9", "cy": "9", "r": "1.5"}, {"tag": "path", "d": "m6 18 4.5-4.5 3 3 2-2 2.5 3.5"}],
  "keyboard": [{"tag": "rect", "x": "3", "y": "6", "width": "18", "height": "12", "rx": "2"}, {"tag": "path", "d": "M7 10h.01M11 10h.01M15 10h.01M18 10h.01M7 14h10"}],
  "file": [{"tag": "path", "d": "M6 3h8l4 4v14H6Z"}, {"tag": "path", "d": "M14 3v5h5M9 13h6M9 17h6"}],
  "receipt": [{"tag": "path", "d": "M6 3h12v18l-3-2-3 2-3-2-3 2Z"}, {"tag": "path", "d": "M9 8h6M9 12h6M9 16h4"}],
  "network": [{"tag": "circle", "cx": "12", "cy": "5", "r": "2.5"}, {"tag": "circle", "cx": "6", "cy": "18", "r": "2.5"}, {"tag": "circle", "cx": "18", "cy": "18", "r": "2.5"}, {"tag": "path", "d": "m10.8 7.2-3.6 8.6M13.2 7.2l3.6 8.6M8.5 18h7"}],
  "credit-card": [{"tag": "rect", "x": "3", "y": "5", "width": "18", "height": "14", "rx": "2.5"}, {"tag": "path", "d": "M3 10h18M7 15h4"}],
  "bookmark-check": [{"tag": "path", "d": "M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4Z"}, {"tag": "path", "d": "m9 9 2 2 4-4"}],
  "sliders": [{"tag": "path", "d": "M4 7h10M18 7h2M4 17h2M10 17h10"}, {"tag": "circle", "cx": "16", "cy": "7", "r": "2"}, {"tag": "circle", "cx": "8", "cy": "17", "r": "2"}],
  "bell": [{"tag": "path", "d": "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z"}, {"tag": "path", "d": "M10 20.5a2.2 2.2 0 0 0 4 0"}],
};
