import type { Capability } from "../auth/access";

export type ScreenId =
  | "dashboard"
  | "customers"
  | "kyc"
  | "aml"
  | "investigations"
  | "fraud"
  | "operations"
  | "withdrawal"
  | "payments"
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

export interface NavigationItem {
  id: ScreenId;
  label: string;
  group: string;
  capability?: Capability;
  implemented: boolean;
}

export const navigation: readonly NavigationItem[] = [
  { id: "dashboard", label: "Operations center", group: "Workspace", capability: "dashboard:read", implemented: true },
  { id: "customers", label: "Customers 360", group: "Customer risk", capability: "customers:read", implemented: true },
  { id: "kyc", label: "KYC / KYB", group: "Customer risk", capability: "kyc:read", implemented: true },
  { id: "aml", label: "AML / KYT", group: "Customer risk", capability: "aml:read", implemented: true },
  { id: "investigations", label: "Investigations", group: "Customer risk", capability: "investigations:read", implemented: true },
  { id: "fraud", label: "Fraud controls", group: "Customer risk", capability: "fraud:read", implemented: true },
  { id: "operations", label: "Operations", group: "Money movement", implemented: false },
  { id: "withdrawal", label: "Withdrawals", group: "Money movement", implemented: false },
  { id: "payments", label: "Fiat payments", group: "Money movement", implemented: false },
  { id: "custody", label: "Wallets & custody", group: "Money movement", implemented: false },
  { id: "liquidity", label: "Exchange & liquidity", group: "Money movement", implemented: false },
  { id: "treasury-planning", label: "Treasury planning", group: "Money movement", implemented: false },
  { id: "ledger", label: "Ledger & reconciliation", group: "Money movement", implemented: false },
  { id: "cards", label: "Cards", group: "Service", implemented: false },
  { id: "support", label: "Support & complaints", group: "Service", implemented: false },
  { id: "channels", label: "Customer channels", group: "Service", implemented: false },
  { id: "approvals", label: "Approval inbox", group: "Control", capability: "approvals:read", implemented: true },
  { id: "analytics", label: "Analytics", group: "Control", implemented: false },
  { id: "regulatory", label: "Regulatory", group: "Control", implemented: false },
  { id: "vendor-risk", label: "Vendor risk", group: "Control", implemented: false },
  { id: "reports", label: "Отчёты", group: "Control", capability: "reports:read", implemented: true },
  { id: "privacy", label: "Privacy", group: "Control", implemented: false },
  { id: "incidents", label: "Incidents", group: "System", implemented: false },
  { id: "resilience", label: "Resilience", group: "System", implemented: false },
  { id: "admin", label: "Administration", group: "System", implemented: false },
  { id: "audit", label: "Audit trail", group: "System", capability: "audit:read", implemented: true }
];

export const navigationGroups = [...new Set(navigation.map((item) => item.group))];
