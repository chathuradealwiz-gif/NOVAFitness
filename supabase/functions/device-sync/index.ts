// POST /functions/v1/device-sync
//
// Three jobs in one round trip, because 4G round trips are expensive:
//   1. drain the device's offline attendance queue (idempotent, per event)
//   2. hand back the authorisation cache the device uses while offline
//   3. hand back the slots whose templates must be erased from the sensor
//
// The cache holds only { fingerprint_id, allowed, name } — no biometric data.
//
// (3) is how a deleted member's biometric data actually leaves the building.
// Dropping them from the cache only makes the door say no; the template stays in
// the sensor's flash until it is told to delete that slot. The device confirms
// each erasure back in `erased`, and only then is the queue row closed — so a
// device that loses power mid-erase is handed the same slot again next sync.

import { authenticateDevice, corsHeaders, json, markSeen, serviceClient } from "../_shared/device.ts";

// The device's answer to a Wi-Fi command handed out on an earlier sync: a
// scan's results, or whether a switch took.
interface WifiReport {
  id?: string;
  ok?: boolean;
  error?: string | null;
  ssid?: string | null;
  networks?: { ssid: string; rssi: number }[];
}

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

  let body: {
    device_id: string;
    events?: QueuedEvent[];
    erased?: number[];
    wifi?: WifiReport;
  };
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

  // Close out the slots the device says it has erased, before handing back what
  // is still outstanding.
  const confirmed = (body.erased ?? [])
    .filter((slot) => Number.isInteger(slot))
    .slice(0, 200);

  if (confirmed.length) {
    await supabase
      .from("fingerprint_erasures")
      .update({ erased_at: new Date().toISOString() })
      .eq("device_id", device.id)
      .is("erased_at", null)
      .in("fingerprint_id", confirmed);
  }

  const { data: pendingErasures } = await supabase
    .from("fingerprint_erasures")
    .select("fingerprint_id")
    .eq("device_id", device.id)
    .is("erased_at", null)
    .limit(50);

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

  // --- Wi-Fi: close out the last command, then hand over the next ----------
  //
  // Report first, so a device that answers and is immediately given another
  // command does both in the right order, and a scan's results are on the
  // device row before the dashboard is told the command finished.
  const seenFields: Record<string, unknown> = {
    last_sync_at: new Date().toISOString(),
    pending_events: 0,
  };

  const report = body.wifi;
  if (report && typeof report === "object") {
    if (Array.isArray(report.networks)) {
      seenFields.wifi_networks = report.networks
        .filter((n) => n && typeof n.ssid === "string")
        .slice(0, 30)
        .map((n) => ({ ssid: n.ssid.slice(0, 64), rssi: Number(n.rssi) || null }));
      seenFields.wifi_networks_at = new Date().toISOString();
    }
    if (report.id) {
      await supabase
        .from("device_wifi_commands")
        .update({
          status: report.ok ? "done" : "failed",
          // A switch reports which network it ended up on, which is the useful
          // half of a failure: "could not join X, still on Y".
          result: report.ok
            ? (report.ssid ? `connected to ${report.ssid}` : "done")
            : (report.error ?? "failed"),
          completed_at: new Date().toISOString(),
          // The credential has been used or has failed; either way it has no
          // business staying in the database.
          password: null,
        })
        .eq("id", report.id)
        .eq("device_id", device.id);
    }
  }

  await markSeen(supabase, device.id, seenFields);

  // Anything not collected within the window is dead - see the migration.
  await supabase.rpc("expire_stale_wifi_commands");

  const { data: command } = await supabase
    .from("device_wifi_commands")
    .select("id, action, ssid, password")
    .eq("device_id", device.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (command) {
    // Marked sent before the response leaves, so a device that collects a
    // command and then loses power does not get handed it again on every sync
    // for the next quarter of an hour. It expires instead.
    await supabase
      .from("device_wifi_commands")
      .update({ status: "sent", delivered_at: new Date().toISOString() })
      .eq("id", command.id);
  }

  return json({
    accepted,
    rejected: events.filter((e) => !accepted.includes(e.event_id)).map((e) => e.event_id),
    server_time: new Date().toISOString(),
    cache,
    erase: (pendingErasures ?? []).map((row) => row.fingerprint_id),
    wifi_command: command
      ? {
          id: command.id,
          action: command.action,
          ssid: command.ssid,
          password: command.password,
        }
      : null,
  });
});
