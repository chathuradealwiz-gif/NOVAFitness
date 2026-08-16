// POST /functions/v1/device-heartbeat
//
// Keeps the Devices page honest: firmware version, 4G status and how many events
// are still sitting in the device's offline queue.

import { authenticateDevice, corsHeaders, json, markSeen, serviceClient } from "../_shared/device.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabase = serviceClient();

  let body: {
    device_id: string;
    firmware_version?: string;
    network_status?: string;
    pending_events?: number;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const device = await authenticateDevice(supabase, req, body.device_id);
  if (!device) return json({ error: "device_unauthorized" }, 401);

  await markSeen(supabase, device.id, {
    firmware_version: body.firmware_version ?? null,
    network_status: body.network_status ?? null,
    pending_events: Math.max(0, body.pending_events ?? 0),
  });

  // The device has no RTC battery; it trusts the server clock.
  return json({ ok: true, server_time: new Date().toISOString() });
});
