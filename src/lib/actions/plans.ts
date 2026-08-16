"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import type { ActionResult } from "./members";

import { DAYS } from "@/lib/constants";

const exerciseSchema = z.object({
  day: z.enum(DAYS),
  exercise_name: z.string().trim().min(1),
  sets: z.coerce.number().int().min(0).optional().nullable(),
  reps: z.string().trim().optional().nullable(),
  duration: z.string().trim().optional().nullable(),
  weight: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

const workoutSchema = z.object({
  member_id: z.string().uuid(),
  title: z.string().trim().min(2, "Give the plan a title"),
  description: z.string().trim().optional().nullable(),
  trainer_name: z.string().trim().optional().nullable(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  exercises: z.array(exerciseSchema).min(1, "Add at least one exercise"),
});

export async function saveWorkoutPlan(
  input: z.input<typeof workoutSchema>,
  planId?: string,
): Promise<ActionResult> {
  const session = await requireStaff();

  const parsed = workoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const { exercises, ...plan } = parsed.data;
  const supabase = createClient();

  let id = planId;

  if (id) {
    const { error } = await supabase.from("workout_plans").update(plan).eq("id", id);
    if (error) return { ok: false, error: error.message };
    // Exercises are replaced wholesale — simpler than diffing, and the lists are small.
    await supabase.from("workout_exercises").delete().eq("workout_plan_id", id);
  } else {
    const { data, error } = await supabase
      .from("workout_plans")
      .insert({ ...plan, assigned_by: session.profile.id })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    id = data.id;
  }

  const { error } = await supabase.from("workout_exercises").insert(
    exercises.map((exercise, index) => ({
      ...exercise,
      workout_plan_id: id!,
      sort_order: index,
    })),
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/members/${plan.member_id}`);
  revalidatePath("/member/workout");
  return { ok: true, data: { id } };
}

const mealItemSchema = z.object({
  day: z.enum(DAYS),
  meal_type: z.enum(["breakfast", "lunch", "snack", "dinner"]),
  description: z.string().trim().min(1),
  calories: z.coerce.number().int().min(0).optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

const mealSchema = z.object({
  member_id: z.string().uuid(),
  title: z.string().trim().min(2, "Give the plan a title"),
  description: z.string().trim().optional().nullable(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  items: z.array(mealItemSchema).min(1, "Add at least one meal"),
});

export async function saveMealPlan(
  input: z.input<typeof mealSchema>,
  planId?: string,
): Promise<ActionResult> {
  const session = await requireStaff();

  const parsed = mealSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const { items, ...plan } = parsed.data;
  const supabase = createClient();

  let id = planId;

  if (id) {
    const { error } = await supabase.from("meal_plans").update(plan).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await supabase.from("meal_plan_items").delete().eq("meal_plan_id", id);
  } else {
    const { data, error } = await supabase
      .from("meal_plans")
      .insert({ ...plan, assigned_by: session.profile.id })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    id = data.id;
  }

  const { error } = await supabase.from("meal_plan_items").insert(
    items.map((item, index) => ({ ...item, meal_plan_id: id!, sort_order: index })),
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/members/${plan.member_id}`);
  revalidatePath("/member/meal-plan");
  return { ok: true, data: { id } };
}

export async function archivePlan(
  table: "workout_plans" | "meal_plans",
  planId: string,
  memberId: string,
): Promise<ActionResult> {
  await requireStaff();
  const supabase = createClient();

  const { error } = await supabase.from(table).update({ status: "archived" }).eq("id", planId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/members/${memberId}`);
  return { ok: true };
}
