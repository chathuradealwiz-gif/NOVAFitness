"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, requireSuperAdmin } from "@/lib/auth/session";
import type { ActionResult } from "./members";
import type { Member, MemberStatus, Payment } from "@/types/database";

const paymentSchema = z.object({
  member_id: z.string().uuid(),
  payment_type: z.enum(["registration", "monthly_membership", "personal_coaching", "other"]),
  amount: z.coerce.number().min(0, "Amount cannot be negative"),
  payment_date: z.string().min(1, "Payment date is required"),
  // Membership periods are computed by the database when left blank (spec §42).
  period_start: z.string().optional().or(z.literal("")),
  period_end: z.string().optional().or(z.literal("")),
  coach_name: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
});

/**
 * Records an offline (cash) payment. For monthly membership this also extends the
 * membership period and reactivates the member — handled by database triggers so
 * the rule holds no matter which client writes the row (spec §45, §61).
 */
export async function recordPayment(formData: FormData): Promise<ActionResult> {
  const session = await requireStaff();

  const parsed = paymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const input = parsed.data;
  const supabase = createClient();

  const { error } = await supabase.from("payments").insert({
    member_id: input.member_id,
    payment_type: input.payment_type,
    amount: input.amount,
    payment_date: input.payment_date,
    period_start: input.period_start || null,
    period_end: input.period_end || null,
    coach_name: input.coach_name || null,
    description: input.description || null,
    recorded_by: session.profile.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/members/${input.member_id}`);
  revalidatePath("/dashboard/payments");
  revalidatePath("/dashboard/pay");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Void or refund. Financial records are never deleted — the row stays and the
 * status change is written to financial_audit_logs by a trigger (spec §44, §49).
 * Super admin only (spec §48).
 */
export async function voidPayment(
  paymentId: string,
  status: "voided" | "refunded",
  reason: string,
): Promise<ActionResult> {
  await requireSuperAdmin();

  if (!reason.trim()) {
    return { ok: false, error: "A reason is required to void or refund a payment." };
  }

  const supabase = createClient();

  // Via RPC: financial_audit_logs is not writable from the browser, so the status
  // change and its reason are applied together server-side.
  const { data, error } = await supabase.rpc("void_payment", {
    p_payment_id: paymentId,
    p_status: status,
    p_reason: reason.trim(),
  });

  if (error) return { ok: false, error: error.message };

  const result = data as unknown as { member_id: string };

  revalidatePath(`/dashboard/members/${result.member_id}`);
  revalidatePath("/dashboard/payments");
  return { ok: true };
}

/* ------------------------------------------------------------------ quick pay */
/*
 * Backing actions for /dashboard/pay. Both go through requireStaff(), so the
 * permission check does not depend on the navigation item being hidden, and both
 * reuse the existing search RPC / tables rather than introducing a second source
 * of truth for members or payments.
 */

export interface PaySearchResult {
  id: string;
  membership_id: string;
  full_name: string;
  phone: string | null;
  status: MemberStatus;
}

/** Server-side member lookup for the Pay page's search box (spec §11). */
export async function searchMembersForPay(query: string): Promise<PaySearchResult[]> {
  await requireStaff();

  const trimmed = query.trim();
  // Nothing useful to match on yet — never fall back to "load every member".
  if (trimmed.length < 2) return [];

  const supabase = createClient();
  const { data, error } = await supabase.rpc("search_members", {
    p_query: trimmed,
    p_limit: 10,
  });

  if (error) return [];

  return ((data ?? []) as Member[]).map((member) => ({
    id: member.id,
    membership_id: member.membership_id,
    full_name: member.full_name,
    phone: member.phone,
    status: member.status,
  }));
}

export interface PayContext {
  member: Member;
  payments: Payment[];
  workoutPlans: PlanSummary[];
  mealPlans: PlanSummary[];
}

export interface PlanSummary {
  id: string;
  title: string;
}

/**
 * Everything the Pay page shows for one member: summary, recent payments and
 * assigned plans. Mirrors the queries on the member detail page so both screens
 * show the same numbers.
 */
export async function getPayContext(memberId: string): Promise<PayContext | null> {
  await requireStaff();

  const supabase = createClient();

  const { data: member } = await supabase
    .from("members")
    .select("*")
    .eq("id", memberId)
    .maybeSingle();

  if (!member) return null;

  const [{ data: payments }, { data: workoutPlans }, { data: mealPlans }] = await Promise.all([
    supabase
      .from("payments")
      .select("*")
      .eq("member_id", memberId)
      .order("payment_date", { ascending: false })
      .limit(8),
    supabase
      .from("workout_plans")
      .select("id, title")
      .eq("member_id", memberId)
      .eq("status", "active"),
    supabase
      .from("meal_plans")
      .select("id, title")
      .eq("member_id", memberId)
      .eq("status", "active"),
  ]);

  return {
    member: member as Member,
    payments: (payments ?? []) as Payment[],
    workoutPlans: (workoutPlans ?? []) as PlanSummary[],
    mealPlans: (mealPlans ?? []) as PlanSummary[],
  };
}
