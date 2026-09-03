// POST /functions/v1/fingerprint-template
//
// Off-device backup of biometric templates. Two actions:
//
//   store   -> the device enrolled a member; here is the template it captured
//   fetch   -> rebuilding a replacement sensor; hand back every template
//
// Deliberately its own function rather than another action on
// fingerprint-assignment: this is the only endpoint in the system that moves
// biometric data, and keeping it separate means its logs, its errors and its
// authorisation are about one thing.
//
// The blob is opaque. It is the sensor vendor's own feature encoding, not
// ISO 19794-2, so nothing here can interpret it and no matching happens
// server-side — templates only ever match on the chip. This function stores
// bytes and hands them back to the same family of sensor.

import { authenticateDevice, corsHeaders, json, markSeen, serviceClient } from "../_shared/device.ts";

interface TemplatePayload {
  device_id: string;              // device_code, e.g. "GYM-001"
  action: "store" | "fetch";
  member_id?: string;
  fingerprint_id?: number;
  sensor_model?: string;
  template?: string;              // base64, `store` only
}

// A character file is a few hundred bytes on every module in this family. The
// cap is a sanity bound against a framing bug filling the table, not a spec
// figure — a torn transfer is far likelier than a genuinely huge template.
const MAX_TEMPLATE_BYTES = 4096;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabase = serviceClient();

  let payload: TemplatePayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const device = await authenticateDevice(supabase, req, payload.device_id);
  if (!device) return json({ error: "device_unauthorized" }, 401);

  await markSeen(supabase, device.id);

  if (payload.action === "store") return store(supabase, device, payload);
  if (payload.action === "fetch") return fetch_(supabase, device, payload);

  return json({ error: "unknown_action" }, 400);
});

async function store(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  device: { id: string },
  body: TemplatePayload,
) {
  const { member_id, fingerprint_id, sensor_model, template } = body;

  if (!member_id || typeof fingerprint_id !== "number" || !sensor_model || !template) {
    return json({ error: "invalid_payload" }, 400);
  }

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(template), (c) => c.charCodeAt(0));
  } catch {
    return json({ error: "invalid_base64" }, 400);
  }

  if (bytes.length === 0 || bytes.length > MAX_TEMPLATE_BYTES) {
    return json({ error: "invalid_template_length", byte_len: bytes.length }, 400);
  }

  // The member must actually be mapped to this slot on this device. Without
  // this check a device key would be enough to write a template against any
  // member id at all.
  const { data: member } = await supabase
    .from("members")
    .select("id")
    .eq("id", member_id)
    .eq("fingerprint_device_id", device.id)
    .eq("fingerprint_id", fingerprint_id)
    .maybeSingle();

  if (!member) return json({ error: "slot_not_assigned" }, 409);

  const { error } = await supabase
    .from("fingerprint_templates")
    .upsert({
      member_id,
      device_id: device.id,
      fingerprint_id,
      sensor_model,
      // PostgREST takes bytea as a hex-escaped string.
      template: "\\x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(""),
      byte_len: bytes.length,
      updated_at: new Date().toISOString(),
    }, { onConflict: "member_id" });

  if (error) return json({ error: "store_failed", detail: error.message }, 500);

  return json({ stored: true, byte_len: bytes.length });
}

async function fetch_(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  device: { id: string },
  body: TemplatePayload,
) {
  const model = body.sensor_model;
  if (!model) return json({ error: "missing_sensor_model" }, 400);

  const { data, error } = await supabase
    .from("fingerprint_templates")
    .select("member_id, fingerprint_id, sensor_model, template, byte_len")
    .eq("device_id", device.id);

  if (error) return json({ error: "fetch_failed", detail: error.message }, 500);

  // Templates are only meaningful to the family that produced them: the R307 is
  // optical and the R503 capacitive, and a template moved between them would be
  // written happily and then never match anyone. Refuse rather than restore
  // garbage that looks like a successful recovery.
  const usable = (data ?? []).filter((row: { sensor_model: string }) => row.sensor_model === model);
  const incompatible = (data ?? []).length - usable.length;

  return json({
    templates: usable.map((row: { member_id: string; fingerprint_id: number; template: string; byte_len: number }) => ({
      member_id: row.member_id,
      fingerprint_id: row.fingerprint_id,
      byte_len: row.byte_len,
      // bytea comes back hex-escaped; the device wants base64.
      template: hexToBase64(row.template),
    })),
    incompatible,
  });
}

/** "\x41424..." as PostgREST returns bytea -> base64 for the device. */
function hexToBase64(hex: string): string {
  const clean = hex.startsWith("\\x") ? hex.slice(2) : hex;
  let out = "";
  for (let i = 0; i < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return btoa(out);
}
