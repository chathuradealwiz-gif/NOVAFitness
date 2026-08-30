import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { WorkoutPlanEditor } from "../WorkoutPlanEditor";

export default async function NewWorkoutPlanPage({
  searchParams,
}: {
  searchParams: { member?: string };
}) {
  await requireStaff();

  // The editor is always scoped to one member.
  if (!searchParams.member) redirect("/dashboard/members");

  const supabase = createClient();
  const { data: member } = await supabase
    .from("members")
    .select("id, full_name, membership_id")
    .eq("id", searchParams.member)
    .is("deleted_at", null)
    .maybeSingle();

  if (!member) notFound();

  return (
    <>
      <PageHeader title="Assign Workout Plan" />
      <WorkoutPlanEditor member={member} />
    </>
  );
}
