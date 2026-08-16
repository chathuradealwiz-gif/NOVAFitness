// POST /functions/v1/device-sync
//
// Two jobs in one round trip, because 4G round trips are expensive:
//   1. drain the device's offline attendance queue (idempotent, per event)
//   2. hand back the authorisation cache the device uses while offline
//
// The cache holds only { fingerprint_id, allowed, name } — no biometric data.

import { authenticateDevice, corsHeaders, json, markSeen, serviceClient } from "../_shared/device.ts";

interface QueuedEvent {
  event_id: string;
  fingerprint_id: number;
  event_type: "entry" | "exit";
  timestamp: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabase = serviceClient();

  let body: { device_id: string; events?: QueuedEvent[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const device = await authenticateDevice(supabase, req, body.device_id);
  if (!device) return json({ error: "device_unauthorized" }, 401);

  const events = (body.events ?? []).slice(0, 200); // bound the batch size
  const accepted: string[] = [];

  for (const ev of events) {
    if (!ev?.event_id || typeof ev.fingerprint_id !== "number") continue;
    if (Number.isNaN(Date.parse(ev.timestamp ?? ""))) continue;

    const { data: member } = await supabase
      .from("members")
      .select("id")
      .eq("fingerprint_device_id", device.id)
      .eq("fingerprint_id", ev.fingerprint_id)
      .maybeSingle();

    const { error } = await supabase.from("attendance").insert({
      event_id: ev.event_id,
      member_id: member?.id ?? null,
      fingerprint_id: ev.fingerprint_id,
      device_id: device.id,
      event_type: ev.event_type,
      occurred_at: ev.timestamp,
      // The door already opened offline; this row is the historical record of it.
      authorized: Boolean(member),
      denial_reason: member ? null : "FINGERPRINT_NOT_REGISTERED",
      offline_event: true,
      sync_status: "synced",
    });

    // 23505 = already synced on an earlier attempt. Still counts as accepted so
    // the device can drop it from its queue.
    if (!error || error.code === "23505") accepted.push(ev.event_id);
  }

  // Rebuild the offline authorisation cache for this device.
  const { data: enrolled } = await supabase
    .from("members")
    .select("fingerprint_id, full_name, status, membership_end")
    .eq("fingerprint_device_id", device.id)
    .not("fingerprint_id", "is", null);

  const today = new Date().toISOString().slice(0, 10);
  const cache = (enrolled ?? []).map((m) => ({
    fingerprint_id: m.fingerprint_id,
    name: (m.full_name ?? "").slice(0, 20),
    allowed: m.status === "active" && !!m.membership_end && m.membership_end >= today,
  }));

  await markSeen(supabase, device.id, {
    last_sync_at: new Date().toISOString(),
    pending_events: 0,
  });

  return json({
    accepted,
    rejected: events.filter((e) => !accepted.includes(e.event_id)).map((e) => e.event_id),
    server_time: new Date().toISOString(),
    cache,
  });
});
