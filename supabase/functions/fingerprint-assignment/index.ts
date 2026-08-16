// POST /functions/v1/fingerprint-assignment
//
// The device half of fingerprint enrollment. Actions:
//   poll     -> is there an enrollment request waiting for this device?
//   report   -> the R503Pro finished; here is the slot it allocated
//   removed  -> the slot was deleted from the sensor
//
// The dashboard side (creating/cancelling requests) goes through RLS on
// `enrollment_requests` directly and does not need this function.

import { authenticateDevice, corsHeaders, json, markSeen, serviceClient } from "../_shared/device.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabase = serviceClient();

  let body: {
    device_id: string;
    action: "poll" | "report" | "removed";
    request_id?: string;
    fingerprint_id?: number;
    success?: boolean;
    error?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const device = await authenticateDevice(supabase, req, body.device_id);
  if (!device) return json({ error: "device_unauthorized" }, 401);
  await markSeen(supabase, device.id);

  await supabase.rpc("expire_stale_enrollments");

  if (body.action === "poll") {
    const { data: request } = await supabase
      .from("enrollment_requests")
      .select("id, member_id, status, members(full_name, membership_id)")
      .eq("device_id", device.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!request) return json({ enrollment: null });

    await supabase
      .from("enrollment_requests")
      .update({ status: "in_progress" })
      .eq("id", request.id);

    const member = request.members as unknown as
      { full_name: string; membership_id: string } | null;

    return json({
      enrollment: {
        request_id: request.id,
        member_name: member?.full_name ?? "",
        membership_id: member?.membership_id ?? "",
        // The device picks the free slot itself and reports it back.
      },
    });
  }

  if (body.action === "report") {
    if (!body.request_id) return json({ error: "missing_request_id" }, 400);

    const { data: request } = await supabase
      .from("enrollment_requests")
      .select("id, member_id, device_id, status")
      .eq("id", body.request_id)
      .eq("device_id", device.id)
      .maybeSingle();

    if (!request) return json({ error: "unknown_request" }, 404);

    if (!body.success || typeof body.fingerprint_id !== "number") {
      await supabase
        .from("enrollment_requests")
        .update({ status: "failed", error_message: body.error ?? "Enrollment failed" })
        .eq("id", request.id);
      return json({ ok: true, assigned: false });
    }

    // If this sensor slot is being reused, drop the previous owner's mapping
    // first (spec §60) — the historical attendance rows are left untouched.
    await supabase
      .from("members")
      .update({ fingerprint_id: null, fingerprint_device_id: null })
      .eq("fingerprint_device_id", device.id)
      .eq("fingerprint_id", body.fingerprint_id)
      .neq("id", request.member_id);

    const { error } = await supabase
      .from("members")
      .update({ fingerprint_id: body.fingerprint_id, fingerprint_device_id: device.id })
      .eq("id", request.member_id);

    if (error) {
      await supabase
        .from("enrollment_requests")
        .update({ status: "failed", error_message: error.message })
        .eq("id", request.id);
      return json({ error: "assignment_failed", detail: error.message }, 500);
    }

    await supabase
      .from("enrollment_requests")
      .update({ status: "completed", fingerprint_id: body.fingerprint_id })
      .eq("id", request.id);

    return json({ ok: true, assigned: true });
  }

  if (body.action === "removed") {
    if (typeof body.fingerprint_id !== "number") {
      return json({ error: "missing_fingerprint_id" }, 400);
    }
    await supabase
      .from("members")
      .update({ fingerprint_id: null, fingerprint_device_id: null })
      .eq("fingerprint_device_id", device.id)
      .eq("fingerprint_id", body.fingerprint_id);

    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
});
