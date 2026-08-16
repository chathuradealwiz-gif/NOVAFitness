// POST /functions/v1/attendance
//
// The door decision + attendance record. Called by the ESP32 for every scan, and
// replayed from the device's offline queue when 4G returns.
//
// Idempotent: `event_id` is generated on the device and is UNIQUE in Postgres, so
// a replayed queue can never double-insert.

import { authenticateDevice, corsHeaders, json, markSeen, serviceClient } from "../_shared/device.ts";

interface AttendancePayload {
  device_id: string;      // device_code, e.g. "GYM-001"
  event_id: string;       // device-generated unique id
  fingerprint_id: number;
  event_type: "entry" | "exit";
  timestamp: string;      // ISO 8601
  offline?: boolean;      // true when replayed from the local queue
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabase = serviceClient();

  let payload: AttendancePayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { device_id, event_id, fingerprint_id, event_type, timestamp } = payload;

  if (!device_id || !event_id || typeof fingerprint_id !== "number" ||
      !["entry", "exit"].includes(event_type) || !timestamp) {
    return json({ error: "invalid_payload" }, 400);
  }
  if (Number.isNaN(Date.parse(timestamp))) {
    return json({ error: "invalid_timestamp" }, 400);
  }

  const device = await authenticateDevice(supabase, req, device_id);
  if (!device) return json({ error: "device_unauthorized" }, 401);

  await markSeen(supabase, device.id);

  // Already recorded — replayed queue entry. Return the original decision.
  const { data: existing } = await supabase
    .from("attendance")
    .select("id, authorized, denial_reason")
    .eq("event_id", event_id)
    .maybeSingle();

  if (existing) {
    return json({
      duplicate: true,
      access_granted: existing.authorized,
      reason: existing.denial_reason ?? "OK",
    });
  }

  // Resolve the biometric slot to a member. The slot is only unique per device.
  const { data: member } = await supabase
    .from("members")
    .select("id, full_name, membership_id, status, membership_end")
    .eq("fingerprint_device_id", device.id)
    .eq("fingerprint_id", fingerprint_id)
    .maybeSingle();

  if (!member) {
    await supabase.from("attendance").insert({
      event_id,
      fingerprint_id,
      device_id: device.id,
      event_type,
      occurred_at: timestamp,
      authorized: false,
      denial_reason: "FINGERPRINT_NOT_REGISTERED",
      offline_event: payload.offline ?? false,
    });
    return json({
      access_granted: false,
      reason: "FINGERPRINT_NOT_REGISTERED",
      message: "Fingerprint Not Registered",
    });
  }

  // Single source of truth for the door decision (spec §61).
  const { data: decision } = await supabase
    .rpc("member_access_decision", { p_member_id: member.id })
    .single();

  const allowed = decision?.allowed ?? false;
  const reason = decision?.reason ?? "UNKNOWN";

  // Suppress duplicate scans inside the configured cooldown window.
  const { data: settings } = await supabase
    .from("gym_settings")
    .select("scan_cooldown_seconds")
    .maybeSingle();

  const cooldown = settings?.scan_cooldown_seconds ?? 30;
  const since = new Date(Date.parse(timestamp) - cooldown * 1000).toISOString();

  const { data: recent } = await supabase
    .from("attendance")
    .select("id")
    .eq("member_id", member.id)
    .eq("event_type", event_type)
    .gte("occurred_at", since)
    .limit(1)
    .maybeSingle();

  if (recent) {
    return json({
      duplicate: true,
      access_granted: allowed,
      reason,
      member_name: member.full_name,
    });
  }

  const { error } = await supabase.from("attendance").insert({
    event_id,
    member_id: member.id,
    fingerprint_id,
    device_id: device.id,
    event_type,
    occurred_at: timestamp,
    authorized: allowed,
    denial_reason: allowed ? null : reason,
    offline_event: payload.offline ?? false,
  });

  // Unique violation = the device retried after a lost response. Not an error.
  if (error && error.code !== "23505") {
    return json({ error: "insert_failed", detail: error.message }, 500);
  }

  return json({
    access_granted: allowed,
    reason,
    member_name: member.full_name,
    membership_id: member.membership_id,
    membership_end: member.membership_end,
    message: allowed ? "Welcome" : denialMessage(reason),
  });
});

/** Text shown on the 240x320 TFT — must stay short. */
function denialMessage(reason: string): string {
  switch (reason) {
    case "MEMBERSHIP_EXPIRED":  return "Membership Expired";
    case "MEMBERSHIP_SUSPENDED":return "Membership Suspended";
    case "MEMBERSHIP_INACTIVE": return "Account Inactive";
    case "NO_MEMBERSHIP":       return "No Active Membership";
    default:                    return "Access Denied";
  }
}
