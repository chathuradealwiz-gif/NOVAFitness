import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, StatCard, StatusPill } from "@/components/ui";
import {
  IconAttendance,
  IconDevice,
  IconFinance,
  IconMembers,
  IconPayments,
  IconStatus,
} from "@/components/icons";
import { formatDate, formatMoney } from "@/lib/format";
import type { DashboardStats, GymSettings, Member } from "@/types/database";
import { AttendanceTrend } from "./AttendanceTrend";

// Numbers come from aggregate RPCs so the browser never pulls whole tables.
export default async function DashboardPage() {
  await requireStaff();
  const supabase = createClient();

  const [{ data: stats }, { data: trend }, { data: settings }, { data: dueSoon }] =
    await Promise.all([
      supabase.rpc("dashboard_stats"),
      supabase.rpc("attendance_trend", { p_days: 14 }),
      supabase.from("gym_settings").select("*").maybeSingle(),
      supabase
        .from("members")
        .select("id, membership_id, full_name, status, next_payment_date")
        .not("next_payment_date", "is", null)
        .lte("next_payment_date", new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10))
        .order("next_payment_date")
        .limit(8),
    ]);

  const s = (stats ?? {}) as DashboardStats;
  const currency = (settings as GymSettings | null)?.currency ?? "LKR";

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`NOVA FITNESS · ${formatDate(new Date().toISOString())}`}
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Total Members" value={s.total_members ?? 0} icon={<IconMembers size={17} />} />
        <StatCard label="Active" value={s.active_members ?? 0} accent icon={<IconMembers size={17} />} />
        <StatCard label="Expired" value={s.expired_members ?? 0} icon={<IconStatus size={17} />} />
        <StatCard label="Suspended" value={s.suspended_members ?? 0} icon={<IconStatus size={17} />} />
        <StatCard
          label="Today's Attendance"
          value={s.today_attendance ?? 0}
          hint={`${s.today_entries ?? 0} in · ${s.today_exits ?? 0} out`}
          icon={<IconAttendance size={17} />}
        />
        <StatCard
          label="Today's Revenue"
          value={formatMoney(s.today_revenue, currency)}
          icon={<IconPayments size={17} />}
        />
        <StatCard
          label="This Month"
          value={formatMoney(s.month_revenue, currency)}
          icon={<IconFinance size={17} />}
        />
        <StatCard
          label="Devices"
          icon={<IconDevice size={17} />}
          value={`${s.devices_online ?? 0} online`}
          hint={
            (s.pending_sync ?? 0) > 0
              ? `${s.pending_sync} events pending sync`
              : `${s.devices_offline ?? 0} offline`
          }
        />
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className="nova-card xl:col-span-2">
          <h2 className="mb-4 text-sm font-semibold">Attendance — last 14 days</h2>
          <AttendanceTrend data={(trend ?? []) as { day: string; entries: number; exits: number }[]} />
        </div>

        <div className="nova-card">
          <h2 className="mb-1 text-sm font-semibold">Payments due this week</h2>
          <p className="mb-3 text-xs text-nova-muted">{s.due_this_week ?? 0} member(s)</p>

          {(dueSoon ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-nova-muted">Nothing due. Nice.</p>
          ) : (
            <ul className="space-y-2">
              {(dueSoon as Pick<
                Member,
                "id" | "membership_id" | "full_name" | "status" | "next_payment_date"
              >[]).map((member) => (
                <li key={member.id}>
                  <Link
                    href={`/dashboard/members/${member.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-white/5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{member.full_name}</span>
                      <span className="block font-mono text-xs text-nova-muted">
                        {member.membership_id}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <StatusPill status={member.status} />
                      <span className="mt-1 block text-xs text-nova-muted">
                        {formatDate(member.next_payment_date)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
