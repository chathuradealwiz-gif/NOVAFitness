#!/usr/bin/env node
/**
 * Registers an ESP32 terminal and mints its API key.
 *
 *   node scripts/provision-device.mjs GYM-001 "Main Entrance" "Front door"
 *
 * The key is printed ONCE. Only its SHA-256 hash is stored in the database, and
 * the key itself goes into the device's NVS — never into Git, never into the
 * firmware source, and never into a .env file.
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // Missing file — fall through to the next one / the ambient environment.
  }
}

const [deviceCode, name = "Entrance Terminal", location = ""] = process.argv.slice(2);

if (!deviceCode) {
  console.error('Usage: node scripts/provision-device.mjs GYM-001 "Main Entrance" "Front door"');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const apiKey = randomBytes(32).toString("base64url");
const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");

const { error } = await supabase
  .from("devices")
  .upsert(
    { device_code: deviceCode, name, location, api_key_hash: apiKeyHash, status: "offline" },
    { onConflict: "device_code" },
  );

if (error) {
  console.error("Could not provision the device:", error.message);
  process.exit(1);
}

console.log(`\nDevice ${deviceCode} provisioned.\n`);
console.log("Add these to the firmware's NVS / config (shown only once):\n");
console.log(`  DEVICE_CODE = ${deviceCode}`);
console.log(`  DEVICE_KEY  = ${apiKey}\n`);
console.log("Re-run this script to rotate the key; the old one stops working immediately.");
