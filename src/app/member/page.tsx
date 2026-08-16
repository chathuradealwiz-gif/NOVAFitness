import Link from "next/link";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/ui";
import { daysUntil, formatDate, formatMoney, PAYMENT_TYPE_LABELS } from "@/lib/format";
import type {
  BroadcastMessage,
  GymSettings,
  MealPlanItem,
  Payment,
  WorkoutExercise,
} from "@/types/database";
import { BroadcastBanner } from "./BroadcastBanner";

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export default async function MemberHome() {
  const { member } = await requireMember();
  if (!member) return null; // layout redirects to /member/setup

  const supabase = createClient();
  const today = DAY_NAMES[new Date().getDay()];

  const [{ data: broadcasts }, { data: settings }, { data: workout }, { data: meals }, { data: payments }] =
    await Promise.all([
      supabase
        .from("broadcast_messages")
        .select("*")
        .order("priority", { ascending: false })
        .limit(3),
      supabase.from("gym_settings").select("*").maybeSingle(),
      supabase
        .from("workout_plans")
        .select("id, title, workout_exercises(*)")
        .eq("member_id", member.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("meal_plans")
        .select("id, title, meal_plan_items(*)")
        .eq("member_id", member.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("payments")
        .select("*")
        .eq("member_id", member.id)
        .eq("status", "paid")
        .order("payment_date", { ascending: false })
        .limit(4),
    ]);

  const gymSettings = settings as GymSettings | null;
  const currency = gymSettings?.currency ?? "LKR";

  const todaysExercises = (
    ((workout as unknown as { workout_exercises?: WorkoutExercise[] })?.workout_exercises ?? [])
  )
    .filter((exercise) => exercise.day === today)
    .sort((a, b) => a.sort_order - b.sort_order);

  const todaysMeals = (
    ((meals as unknown as { meal_plan_items?: MealPlanItem[] })?.meal_plan_items ?? [])
  )
    .filter((item) => item.day === today)
    .sort((a, b) => a.sort_order - b.sort_order);

  const daysToPayment = daysUntil(member.next_payment_date);

  return (
    <div className="space-y-4">
      <BroadcastBanner broadcasts={(broadcasts ?? []) as BroadcastMessage[]} />

      <section>
        <p className="nova-label">Welcome back</p>
        <h1 className="font-display text-3xl font-black uppercase tracking-tight">
          {member.full_name.split(" ")[0]}
        </h1>
        <span className="mt-1.5 block h-[3px] w-10 rounded-full bg-nova-red" />
      </section>

      {/* ------------------------------------------------------- membership */}
      <section className="nova-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="nova-label">Membership</p>
            <p className="mt-1 font-display text-lg font-bold text-nova-red">
              No. {member.membership_id}
            </p>
          </div>
          <StatusPill status={member.status} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="nova-label">Current Period</p>
            <p className="mt-1 font-medium">
              {member.membership_start
                ? `${formatDate(member.membership_start)} – ${formatDate(member.membership_end)}`
                : "Not active"}
            </p>
          </div>
          <div>
            <p className="nova-label">Next Payment</p>
            <p className="mt-1 font-medium">{formatDate(member.next_payment_date)}</p>
          </div>
        </div>

        {daysToPayment !== null && daysToPayment <= 7 && (
          <p
            className={`mt-3 rounded-xl border p-3 text-sm ${
              daysToPayment < 0
                ? "border-nova-red/40 bg-nova-red/10 text-nova-red"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300"
            }`}
          >
            {daysToPayment < 0
              ? `Payment overdue by ${Math.abs(daysToPayment)} day(s). Please pay at reception to restore access.`
              : daysToPayment === 0
                ? "Your monthly payment is due today."
                : `Your monthly payment is due in ${daysToPayment} day(s).`}
          </p>
        )}

        {gymSettings && gymSettings.monthly_membership_fee > 0 && (
          <p className="mt-3 text-xs text-nova-muted">
            Monthly fee: {formatMoney(gymSettings.monthly_membership_fee, currency)}
          </p>
        )}
      </section>

      {/* ---------------------------------------------------- today's plans */}
      <section className="nova-card">
        <div className="flex items-center justify-between">
          <p className="nova-label">Today&apos;s Workout</p>
          {workout && (
            <Link href="/member/workout" className="text-xs text-nova-red">
              View Full Plan
            </Link>
          )}
        </div>

        {todaysExercises.length === 0 ? (
          <p className="mt-3 text-sm text-nova-muted">
            {workout ? "Rest day — nothing scheduled." : "No workout plan assigned yet."}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {todaysExercises.map((exercise) => (
              <li key={exercise.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{exercise.exercise_name}</span>
                <span className="shrink-0 text-nova-muted">
                  {exercise.sets && exercise.reps
                    ? `${exercise.sets} × ${exercise.reps}`
                    : (exercise.duration ?? "—")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="nova-card">
        <div className="flex items-center justify-between">
          <p className="nova-label">Today&apos;s Meal Plan</p>
          {meals && (
            <Link href="/member/meal-plan" className="text-xs text-nova-red">
              View Full Plan
            </Link>
          )}
        </div>

        {todaysMeals.length === 0 ? (
          <p className="mt-3 text-sm text-nova-muted">No meal plan assigned yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {todaysMeals.map((item) => (
              <li key={item.id} className="text-sm">
                <span className="font-medium capitalize">{item.meal_type}</span>
                <span className="block text-nova-muted">{item.description}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* -------------------------------------------------- payment history */}
      <section className="nova-card">
        <p className="nova-label">Payment History</p>

        {(payments ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-nova-muted">No payments recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-nova-border/60">
            {(payments as Payment[]).map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span>
                  <span className="block font-medium">
                    {PAYMENT_TYPE_LABELS[payment.payment_type]}
                  </span>
                  <span className="block text-xs text-nova-muted">
                    {formatDate(payment.payment_date)}
                  </span>
                </span>
                <span className="font-medium tabular-nums">
                  {formatMoney(payment.amount, payment.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {gymSettings?.whatsapp_url && (
        <a
          href={gymSettings.whatsapp_url}
          target="_blank"
          rel="noopener noreferrer"
          className="nova-btn w-full bg-emerald-600 text-white hover:bg-emerald-700"
        >
          WhatsApp Us
        </a>
      )}
    </div>
  );
}
