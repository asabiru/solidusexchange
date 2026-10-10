import type { DeviceSessionView, DeviceSessionsView, SessionClient } from "../shared/api.js";

/** The customer-api auth sessions contract entry shape (snake_case fields). */
export interface ContractAuthSession {
  session_id: string;
  platform: "web" | "ios" | "android" | "telegram-mini-app";
  state: "active" | "revoked" | "expired";
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

export interface ContractAuthSessionsView {
  mode: "test";
  sessions: readonly ContractAuthSession[];
}

/**
 * Adapts a validated customer-api AuthSessionsView into the app's device
 * sessions view. The app surface lists live sign-ins only — the local
 * session store holds nothing else — so sessions whose lifecycle ended
 * (revoked, expired) drop out of the view; the contract's current marker is
 * always active, so exactly one entry stays marked current. session_id
 * becomes the opaque handle (sess_* upstream): the revoke POSTs stay
 * local-store operations, so an upstream-listed handle can never resolve on
 * them — the upstream read owns the list, commands stay local. The
 * two-valued client keeps its telegram/dev-login split: telegram-mini-app
 * maps to telegram, the browser/mobile platforms to dev-login. created_at
 * and last_seen_at parse to milliseconds and the ordering matches the local
 * view (current first, then most recently observed).
 */
export function contractAuthSessionsView(view: ContractAuthSessionsView): DeviceSessionsView {
  const sessions: DeviceSessionView[] = view.sessions
    .filter((session) => session.state === "active")
    .map((session) => ({
      handle: session.session_id,
      client: (session.platform === "telegram-mini-app" ? "telegram" : "dev-login") as SessionClient,
      createdAt: Date.parse(session.created_at),
      lastSeenAt: Date.parse(session.last_seen_at),
      current: session.current
    }));
  sessions.sort(
    (a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt - a.lastSeenAt || b.createdAt - a.createdAt
  );
  return { mode: "test", sessions };
}
