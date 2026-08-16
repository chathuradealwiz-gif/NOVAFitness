"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, requireSuperAdmin } from "@/lib/auth/session";
import type { ActionResult } from "./members";

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
