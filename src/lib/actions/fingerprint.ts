"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import type { ActionResult } from "./members";
import type { EnrollmentRequest } from "@/types/database";

/**
 * Puts a device into enrollment mode for one member. The device polls
 * fingerprint-assignment, runs the sensor capture, and reports the slot back;
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
 * This also queues the template for erasure from the sensor. It has to happen
 * here rather than later: the slot number lives only in the columns this clears,
 * so once they are null nothing in the database knows which slot to erase — and
 * a re-enrollment does not reclaim it either, because the terminal allocates the
 * next FREE slot, leaving the old template in the sensor's flash for good.
 *
 * The queue is drained by device-sync, which hands the slot to the terminal on
 * its next round trip.
 */
export async function removeFingerprint(memberId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = createClient();

  const { error } = await supabase.rpc("unassign_fingerprint", {
    p_member_id: memberId,
  });

  if (error) {
    return {
      ok: false,
      error:
        error.code === "42501"
          ? "Only staff can unassign a fingerprint."
          : error.message,
    };
  }

  revalidatePath(`/dashboard/members/${memberId}`);
  return { ok: true };
}

/**
 * The member's in-flight enrolment and current slot, for polling.
 *
 * The member page gets both from its own server render and refreshes the route
 * to follow a capture. The signup wizard cannot: it lives on /members/new,
 * which knows nothing about a member created a moment ago in the browser, so
 * refreshing that route would poll forever against a null enrolment. This reads
 * the two rows directly instead.
 */
export async function getEnrollmentState(memberId: string): Promise<{
  enrollment: EnrollmentRequest | null;
  fingerprintId: number | null;
}> {
  await requireStaff();
  const supabase = createClient();

  const [{ data: enrollment }, { data: member }] = await Promise.all([
    supabase
      .from("enrollment_requests")
      .select("*")
      .eq("member_id", memberId)
      .in("status", ["pending", "in_progress"])
      .maybeSingle(),
    supabase.from("members").select("fingerprint_id").eq("id", memberId).maybeSingle(),
  ]);

  return {
    enrollment: (enrollment as EnrollmentRequest) ?? null,
    fingerprintId: (member?.fingerprint_id as number | null) ?? null,
  };
}
