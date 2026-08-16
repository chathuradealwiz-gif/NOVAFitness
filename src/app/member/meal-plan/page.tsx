import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui";
import type { MealPlan, MealPlanItem } from "@/types/database";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MEAL_ORDER = ["breakfast", "lunch", "snack", "dinner"];
const TODAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
  new Date().getDay()
];

export default async function MemberMealPlanPage() {
  const { member } = await requireMember();
  if (!member) return null;

  const supabase = createClient();
  const { data } = await supabase
    .from("meal_plans")
    .select("*, meal_plan_items(*)")
    .eq("member_id", member.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Meal Plan</h1>
        <EmptyState title="No meal plan assigned yet" hint="Ask the gym staff to set one up." />
      </div>
    );
  }

  const plan = data as unknown as MealPlan & { meal_plan_items: MealPlanItem[] };
  const items = plan.meal_plan_items ?? [];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{plan.title}</h1>
        {plan.description && <p className="mt-1 text-sm text-nova-muted">{plan.description}</p>}
      </header>

      {DAYS.map((day) => {
        const dayItems = items
          .filter((item) => item.day === day)
          .sort(
            (a, b) =>
              MEAL_ORDER.indexOf(a.meal_type) - MEAL_ORDER.indexOf(b.meal_type) ||
              a.sort_order - b.sort_order,
          );

        if (dayItems.length === 0) return null;

        return (
          <section
            key={day}
            className={`nova-card ${day === TODAY ? "nova-card-accent" : ""}`}
          >
            <p className="nova-label">
              {day[0].toUpperCase() + day.slice(1)}
              {day === TODAY && <span className="ml-2 text-nova-red">Today</span>}
            </p>

            <ul className="mt-3 space-y-3">
              {dayItems.map((item) => (
                <li key={item.id} className="text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium capitalize">{item.meal_type}</span>
                    {item.calories && (
                      <span className="shrink-0 text-xs text-nova-muted">{item.calories} kcal</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-nova-muted">{item.description}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="text-xs text-nova-muted">
        This is a gym-provided plan, not medical or dietary advice.
      </p>
    </div>
  );
}
