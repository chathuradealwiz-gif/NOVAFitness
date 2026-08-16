"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import type { ActionResult } from "./members";

const claimSchema = z.object({
  // Plain digits. The RPC normalises leading zeros again server-side.
  membership_id: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, "").replace(/^0+/, ""))
    .refine((value) => /^[1-9]\d*$/.test(value), {
      message: "Enter your membership number, for example 34",
    }),
  full_name: z.string().trim().min(2, "Enter your full name"),
  phone: z.string().trim().min(6, "Enter your mobile number"),
});

/** First-time signup: link this account to a NOVA membership (spec §40). */
export async function claimMembership(formData: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "You are not signed in." };

  const parsed = claimSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("claim_membership", {
    p_membership_id: parsed.data.membership_id,
    p_full_name: parsed.data.full_name,
    p_phone: parsed.data.phone,
  });

  if (error) return { ok: false, error: error.message };

  const result = data as unknown as { status: string };

  if (result.status === "taken") {
    return {
      ok: false,
      error: "That membership number is already linked to another account. Please contact reception.",
    };
  }

  // Keep the auth profile's display name in step with the member record.
  await supabase
    .from("profiles")
    .update({ full_name: parsed.data.full_name, phone: parsed.data.phone })
    .eq("user_id", session.userId);

  revalidatePath("/member");
  return { ok: true, data: result };
}

const profileSchema = z.object({
  full_name: z.string().trim().min(2),
  phone: z.string().trim().min(6),
  emergency_contact: z.string().trim().optional().or(z.literal("")),
  address: z.string().trim().optional().or(z.literal("")),
});

/** Members may edit their own contact details, never their status or IDs. */
export async function updateOwnProfile(formData: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "You are not signed in." };

  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();

  // Goes through an RPC, not a direct UPDATE: members have no UPDATE policy on
  // `members`, so status and membership_id stay out of reach.
  const { error } = await supabase.rpc("update_own_member_profile", {
    p_full_name: parsed.data.full_name,
    p_phone: parsed.data.phone,
    p_emergency_contact: parsed.data.emergency_contact || null,
    p_address: parsed.data.address || null,
  });

  if (error) return { ok: false, error: error.message };

  await supabase
    .from("profiles")
    .update({ full_name: parsed.data.full_name, phone: parsed.data.phone })
    .eq("user_id", session.userId);

  revalidatePath("/member/profile");
  return { ok: true };
}

/**
 * Saves the storage path of a freshly uploaded avatar. The upload itself happens
 * directly from the browser to Supabase Storage, so the image never passes
 * through Vercel (spec §38).
 */
export async function saveProfileImage(publicUrl: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "You are not signed in." };

  const supabase = createClient();

  await supabase
    .from("profiles")
    .update({ profile_image_url: publicUrl })
    .eq("user_id", session.userId);

  const { data: member } = await supabase
    .from("members")
    .select("full_name, phone, emergency_contact, address")
    .eq("user_id", session.userId)
    .maybeSingle();

  if (!member) return { ok: false, error: "No member record found." };

  const { error } = await supabase.rpc("update_own_member_profile", {
    p_full_name: member.full_name,
    p_phone: member.phone ?? "",
    p_emergency_contact: member.emergency_contact,
    p_address: member.address,
    p_profile_image_url: publicUrl,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/member/profile");
  return { ok: true };
}
