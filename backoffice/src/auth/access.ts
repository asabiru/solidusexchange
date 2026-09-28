export type Capability =
  | "dashboard:read"
  | "customers:read"
  | "approvals:read"
  | "approvals:review"
  | "approvals:preview"
  | "audit:read";

export type OperatorRole =
  | "compliance-lead"
  | "support-l1"
  | "aml-investigator"
  | "auditor";

export interface RoleProfile {
  id: OperatorRole;
  label: string;
  operator: string;
  initials: string;
  capabilities: readonly Capability[];
}

export const roleProfiles: readonly RoleProfile[] = [
  {
    id: "compliance-lead",
    label: "Compliance lead",
    operator: "Мария Коваль",
    initials: "МК",
    capabilities: [
      "dashboard:read",
      "customers:read",
      "approvals:read",
      "approvals:review",
      "approvals:preview",
      "audit:read"
    ]
  },
  {
    id: "support-l1",
    label: "Support L1",
    operator: "Илья Нуров",
    initials: "ИН",
    capabilities: ["dashboard:read", "customers:read"]
  },
  {
    id: "aml-investigator",
    label: "AML investigator",
    operator: "Роман Юдин",
    initials: "РЮ",
    capabilities: ["dashboard:read", "customers:read", "approvals:read"]
  },
  {
    id: "auditor",
    label: "Auditor · read-only",
    operator: "Антон Белый",
    initials: "АБ",
    capabilities: ["dashboard:read", "customers:read", "approvals:read", "audit:read"]
  }
];

export function findRole(role: string): RoleProfile | undefined {
  return roleProfiles.find((profile) => profile.id === role);
}

export function can(role: string, capability: Capability): boolean {
  return findRole(role)?.capabilities.includes(capability) ?? false;
}
