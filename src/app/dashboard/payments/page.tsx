import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatDate, formatMoney, PAYMENT_TYPE_LABELS } from "@/lib/format";
import type { Member, Payment, PaymentStatus, PaymentType } from "@/types/database";
import { PaymentFilters } from "./PaymentFilters";
import { VoidPaymentButton } from "./VoidPaymentButton";

const PAGE_SIZE = 50;

interface PaymentRow extends Payment {
  members: Pick<Member, "id" | "membership_id" | "full_name"> | null;
  profiles: { full_name: string | null } | null;
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; type?: string; status?: string; member?: string; page?: string };
}) {
  const session = await requireStaff();
  const supabase = createClient();

  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const from =
    searchParams.from ?? new Date(new Date().setDate(1)).toISOString().slice(0, 10);
  const to = searchParams.to ?? new Date().toISOString().slice(0, 10);

  let query = supabase
    .from("payments")
    .select("*, members(id, membership_id, full_name), profiles:recorded_by(full_name)", {
      count: "exact",
    })
    .gte("payment_date", from)
    .lte("payment_date", to)
    .order("payment_date", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (searchParams.type) query = query.eq("payment_type", searchParams.type as PaymentType);
  if (searchParams.status) query = query.eq("status", searchParams.status as PaymentStatus);
  if (searchParams.member) query = query.eq("member_id", searchParams.member);

  const { data, count } = await query;
  const rows = (data ?? []) as unknown as PaymentRow[];

  const paidTotal = rows
    .filter((row) => row.status === "paid")
    .reduce((sum, row) => sum + Number(row.amount), 0);

  const pageCount = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle={`${count ?? 0} record(s) · ${formatMoney(paidTotal)} on this page`}
        action={
          <Link href="/dashboard/finance" className="nova-btn-ghost">
            Financial Reports
          </Link>
        }
      />

      <PaymentFilters
        from={from}
        to={to}
        type={searchParams.type}
        status={searchParams.status}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No payments in this range"
          hint="Record payments from a member's profile page."
        />
      ) : (
        <div className="nova-card mt-4">
          <div className="nova-table-wrap">
            <table className="nova-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Member No.</th>
                  <th>Member</th>
                  <th>Type</th>
                  <th>Period</th>
                  <th className="text-right">Amount</th>
                  <th>Recorded By</th>
                  <th>Status</th>
                  {session.isSuperAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={row.status !== "paid" ? "opacity-50" : ""}>
                    <td className="whitespace-nowrap">{formatDate(row.payment_date)}</td>
                    <td className="font-mono text-xs">
                      {row.members ? (
                        <Link
                          href={`/dashboard/members/${row.members.id}`}
                          className="text-nova-red hover:underline"
                        >
                          {row.members.membership_id}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{row.members?.full_name ?? "—"}</td>
                    <td>{PAYMENT_TYPE_LABELS[row.payment_type]}</td>
                    <td className="whitespace-nowrap text-nova-muted">
                      {row.period_start
                        ? `${formatDate(row.period_start)} → ${formatDate(row.period_end)}`
                        : "—"}
                    </td>
                    <td className="text-right font-medium tabular-nums">
                      {formatMoney(row.amount, row.currency)}
                    </td>
                    <td className="text-nova-muted">{row.profiles?.full_name ?? "—"}</td>
                    <td className="capitalize">{row.status}</td>
                    {session.isSuperAdmin && (
                      <td>
                        {row.status === "paid" && <VoidPaymentButton paymentId={row.id} />}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <p className="mt-4 text-center text-sm text-nova-muted">
              Page {page} of {pageCount}
            </p>
          )}
        </div>
      )}
    </>
  );
}
