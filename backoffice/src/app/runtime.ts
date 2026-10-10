export type RuntimeMode = "dev-dry-run";

const configuredMode = import.meta.env?.VITE_BACKOFFICE_MODE ?? "dev-dry-run";

if (configuredMode !== "dev-dry-run") {
  throw new Error("Backoffice refuses to start outside dev-dry-run mode");
}

export const runtime = {
  mode: configuredMode as RuntimeMode,
  commandsEnabled: false
} as const;
