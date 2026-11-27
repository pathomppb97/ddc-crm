export const DDC_DESIGN_TOKENS = {
  brandPrimary: "#0f4c3a",
  brandSecondary: "#1e293b",
  accent: "#0ea5e9",
  surface: "#f8fafc",
  card: "#ffffff",
  border: "#e2e8f0",
  success: "#15803d",
  warning: "#b45309",
  danger: "#b91c1c",
  info: "#0369a1",
  displayTimezone: "Asia/Bangkok",
} as const;

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export const STATUS_TONE_MAP: Record<string, StatusTone> = {
  published: "success",
  succeeded: "success",
  completed: "success",
  approved: "success",
  verified: "success",
  active: "success",
  scheduled: "info",
  running: "info",
  verifying: "info",
  validated: "info",
  pending: "warning",
  retrying: "warning",
  draft: "neutral",
  superseded: "neutral",
  cancelled: "neutral",
  failed: "danger",
  rejected: "danger",
  rolled_back: "danger",
  kill_switch: "danger",
};
