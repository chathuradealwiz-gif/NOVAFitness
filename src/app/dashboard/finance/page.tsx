import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, StatCard } from "@/components/ui";
import { formatDate, formatMoney, PAYMENT_TYPE_LABELS } from "@/lib/format";
import type { FinancialReport, GymSettings, PaymentType } from "@/types/database";
import { RevenueChart } from "./RevenueChart";
import { PrintButton } from "./PrintButton";
import { MonthPicker } from "./MonthPicker";

// Monthly financial report (spec §47, §63).
export default async function FinancePage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  await requireStaff();
  const supabase = createClient();

  // `month` is YYYY-MM; default to the current month.
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "")
    ? searchParams.month!
    : new Date().toISOString().slice(0, 7);

  const [year, monthIndex] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);

  const [{ data: report }, { data: trend }, { data: settings }] = await Promise.all([
    supabase.rpc("financial_report", { p_from: from, p_to: to }),
    supabase.rpc("revenue_trend", { p_from: from, p_to: to }),
    supabase.from("gym_settings").select("*").maybeSingle(),
  ]);

  const summary = (report ?? { total: 0, by_type: {} }) as unknown as FinancialReport;
  const currency = (settings as GymSettings | null)?.currency ?? "LKR";

  const monthLabel = new Date(`${from}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <>
      <PageHeader
        title="Financial Report"
        subtitle={`${monthLabel} · ${formatDate(from)} – ${formatDate(to)}`}
        action={
          <div className="no-print flex gap-2">
            <MonthPicker month={month} />
            <PrintButton />
          </div>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total Revenue" value={formatMoney(summary.total, currency)} accent />
        {(Object.keys(PAYMENT_TYPE_LABELS) as PaymentType[]).map((type) => (
          <StatCard
            key={type}
            label={PAYMENT_TYPE_LABELS[type]}
            value={formatMoney(summary.by_type?.[type] ?? 0, currency)}
          />
        ))}
      </section>

      <section className="nova-card mt-6">
        <h2 className="mb-4 text-sm font-semibold">Daily revenue — {monthLabel}</h2>
        <RevenueChart
          data={(trend ?? []) as { day: string; total: number }[]}
          currency={currency}
        />
      </section>

      <p className="mt-6 text-xs text-nova-muted">
        Figures include payments with status <strong>paid</strong> only. Voided and refunded records
        are excluded from revenue but retained in the payment history and audit log.
      </p>
    </>
  );
}
