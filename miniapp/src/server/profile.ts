import type { CustomerApiAccess, ProfileView } from "../shared/api.js";

/** The customer-api profile contract shape (snake_case field names). */
export interface ContractProfileView {
  mode: "test";
  customer_ref: string;
  display_name: string;
  locale: "en" | "ky" | "ru";
  registered_at: string;
}

/**
 * Adapts a validated customer-api ProfileView into the app's profile
 * response: display_name and customer_ref overlay the local synthetic
 * identity fields, while every app-only section (kyc, limits, fees,
 * security) and the apiAccess block are preserved exactly as today. The
 * upstream locale and registered_at have no app counterpart and are
 * dropped.
 */
export function contractProfileView(
  view: ContractProfileView,
  local: Omit<ProfileView, "apiAccess">,
  apiAccess: CustomerApiAccess
): ProfileView {
  return { ...local, displayName: view.display_name, customerRef: view.customer_ref, apiAccess };
}
