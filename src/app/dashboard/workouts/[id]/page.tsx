import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import type { WorkoutExercise, WorkoutPlan } from "@/types/database";
import { WorkoutPlanEditor } from "../WorkoutPlanEditor";

export default async function EditWorkoutPlanPage({ params }: { params: { id: string } }) {
  await requireStaff();
  const supabase = createClient();

  const { data: plan } = await supabase
    .from("workout_plans")
    .select("*, members(id, full_name, membership_id)")
    .eq("id", params.id)
    .maybeSingle();

  if (!plan) notFound();

  const { data: exercises } = await supabase
    .from("workout_exercises")
    .select("*")
    .eq("workout_plan_id", params.id)
    .order("sort_order");

  const member = (plan as unknown as {
    members: { id: string; full_name: string; membership_id: string };
  }).members;

  return (
    <>
      <PageHeader title="Edit Workout Plan" subtitle={(plan as WorkoutPlan).title} />
      <WorkoutPlanEditor
        member={member}
        plan={plan as WorkoutPlan}
        exercises={(exercises ?? []) as WorkoutExercise[]}
      />
    </>
  );
}
