import type { Capability } from "../auth/access.js";

export type ScreenId =
  | "dashboard"
  | "customers"
  | "kyc"
  | "aml"
  | "investigations"
  | "fraud"
  | "subjects"
  | "operations"
  | "withdrawal"
  | "payments"
  | "checks"
  | "custody"
  | "liquidity"
  | "treasury-planning"
  | "ledger"
  | "cards"
  | "support"
  | "channels"
  | "approvals"
  | "analytics"
  | "regulatory"
  | "vendor-risk"
  | "reports"
  | "privacy"
  | "incidents"
  | "resilience"
  | "admin"
  | "audit";

export type NavigationGroup = "workspace" | "customer-risk" | "money-movement" | "service" | "control" | "system";

export interface NavigationItem {
  id: ScreenId;
  group: NavigationGroup;
  capability?: Capability;
  implemented: boolean;
}

export const navigation: readonly NavigationItem[] = [
  { id: "dashboard", group: "workspace", capability: "dashboard:read", implemented: true },
  { id: "customers", group: "customer-risk", capability: "customers:read", implemented: true },
  { id: "kyc", group: "customer-risk", capability: "kyc:read", implemented: true },
  { id: "aml", group: "customer-risk", capability: "aml:read", implemented: true },
  { id: "investigations", group: "customer-risk", capability: "investigations:read", implemented: true },
  { id: "fraud", group: "customer-risk", capability: "fraud:read", implemented: true },
  { id: "subjects", group: "customer-risk", capability: "subjects:read", implemented: true },
  { id: "operations", group: "money-movement", implemented: false },
  { id: "withdrawal", group: "money-movement", capability: "custody:read", implemented: true },
  { id: "payments", group: "money-movement", implemented: false },
  { id: "checks", group: "money-movement", capability: "checks:read", implemented: true },
  { id: "custody", group: "money-movement", implemented: false },
  { id: "liquidity", group: "money-movement", implemented: false },
  { id: "treasury-planning", group: "money-movement", implemented: false },
  { id: "ledger", group: "money-movement", implemented: false },
  { id: "cards", group: "service", implemented: false },
  { id: "support", group: "service", capability: "support:read", implemented: true },
  { id: "channels", group: "service", implemented: false },
  { id: "approvals", group: "control", capability: "approvals:read", implemented: true },
  { id: "analytics", group: "control", implemented: false },
  { id: "regulatory", group: "control", implemented: false },
  { id: "vendor-risk", group: "control", implemented: false },
  { id: "reports", group: "control", capability: "reports:read", implemented: true },
  { id: "privacy", group: "control", implemented: false },
  { id: "incidents", group: "system", implemented: false },
  { id: "resilience", group: "system", implemented: false },
  { id: "admin", group: "system", implemented: false },
  { id: "audit", group: "system", capability: "audit:read", implemented: true }
];

export const navigationGroups: readonly NavigationGroup[] = [...new Set(navigation.map((item) => item.group))];
