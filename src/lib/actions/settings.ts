"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, requireSuperAdmin } from "@/lib/auth/session";
import type { ActionResult } from "./members";

const settingsSchema = z.object({
  gym_name: z.string().trim().min(1),
  // Left blank until the gym supplies the official number (spec §54).
  whatsapp_url: z.string().trim().url().optional().or(z.literal("")),
  phone: z.string().trim().optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  address: z.string().trim().optional().or(z.literal("")),
  logo_path: z.string().trim().optional().or(z.literal("")),
  monthly_membership_fee: z.coerce.number().min(0),
  registration_fee: z.coerce.number().min(0),
  currency: z.string().trim().min(1).max(5),
  scan_cooldown_seconds: z.coerce.number().int().min(0).max(600),
});

export async function updateGymSettings(formData: FormData): Promise<ActionResult> {
  const session = await requireStaff();

  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { data: current } = await supabase.from("gym_settings").select("id").single();

  const { error } = await supabase
    .from("gym_settings")
    .update({
      ...parsed.data,
      whatsapp_url: parsed.data.whatsapp_url || null,
      logo_path: parsed.data.logo_path || null,
      updated_by: session.profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", current!.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/settings");
  revalidatePath("/member");
  return { ok: true };
}

const broadcastSchema = z.object({
  title: z.string().trim().min(2),
  message: z.string().trim().min(2),
  banner_type: z.enum(["info", "success", "warning", "danger"]),
  dismissible: z.coerce.boolean(),
  start_at: z.string().min(1),
  end_at: z.string().optional().or(z.literal("")),
});

export async function saveBroadcast(
  formData: FormData,
  broadcastId?: string,
): Promise<ActionResult> {
  const session = await requireStaff();

  const raw = Object.fromEntries(formData);
  const parsed = broadcastSchema.safeParse({
    ...raw,
    dismissible: raw.dismissible === "on" || raw.dismissible === "true",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const payload = {
    ...parsed.data,
    end_at: parsed.data.end_at || null,
  };

  const { error } = broadcastId
    ? await supabase.from("broadcast_messages").update(payload).eq("id", broadcastId)
    : await supabase
        .from("broadcast_messages")
        .insert({ ...payload, created_by: session.profile.id });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/broadcasts");
  revalidatePath("/member");
  return { ok: true };
}

export async function setBroadcastActive(id: string, isActive: boolean): Promise<ActionResult> {
  await requireStaff();
  const supabase = createClient();

  const { error } = await supabase
    .from("broadcast_messages")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/broadcasts");
  return { ok: true };
}

/** Soft delete — history is kept (spec §57). */
export async function archiveBroadcast(id: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = createClient();

  const { error } = await supabase
    .from("broadcast_messages")
    .update({ archived_at: new Date().toISOString(), is_active: false })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/broadcasts");
  return { ok: true };
}

/** Super admin only: invite an admin by email; they sign in with a magic link. */
export async function setAdminActive(profileId: string, isActive: boolean): Promise<ActionResult> {
  await requireSuperAdmin();
  const supabase = createClient();

  const { error } = await supabase.rpc("set_profile_active", {
    p_profile_id: profileId,
    p_is_active: isActive,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/admins");
  return { ok: true };
}

export async function setUserRole(
  profileId: string,
  role: "admin" | "user",
): Promise<ActionResult> {
  await requireSuperAdmin();
  const supabase = createClient();

  // The lock-out guards (no self-demotion, no demoting another super admin) and
  // the audit entry all live in the RPC, so they hold no matter who calls it.
  const { error } = await supabase.rpc("set_user_role", {
    p_profile_id: profileId,
    p_role: role,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/admins");
  return { ok: true };
}
