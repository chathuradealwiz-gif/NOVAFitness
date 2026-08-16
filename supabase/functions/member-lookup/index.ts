// POST /functions/v1/member-lookup
//
// Read-only lookup for the device: "who is fingerprint 37 and may they come in?".
// Used by the TFT admin menu and to warm the offline cache after a slot change,
// without granting the device any write access.

import { authenticateDevice, corsHeaders, json, serviceClient } from "../_shared/device.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabase = serviceClient();

  let body: { device_id: string; fingerprint_id?: number; membership_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const device = await authenticateDevice(supabase, req, body.device_id);
  if (!device) return json({ error: "device_unauthorized" }, 401);

  let query = supabase
    .from("members")
    .select("id, membership_id, full_name, status, membership_end, fingerprint_id");

  if (typeof body.fingerprint_id === "number") {
    query = query.eq("fingerprint_device_id", device.id).eq("fingerprint_id", body.fingerprint_id);
  } else if (body.membership_id) {
    query = query.eq("membership_id", body.membership_id);
  } else {
    return json({ error: "missing_lookup_key" }, 400);
  }

  const { data: member } = await query.maybeSingle();
  if (!member) return json({ found: false });

  const { data: decision } = await supabase
    .rpc("member_access_decision", { p_member_id: member.id })
    .single();

  return json({
    found: true,
    member: {
      membership_id: member.membership_id,
      name: member.full_name,
      status: member.status,
      membership_end: member.membership_end,
      fingerprint_id: member.fingerprint_id,
    },
    access_granted: decision?.allowed ?? false,
    reason: decision?.reason ?? "UNKNOWN",
  });
});
