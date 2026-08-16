import type { MemberStatus, PaymentType } from "@/types/database";

/** "16 Aug 2026" — the format used throughout the spec's mockups. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatMoney(amount: number | null | undefined, currency = "LKR"): string {
  const value = Number(amount ?? 0);
  return `${currency} ${value.toLocaleString("en-LK", { maximumFractionDigits: 2 })}`;
}

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  registration: "Registration",
  monthly_membership: "Monthly Membership",
  personal_coaching: "Personal Coaching",
  other: "Other",
};

export const STATUS_LABELS: Record<MemberStatus, string> = {
  active: "Active",
  expired: "Expired",
  suspended: "Suspended",
  inactive: "Inactive",
};

/** Tailwind classes for a member status pill. */
export function statusClasses(status: MemberStatus): string {
  switch (status) {
    case "active":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "expired":
      return "bg-nova-red/15 text-nova-red border-nova-red/30";
    case "suspended":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    default:
      return "bg-white/5 text-nova-muted border-nova-border";
  }
}

/** Days until the next payment; negative when overdue. */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Rows -> CSV. Used by the attendance and finance exports. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((col) => escape(row[col])).join(",")),
  ].join("\n");
}
