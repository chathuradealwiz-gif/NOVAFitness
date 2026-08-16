import type { ReactNode } from "react";
import { statusClasses, STATUS_LABELS } from "@/lib/format";
import type { MemberStatus } from "@/types/database";

export function StatusPill({ status }: { status: MemberStatus }) {
  return <span className={`nova-pill ${statusClasses(status)}`}>{STATUS_LABELS[status]}</span>;
}

export function StatCard({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className={`nova-card ${accent ? "nova-card-accent" : ""}`}>
      <p className="nova-label">{label}</p>
      <p
        className={`mt-2 font-display text-2xl font-bold tabular-nums ${
          accent ? "text-nova-red" : ""
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-nova-muted">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="nova-card grid place-items-center py-12 text-center">
      <p className="font-semibold text-nova-text">{title}</p>
      {hint && <p className="mt-1 text-sm text-nova-muted">{hint}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight">
          {title}
        </h1>
        {/* Short red underscore under every page title — a small, consistent
            piece of brand furniture. */}
        <span className="mt-1.5 block h-[3px] w-10 rounded-full bg-nova-red" />
        {subtitle && <p className="mt-2 text-sm text-nova-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="nova-label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-nova-muted">{hint}</p>}
    </label>
  );
}

/** Label/value row used on the member and admin profile pages. */
export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-nova-border/60 py-2.5 last:border-0">
      <span className="text-sm text-nova-muted">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}
