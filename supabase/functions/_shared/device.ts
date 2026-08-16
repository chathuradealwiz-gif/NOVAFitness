// Shared helpers for the device-facing Edge Functions.
//
// The ESP32 never holds the service-role key. It authenticates with a per-device
// key sent as `x-device-key`; only the SHA-256 hash of that key is stored in
// `devices.api_key_hash`.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-device-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison, so a wrong key leaks no timing information. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface Device {
  id: string;
  device_code: string;
  status: string;
}

/**
 * Resolves and authenticates the calling device.
 * Returns null when the device is unknown, disabled or the key does not match.
 */
export async function authenticateDevice(
  supabase: SupabaseClient,
  req: Request,
  deviceCode: string | undefined,
): Promise<Device | null> {
  const key = req.headers.get("x-device-key");
  if (!key || !deviceCode) return null;

  const { data: device } = await supabase
    .from("devices")
    .select("id, device_code, status, api_key_hash")
    .eq("device_code", deviceCode)
    .maybeSingle();

  if (!device || device.status === "disabled" || !device.api_key_hash) return null;
  if (!timingSafeEqual(await sha256(key), device.api_key_hash)) return null;

  return { id: device.id, device_code: device.device_code, status: device.status };
}

/** Marks the device as seen; cheap enough to call on every request. */
export async function markSeen(
  supabase: SupabaseClient,
  deviceId: string,
  extra: Record<string, unknown> = {},
) {
  await supabase
    .from("devices")
    .update({ status: "online", last_seen_at: new Date().toISOString(), ...extra })
    .eq("id", deviceId);
}
