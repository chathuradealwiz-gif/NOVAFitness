import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/ui";
import { DumbbellArt } from "@/components/illustrations";
import { formatDate } from "@/lib/format";

interface PlanRow {
  id: string;
  title: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  trainer_name: string | null;
  members: { id: string; full_name: string; membership_id: string } | null;
}

export default async function WorkoutPlansPage() {
  await requireStaff();
  const supabase = createClient();

  const { data } = await supabase
    .from("workout_plans")
    .select("id, title, status, start_date, end_date, trainer_name, members(id, full_name, membership_id)")
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(100);

  const plans = (data ?? []) as unknown as PlanRow[];

  return (
    <>
      <PageHeader
        title="Workout Plans"
        subtitle="Assign a plan from a member's profile page."
      />

      {plans.length === 0 ? (
        <EmptyState
          title="No workout plans yet" art={<DumbbellArt />}
          hint="Open a member and choose Assign Workout."
        />
      ) : (
        <div className="nova-card">
          <div className="nova-table-wrap">
            <table className="nova-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Member No.</th>
                  <th>Plan</th>
                  <th>Trainer</th>
                  <th>Period</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id} className="hover:bg-white/5">
                    <td className="font-medium">
                      <Link href={`/dashboard/workouts/${plan.id}`} className="hover:underline">
                        {plan.members?.full_name ?? "—"}
                      </Link>
                    </td>
                    <td className="font-mono text-xs text-nova-red">
                      {plan.members?.membership_id ?? "—"}
                    </td>
                    <td>{plan.title}</td>
                    <td className="text-nova-muted">{plan.trainer_name ?? "—"}</td>
                    <td className="text-nova-muted">
                      {plan.start_date
                        ? `${formatDate(plan.start_date)} → ${formatDate(plan.end_date)}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
