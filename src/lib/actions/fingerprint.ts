"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import type { ActionResult } from "./members";

/**
 * Puts a device into enrollment mode for one member. The device polls
 * fingerprint-assignment, runs the R503Pro capture, and reports the slot back;
 * only then is the mapping written (spec "Fingerprint Enrollment").
 */
export async function requestEnrollment(
  memberId: string,
  deviceId: string,
): Promise<ActionResult> {
  const session = await requireStaff();
  const supabase = createClient();

  // Clear a stale request so the sensor is not left locked by an abandoned one.
  await supabase.rpc("expire_stale_enrollments");

  const { data: busy } = await supabase
    .from("enrollment_requests")
    .select("id, member_id")
    .eq("device_id", deviceId)
    .in("status", ["pending", "in_progress"])
    .maybeSingle();

  if (busy) {
    return {
      ok: false,
      error:
        busy.member_id === memberId
          ? "Enrollment already in progress — ask the member to scan at the device."
          : "That device is already enrolling another member.",
    };
  }

  const { data, error } = await supabase
    .from("enrollment_requests")
    .insert({ member_id: memberId, device_id: deviceId, requested_by: session.profile.id })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/members/${memberId}`);
  return { ok: true, data: { requestId: data.id } };
}

export async function cancelEnrollment(requestId: string, memberId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = createClient();

  const { error } = await supabase
    .from("enrollment_requests")
    .update({ status: "cancelled" })
    .eq("id", requestId)
    .in("status", ["pending", "in_progress"]);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/members/${memberId}`);
  return { ok: true };
}

/**
 * Unassigns the biometric slot. The member row and all historical attendance stay
 * (spec §60) — only the mapping is cleared.
 *
 * This does NOT erase the template from the sensor: the finger stops opening the
 * door (device-sync drops it from the authorisation cache) but the template stays
 * in the R503's flash and the slot is not reused. Erasing it is what the
 * fingerprint_erasures queue does, and only deleting the profile enqueues one —
 * the assumption being that an unassign is usually a re-enrollment.
 */
export async function removeFingerprint(memberId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = createClient();

  const { error } = await supabase
    .from("members")
    .update({ fingerprint_id: null, fingerprint_device_id: null })
    .eq("id", memberId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/members/${memberId}`);
  return { ok: true };
}
