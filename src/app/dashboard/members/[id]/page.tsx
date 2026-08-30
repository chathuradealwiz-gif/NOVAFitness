import Link from "next/link";
import { IconBack } from "@/components/icons";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DetailRow, PageHeader, StatusPill } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { formatDate, formatDateTime, formatMoney, PAYMENT_TYPE_LABELS } from "@/lib/format";
import type {
  Attendance,
  Device,
  EnrollmentRequest,
  GymSettings,
  Member,
  Payment,
} from "@/types/database";
import { MemberActions } from "./MemberActions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LinkButton } from "@/components/Button";

export default async function MemberDetailPage({ params }: { params: { id: string } }) {
  const session = await requireStaff();
  const supabase = createClient();

  const { data: member } = await supabase
    .from("members")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (!member) notFound();

  const typedMember = member as Member;

  const [
    { data: payments },
    { data: attendance },
    { data: devices },
    { data: settings },
    { data: enrollment },
    { data: workoutPlans },
    { data: mealPlans },
  ] = await Promise.all([
    supabase
      .from("payments")
      .select("*")
      .eq("member_id", params.id)
      .order("payment_date", { ascending: false })
      .limit(12),
    supabase
      .from("attendance")
      .select("*")
      .eq("member_id", params.id)
      .order("occurred_at", { ascending: false })
      .limit(10),
    supabase.from("devices").select("*").neq("status", "disabled").order("name"),
    supabase.from("gym_settings").select("*").maybeSingle(),
    supabase
      .from("enrollment_requests")
      .select("*")
      .eq("member_id", params.id)
      .in("status", ["pending", "in_progress"])
      .maybeSingle(),
    supabase
      .from("workout_plans")
      .select("id, title, status, start_date, end_date")
      .eq("member_id", params.id)
      .eq("status", "active"),
    supabase
      .from("meal_plans")
      .select("id, title, status, start_date, end_date")
      .eq("member_id", params.id)
      .eq("status", "active"),
  ]);

  const gymSettings = settings as GymSettings | null;
  const currency = gymSettings?.currency ?? "LKR";
  const enrolledDevice = (devices as Device[] | null)?.find(
    (device) => device.id === typedMember.fingerprint_device_id,
  );

  return (
    <>
      {/* Attendance and fingerprint enrolment land here from the door terminal,
          not from this browser, so a return visit must not trust the cache. */}
      <AutoRefresh />
      <PageHeader
        title={typedMember.full_name}
        subtitle={`Member since ${formatDate(typedMember.join_date)}`}
        action={
          <LinkButton href="/dashboard/members">
            <IconBack size={16} />
            Back to members
          </LinkButton>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ---------------------------------------------------------- profile */}
        <div className="space-y-4">
          <section className="nova-card">
            <div className="flex items-center gap-4">
              <Avatar
                name={typedMember.full_name}
                src={typedMember.profile_image_url}
                size={64}
              />
              <div className="min-w-0">
                {/* A bare number needs the "No." to read as an identifier. */}
                <p className="font-display text-lg font-bold text-nova-red">
                  No. {typedMember.membership_id}
                </p>
                <div className="mt-1">
                  <StatusPill status={typedMember.status} />
                </div>
              </div>
            </div>

            <div className="mt-4">
              <DetailRow label="Phone" value={typedMember.phone ?? "—"} />
              <DetailRow label="Email" value={typedMember.email ?? "—"} />
              <DetailRow label="Date of Birth" value={formatDate(typedMember.date_of_birth)} />
              <DetailRow label="Address" value={typedMember.address ?? "—"} />
            </div>
          </section>

          <section className="nova-card">
            <h2 className="mb-2 text-sm font-semibold">Membership</h2>
            <DetailRow
              label="Current Period"
              value={
                typedMember.membership_start
                  ? `${formatDate(typedMember.membership_start)} → ${formatDate(typedMember.membership_end)}`
                  : "No paid period"
              }
            />
            <DetailRow label="Next Payment" value={formatDate(typedMember.next_payment_date)} />
            <DetailRow label="Monthly Fee" value={formatMoney(gymSettings?.monthly_membership_fee, currency)} />
          </section>

          <section className="nova-card">
            <h2 className="mb-2 text-sm font-semibold">Fingerprint</h2>
            {typedMember.fingerprint_id !== null ? (
              <>
                <DetailRow label="Device" value={enrolledDevice?.device_code ?? "Unknown"} />
                <DetailRow
                  label="Fingerprint ID"
                  value={<span className="font-mono">#{typedMember.fingerprint_id}</span>}
                />
                <p className="mt-2 text-xs text-nova-muted">
                  The sensor slot is internal hardware detail — this member&apos;s official gym
                  number is {typedMember.membership_id}.
                </p>
              </>
            ) : (
              <p className="py-2 text-sm text-nova-muted">No fingerprint enrolled.</p>
            )}
          </section>
        </div>

        {/* ---------------------------------------------------------- actions */}
        <div className="space-y-4 xl:col-span-2">
          <MemberActions
            member={typedMember}
            devices={(devices ?? []) as Device[]}
            activeEnrollment={(enrollment as EnrollmentRequest) ?? null}
            settings={gymSettings}
            isSuperAdmin={session.isSuperAdmin}
          />

          <section className="nova-card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Payment History</h2>
              <Link
                href={`/dashboard/payments?member=${typedMember.id}`}
                className="text-xs text-nova-red hover:underline"
              >
                View all
              </Link>
            </div>

            {(payments ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-nova-muted">No payments recorded yet.</p>
            ) : (
              <div className="nova-table-wrap">
                <table className="nova-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Period</th>
                      <th className="text-right">Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(payments as Payment[]).map((payment) => (
                      <tr key={payment.id} className={payment.status !== "paid" ? "opacity-50" : ""}>
                        <td>{formatDate(payment.payment_date)}</td>
                        <td>{PAYMENT_TYPE_LABELS[payment.payment_type]}</td>
                        <td className="text-nova-muted">
                          {payment.period_start
                            ? `${formatDate(payment.period_start)} → ${formatDate(payment.period_end)}`
                            : "—"}
                        </td>
                        <td className="text-right font-medium tabular-nums">
                          {formatMoney(payment.amount, payment.currency)}
                        </td>
                        <td className="capitalize text-nova-muted">{payment.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="nova-card">
              <h2 className="mb-3 text-sm font-semibold">Assigned Plans</h2>
              <p className="nova-label">Workout</p>
              {(workoutPlans ?? []).length === 0 ? (
                <p className="mt-1 text-sm text-nova-muted">None assigned</p>
              ) : (
                (workoutPlans as { id: string; title: string }[]).map((plan) => (
                  <Link
                    key={plan.id}
                    href={`/dashboard/workouts/${plan.id}`}
                    className="mt-1 block text-sm text-nova-red hover:underline"
                  >
                    {plan.title}
                  </Link>
                ))
              )}

              <p className="nova-label mt-4">Meal Plan</p>
              {(mealPlans ?? []).length === 0 ? (
                <p className="mt-1 text-sm text-nova-muted">None assigned</p>
              ) : (
                (mealPlans as { id: string; title: string }[]).map((plan) => (
                  <Link
                    key={plan.id}
                    href={`/dashboard/meals/${plan.id}`}
                    className="mt-1 block text-sm text-nova-red hover:underline"
                  >
                    {plan.title}
                  </Link>
                ))
              )}
            </section>

            <section className="nova-card">
              <h2 className="mb-3 text-sm font-semibold">Recent Attendance</h2>
              {(attendance ?? []).length === 0 ? (
                <p className="py-4 text-sm text-nova-muted">No visits recorded.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {(attendance as Attendance[]).map((event) => (
                    <li key={event.id} className="flex flex-wrap items-center justify-between gap-x-2">
                      <span className={event.authorized ? "" : "text-nova-red"}>
                        {event.event_type === "entry" ? "Entry" : "Exit"}
                        {!event.authorized && " · denied"}
                      </span>
                      <span className="shrink-0 text-nova-muted">{formatDateTime(event.occurred_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
