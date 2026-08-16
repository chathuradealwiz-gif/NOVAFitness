import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import type { MealPlan, MealPlanItem } from "@/types/database";
import { MealPlanEditor } from "../MealPlanEditor";

export default async function EditMealPlanPage({ params }: { params: { id: string } }) {
  await requireStaff();
  const supabase = createClient();

  const { data: plan } = await supabase
    .from("meal_plans")
    .select("*, members(id, full_name, membership_id)")
    .eq("id", params.id)
    .maybeSingle();

  if (!plan) notFound();

  const { data: items } = await supabase
    .from("meal_plan_items")
    .select("*")
    .eq("meal_plan_id", params.id)
    .order("sort_order");

  const member = (plan as unknown as {
    members: { id: string; full_name: string; membership_id: string };
  }).members;

  return (
    <>
      <PageHeader title="Edit Meal Plan" subtitle={(plan as MealPlan).title} />
      <MealPlanEditor
        member={member}
        plan={plan as MealPlan}
        items={(items ?? []) as MealPlanItem[]}
      />
    </>
  );
}
