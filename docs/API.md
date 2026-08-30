# NOVA FITNESS — Device API

All device traffic goes to Supabase Edge Functions over HTTPS. The ESP32 never
connects to PostgreSQL and never holds the service-role key.

Base URL: `https://<project-ref>.supabase.co/functions/v1`

## Authentication

Every device request carries two headers:

```http
apikey: <supabase anon key>
x-device-key: <the key printed by scripts/provision-device.mjs>
```

The device key is compared in constant time against the SHA-256 hash in
`devices.api_key_hash`. Unknown, disabled or mismatched devices get `401
{"error":"device_unauthorized"}`. Rotate a key by re-running the provisioning
script; the old key stops working immediately.

---

## POST /attendance

The door decision plus the attendance record. Called on every scan.

```json
{
  "device_id": "GYM-001",
  "event_id": "GYM-001-000412",
  "fingerprint_id": 37,
  "event_type": "entry",
  "timestamp": "2026-08-16T14:30:00Z",
  "offline": false
}
```

`event_id` must be unique and generated on the device (device code + a monotonic
counter works well). It is `UNIQUE` in Postgres, so replaying a queued event can
never create a duplicate row.

**Granted**

```json
{
  "access_granted": true,
  "reason": "OK",
  "member_name": "John Perera",
  "membership_id": "34",
  "membership_end": "2026-09-15",
  "message": "Welcome"
}
```

**Denied**

```json
{
  "access_granted": false,
  "reason": "MEMBERSHIP_EXPIRED",
  "message": "Membership Expired"
}
```

`reason` is one of `OK`, `MEMBERSHIP_EXPIRED`, `MEMBERSHIP_SUSPENDED`,
`MEMBERSHIP_INACTIVE`, `NO_MEMBERSHIP`, `FINGERPRINT_NOT_REGISTERED`.
`message` is pre-shortened for the 240×320 TFT.

A repeat scan of the same member and event type inside
`gym_settings.scan_cooldown_seconds` (default 30) returns `"duplicate": true` and
records nothing. Denied scans are still recorded, with `authorized: false`.

---

## POST /device-heartbeat

```json
{
  "device_id": "GYM-001",
  "firmware_version": "1.0.0",
  "network_status": "4G LTE -71 dBm",
  "pending_events": 3
}
```

→ `{ "ok": true, "server_time": "2026-08-16T14:30:00.000Z" }`

Send roughly once a minute. The dashboard treats a device with no heartbeat for
3 minutes as offline. Use `server_time` to correct the device clock — there is no
RTC battery in the design.

---

## POST /device-sync

Drains the offline queue, refreshes the offline authorisation cache and carries
the sensor-erasure instructions, all in one round trip, because 4G round trips
are expensive.

```json
{
  "device_id": "GYM-001",
  "events": [
    { "event_id": "GYM-001-000413", "fingerprint_id": 37,
      "event_type": "entry", "timestamp": "2026-08-16T09:02:11Z" }
  ],
  "erased": [41]
}
```

Response:

```json
{
  "accepted": ["GYM-001-000413"],
  "rejected": [],
  "server_time": "2026-08-16T14:30:00.000Z",
  "cache": [
    { "fingerprint_id": 37, "name": "John Perera", "allowed": true }
  ],
  "erase": [52]
}
```

Drop everything in `accepted` from the local queue — an already-synced event counts
as accepted. Batches are capped at 200 events; loop if the queue is longer.

`cache` is the complete authorisation list for this device: store it in flash and
use it to make the door decision while offline. It contains no biometric data.

`erase` lists sensor slots whose templates must be deleted from the R503 itself,
queued when a member profile is permanently deleted. Dropping a member from
`cache` only makes the door say no — the template stays in the sensor's flash
until it is told to delete the slot, and the slot is never reused until then. Call
the sensor's delete for each one, then name them in `erased` on a later sync; a
queue row is only closed once the device confirms it, so an erasure interrupted by
a reset is handed back next time. A slot the sensor no longer holds counts as
erased.

---

## POST /fingerprint-assignment

The device half of enrollment. The dashboard creates the request; the device polls.

**Poll** — `{ "device_id": "GYM-001", "action": "poll" }`

```json
{
  "enrollment": {
    "request_id": "9f1c…",
    "member_name": "John Perera",
    "membership_id": "34"
  }
}
```

`{"enrollment": null}` means nothing is waiting. Poll every few seconds while idle.

**Report** — after the R503Pro finishes capturing:

```json
{
  "device_id": "GYM-001",
  "action": "report",
  "request_id": "9f1c…",
  "success": true,
  "fingerprint_id": 37
}
```

The device chooses the free sensor slot itself and reports which one it used. If
that slot was previously assigned to another member, the old mapping is cleared
first. On failure send `"success": false` with an `"error"` string.

**Removed** — `{ "device_id": "GYM-001", "action": "removed", "fingerprint_id": 37 }`
clears the mapping after the template is deleted from the sensor.

Requests expire after 10 minutes so an abandoned enrollment does not lock the sensor.

---

## POST /member-lookup

Read-only: "who is fingerprint 37, and may they come in?". Used by the TFT admin
menu. Accepts either `fingerprint_id` or `membership_id`.

```json
{ "device_id": "GYM-001", "fingerprint_id": 37 }
```

```json
{
  "found": true,
  "member": {
    "membership_id": "34",
    "name": "John Perera",
    "status": "active",
    "membership_end": "2026-09-15",
    "fingerprint_id": 37
  },
  "access_granted": true,
  "reason": "OK"
}
```

---

## POST /super-admin-login

Used by the web app only, not by devices. Resolves a username to the matching
Supabase Auth identity and signs in. Returns the same `401 invalid_credentials` for
an unknown username as for a wrong password, so it cannot be used to enumerate
accounts, and rate-limits to 8 attempts per username per 15 minutes.

---

## Suggested firmware loop

```text
boot
 ├─ load device code + key from NVS
 ├─ bring up A7670C, sync clock from /device-heartbeat
 └─ load the cached authorisation list from flash

loop
 ├─ every ~60 s ──── POST /device-heartbeat
 ├─ when online and the queue is non-empty ── POST /device-sync
 ├─ every few seconds when idle ──────────── POST /fingerprint-assignment (poll)
 └─ on finger scan
      ├─ R503Pro identify -> fingerprint_id
      ├─ online?  POST /attendance, act on access_granted
      └─ offline? decide from the cache, unlock, queue the event
```

Emergency egress must not depend on any of this. The exit release is physical
hardware and stays functional with the ESP32, the network and Supabase all down.
