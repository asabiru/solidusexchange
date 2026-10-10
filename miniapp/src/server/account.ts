import { createHash } from "node:crypto";

import type { AccountView } from "../shared/api.js";
import type { CustomerSession } from "./session.js";

/** The customer-api users contract record shape (snake_case fields). */
export interface ContractUserFlags {
  terms_accepted: boolean;
  two_factor_enabled: boolean;
  marketing_opt_in: boolean;
}

export interface ContractUserView {
  mode: "test";
  user_id: string;
  subject: string;
  status: "pending" | "active" | "suspended" | "closed";
  flags: ContractUserFlags;
  created_at: string;
  updated_at: string;
}

/**
 * The standalone dev BFF's account record. The local session store holds no
 * user directory, so the view derives a stable synthetic record from the
 * session itself: the usr_* id is a hash of the session subject and the
 * lifecycle stays "active" — the session the record is served to is proof
 * the account is usable. flags read all-false: the local store tracks no
 * consent or 2FA attestations, so nothing positive is invented. Both
 * timestamps pin to the session creation instant, the only account
 * timestamp the store actually knows.
 */
export function localAccountView(session: CustomerSession): AccountView {
  return {
    mode: "test",
    id: `usr_${createHash("sha256")
      .update(`solidchange-miniapp-account|${session.subject}`)
      .digest("hex")
      .slice(0, 24)}`,
    subject: session.subject,
    status: "active",
    flags: {
      termsAccepted: false,
      twoFactorEnabled: false,
      marketingOptIn: false
    },
    createdAt: session.createdAt,
    updatedAt: session.createdAt
  };
}

/**
 * Adapts a validated customer-api UserView into the app's account view.
 * user_id becomes the opaque usr_* account handle, subject stays the
 * upstream customer reference (syn_cust_*), and the snake_case flags and
 * ISO timestamps map to the app's camelCase view unchanged in meaning.
 */
export function contractAccountView(view: ContractUserView): AccountView {
  return {
    mode: "test",
    id: view.user_id,
    subject: view.subject,
    status: view.status,
    flags: {
      termsAccepted: view.flags.terms_accepted,
      twoFactorEnabled: view.flags.two_factor_enabled,
      marketingOptIn: view.flags.marketing_opt_in
    },
    createdAt: Date.parse(view.created_at),
    updatedAt: Date.parse(view.updated_at)
  };
}
