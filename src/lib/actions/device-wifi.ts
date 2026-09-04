"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth/session";
import type { ActionResult } from "./members";

/**
 * Wi-Fi scan and switch requests for a terminal.
 *
 * Nothing here talks to the device. It is behind the gym's router with no
 * inbound route, so a request is parked on `device_wifi_commands` and collected
 * on the terminal's next device-sync — which means one sync interval to reach
 * it and another to hear back. Every caller has to show that delay rather than
 * spin as though this were a live connection.
 *
 * Super admin only, and deliberately so: switching the network of a door that
 * is working is how you lose a door. The firmware protects itself as well (it
 * proves the new network before saving it, and falls back to the old one), but
 * the ability to try should not be one mis-click away for every staff account.
 */

const PENDING = ["pending", "sent"] as const;

async function queue(
  deviceId: string,
  action: "scan" | "connect",
  ssid?: string,
  password?: string,
): Promise<ActionResult> {
  const session = await requireSuperAdmin();
  const supabase = createClient();

  // Clear anything long dead before looking for a live one, or a terminal that
  // was offline yesterday can never be given another command.
  await supabase.rpc("expire_stale_wifi_commands");

  const { data: busy } = await supabase
    .from("device_wifi_commands")
    .select("id, action")
    .eq("device_id", deviceId)
    .in("status", PENDING)
    .maybeSingle();

  if (busy) {
    return {
      ok: false,
      error:
        busy.action === action
          ? "That request is already waiting for the terminal to collect it."
          : "Another Wi-Fi request is still waiting on this terminal.",
    };
  }

  const { error } = await supabase.from("device_wifi_commands").insert({
    device_id: deviceId,
    action,
    ssid: ssid ?? null,
    password: password ?? null,
    requested_by: session.profile.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/devices");
  return { ok: true };
}

/** Ask the terminal to list the networks it can see. */
export async function scanWifi(deviceId: string): Promise<ActionResult> {
  return queue(deviceId, "scan");
}

/**
 * Ask the terminal to move to another network.
 *
 * The password reaches the device in plain text and is stored that way until
 * it is used — unavoidable, because the ESP32 has to present the real password
 * to the router and cannot be given a hash of it. It is cleared from the row as
 * soon as the device reports back, the table is readable only by super admins
 * and the service role, and the transport is TLS in both directions.
 */
export async function switchWifi(
  deviceId: string,
  ssid: string,
  password: string,
): Promise<ActionResult> {
  const name = ssid.trim();
  if (!name) return { ok: false, error: "Choose a network." };
  // WPA2's own floor. Rejected here so the mistake costs a form submit rather
  // than two sync intervals ending in "could not join".
  if (password && password.length < 8) {
    return { ok: false, error: "A Wi-Fi password is at least 8 characters." };
  }
  return queue(deviceId, "connect", name, password);
}

/** Withdraw a request the terminal has not collected yet. */
export async function cancelWifiCommand(commandId: string): Promise<ActionResult> {
  await requireSuperAdmin();
  const supabase = createClient();

  const { error } = await supabase
    .from("device_wifi_commands")
    .update({
      status: "expired",
      result: "cancelled from the dashboard",
      password: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", commandId)
    .in("status", PENDING);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/devices");
  return { ok: true };
}
