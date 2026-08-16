import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { WorkoutExercise, WorkoutPlan } from "@/types/database";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TODAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
  new Date().getDay()
];

export default async function MemberWorkoutPage() {
  const { member } = await requireMember();
  if (!member) return null;

  const supabase = createClient();
  const { data } = await supabase
    .from("workout_plans")
    .select("*, workout_exercises(*)")
    .eq("member_id", member.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Workout Plan</h1>
        <EmptyState
          title="No plan assigned yet"
          hint="Ask a trainer at the gym to set one up for you."
        />
      </div>
    );
  }

  const plan = data as unknown as WorkoutPlan & { workout_exercises: WorkoutExercise[] };
  const exercises = plan.workout_exercises ?? [];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{plan.title}</h1>
        {plan.description && <p className="mt-1 text-sm text-nova-muted">{plan.description}</p>}
        <p className="mt-1 text-xs text-nova-muted">
          {plan.trainer_name ? `Trainer: ${plan.trainer_name} · ` : ""}
          {plan.start_date ? `${formatDate(plan.start_date)} – ${formatDate(plan.end_date)}` : ""}
        </p>
      </header>

      {DAYS.map((day) => {
        const dayExercises = exercises
          .filter((exercise) => exercise.day === day)
          .sort((a, b) => a.sort_order - b.sort_order);

        return (
          <section
            key={day}
            className={`nova-card ${day === TODAY ? "nova-card-accent" : ""}`}
          >
            <p className="nova-label">
              {day[0].toUpperCase() + day.slice(1)}
              {day === TODAY && <span className="ml-2 text-nova-red">Today</span>}
            </p>

            {dayExercises.length === 0 ? (
              <p className="mt-2 text-sm text-nova-muted">Rest day</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {dayExercises.map((exercise) => (
                  <li key={exercise.id} className="text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{exercise.exercise_name}</span>
                      <span className="shrink-0 text-nova-muted">
                        {exercise.sets && exercise.reps
                          ? `${exercise.sets} × ${exercise.reps}`
                          : (exercise.duration ?? "—")}
                      </span>
                    </div>
                    {exercise.notes && (
                      <p className="mt-0.5 text-xs text-nova-muted">{exercise.notes}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
