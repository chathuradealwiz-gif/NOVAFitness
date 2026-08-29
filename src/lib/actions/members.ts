"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import type { MemberStatus } from "@/types/database";

export interface ActionResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

// The gym's member number: plain digits, e.g. 34, 56, 789, 1500.
// Leading zeros are stripped so "034" and "34" can never become two members.
// Also enforced by a CHECK constraint and the UNIQUE index in Postgres.
const membershipIdSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, "").replace(/^0+/, ""))
  .refine((value) => /^[1-9]\d*$/.test(value), {
    message: "Membership number must be digits, for example 34",
  });

const memberSchema = z.object({
  membership_id: membershipIdSchema,
  full_name: z.string().trim().min(2, "Full name is required"),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().min(6, "A contact number is required"),
  date_of_birth: z.string().optional().or(z.literal("")),
  gender: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
});

function clean<T extends Record<string, unknown>>(input: T): T {
  // Empty strings become NULL so optional date/text columns stay clean.
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => [k, v === "" ? null : v]),
  ) as T;
}

export async function createMember(formData: FormData): Promise<ActionResult> {
  await requireStaff();

  const parsed = memberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("members")
    .insert(clean(parsed.data))
    .select("id")
    .single();

  if (error) {
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "That membership number is already in use."
          : error.message,
    };
  }

  revalidatePath("/dashboard/members");
  return { ok: true, data: { id: data.id } };
}

export async function updateMember(memberId: string, formData: FormData): Promise<ActionResult> {
  await requireStaff();

  const parsed = memberSchema.partial().safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const supabase = createClient();
  const { error } = await supabase.from("members").update(clean(parsed.data)).eq("id", memberId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/members/${memberId}`);
  return { ok: true };
}

/**
 * Manual status override. The payment history normally drives status, so the
 * reason is mandatory and lands in the audit log (spec §41, §45).
 */
export async function changeMemberStatus(
  memberId: string,
  status: MemberStatus,
  reason: string,
): Promise<ActionResult> {
  await requireStaff();

  if (!reason.trim()) {
    return { ok: false, error: "A reason is required for a manual status change." };
  }

  const supabase = createClient();

  // One RPC, because the audit row cannot be written from the browser: audit_logs
  // has no client INSERT policy, so the status change and its reason must be
  // recorded together server-side.
  const { error } = await supabase.rpc("change_member_status", {
    p_member_id: memberId,
    p_status: status,
    p_reason: reason.trim(),
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/members/${memberId}`);
  revalidatePath("/dashboard/members");
  return { ok: true };
}

/** Suggests the next free member number for the "add member" form. */
export async function suggestMembershipId(): Promise<string> {
  await requireStaff();
  const supabase = createClient();
  const { data } = await supabase.rpc("next_membership_id");
  return (data as unknown as string) ?? "1";
}
