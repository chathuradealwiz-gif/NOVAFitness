import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { Attendance } from "@/types/database";

export default async function MemberAttendancePage() {
  const { member } = await requireMember();
  if (!member) return null;

  const supabase = createClient();

  // RLS restricts this to the caller's own rows regardless of the filter.
  const { data } = await supabase
    .from("attendance")
    .select("*")
    .eq("member_id", member.id)
    .order("occurred_at", { ascending: false })
    .limit(60);

  const events = (data ?? []) as Attendance[];
  const thisMonth = events.filter(
    (event) =>
      event.event_type === "entry" &&
      event.authorized &&
      new Date(event.occurred_at).getMonth() === new Date().getMonth(),
  ).length;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">My Attendance</h1>

      <section className="nova-card">
        <p className="nova-label">Visits this month</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{thisMonth}</p>
      </section>

      {events.length === 0 ? (
        <EmptyState title="No visits recorded yet" hint="Scan your finger at the entrance." />
      ) : (
        <section className="nova-card">
          <p className="nova-label mb-2">Recent activity</p>
          <ul className="divide-y divide-nova-border/60">
            {events.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>
                  <span className="block font-medium capitalize">{event.event_type}</span>
                  {!event.authorized && (
                    <span className="block text-xs text-nova-red">Access denied</span>
                  )}
                </span>
                <span className="text-nova-muted">{formatDateTime(event.occurred_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
