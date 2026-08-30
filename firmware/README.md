# NOVA FITNESS — ESP32-S3 door terminal (MicroPython)

Firmware for the entrance terminal: R503 fingerprint sensor, 2.4" ILI9341
touchscreen, buzzer, and an HTTPS link to the Supabase Edge Functions that the
Vercel dashboard shares.

## How the pieces talk

```text
  ┌──────────────┐            ┌───────────────────────────┐
  │  Vercel      │  Postgres  │  Supabase                 │
  │  Next.js     │◄──────────►│  ├ postgres (RLS)         │
  │  dashboard   │  + RLS     │  └ Edge Functions         │
  └──────────────┘            └───────────▲───────────────┘
        staff create members,             │  HTTPS + apikey
        press "Enroll Fingerprint"        │  + x-device-key
                                          │
                                 ┌────────┴────────┐
                                 │   ESP32-S3      │
                                 │  R503 · TFT ·   │
                                 │  touch · buzzer │
                                 └─────────────────┘
```

The ESP32 never reaches Postgres and never holds the service-role key. It calls
five Edge Functions (`docs/API.md`), authenticating with a per-device key whose
SHA-256 hash is the only thing stored server-side.

**The device does not talk to the Vercel app at all.** Both are clients of the
same Supabase project — the dashboard writes an `enrollment_requests` row, the
device polls for it. That is the whole integration; there is no endpoint to add
on Vercel, and nothing on the device to expose to the internet.

## Files

| File | What it does |
|---|---|
| `main.py` | State machine: idle → scan → decision, plus timers |
| `nova_display.py` | ILI9341 driver with scaled text and rounded panels |
| `nova_ui.py` | Screens and buttons in the web app's design language |
| `nova_art.py` | Fingerprint mark and finger-on-sensor artwork |
| `xpt2046.py` | Touch controller, on its own SPI bus |
| `r503.py` | Fingerprint protocol: identify, enroll, slot allocation |
| `nova_net.py` | Wi-Fi, hand-rolled HTTPS POST, the five API calls |
| `nova_store.py` | Offline queue + authorisation cache on flash |
| `calibrate.py` | Run once, prints the `TOUCH_CAL` numbers |
| `selftest.py` | Bring-up check, subsystem by subsystem |
| `config.example.py` | Copy to `config.py` and fill in |

## Wiring — additions to the tested arrangement

Everything in `ESP32_S3_R503_TFT_Pin_Arrangement.md` stays exactly as it is.
Touch adds five wires:

| TFT touch pin | ESP32-S3 | Note |
|---|---|---|
| T_CLK | GPIO14 | separate SPI bus from the panel |
| T_DIN | GPIO21 | |
| T_DO | GPIO47 | |
| T_CS | GPIO15 | |
| T_IRQ | GPIO38 | pen-down interrupt, read as a plain input |

> **Check your panel first.** Your parts list says MD0671, and that board ships
> in both a touch and a non-touch version. If the flex/header has only the
> 9 pins you already wired and no `T_` pins, the glass has no touch layer and no
> firmware can add one — you need the XPT2046 variant of the same 2.4" module.
> Everything else in this firmware runs unchanged on a non-touch panel; you just
> lose the three buttons and enrollment starts from the dashboard only.

The touch chip is on SPI bus 2 rather than sharing the panel's bus. The ILI9341
runs at 40 MHz and the XPT2046 tops out near 2 MHz; sharing would mean
re-clocking the bus on every touch poll, which shows as visible tearing.

Optional door hardware (relay on GPIO5, reed switch on GPIO6) is off by default
— set `PIN_DOOR_RELAY` / `PIN_REED` in `config.py` to enable it.

## Setup

**1. Firmware.** Flash MicroPython **1.23 or newer** for `ESP32_S3` with SPIRAM
(`ESP32_GENERIC_S3-SPIRAM_OCT`). Older builds lack `ssl.SSLContext`, which the
HTTPS client uses. In Thonny: *Tools → Options → Interpreter → Install or update
MicroPython*.

**2. Provision the device.** On your laptop, in the repo root:

```bash
node scripts/provision-device.mjs GYM-001 "Main Entrance" "Front door"
```

It prints `DEVICE_CODE` and `DEVICE_KEY` **once**. Only the hash is stored, so a
lost key means re-running the script (which also revokes the old one instantly).

**3. Configure.** Copy `config.example.py` to `config.py`, fill in Wi-Fi, the
Supabase URL, the anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY` from Vercel), and
the two values from step 2.

**4. Upload.** In Thonny, upload every `.py` file in this folder to the device
root — but upload `config.example.py` as `config.py`. Do not upload
`calibrate.py` and `selftest.py` to a production device.

**5. Calibrate touch.** `>>> import calibrate`, tap the four crosshairs, paste
the printed block into `config.py`.

**6. Self-test.** `>>> import selftest`. Every line should read PASS. A
`device_unauthorized` on `device-heartbeat` means the key is wrong — go back to
step 2.

**7. Run.** Reset the board. `main.py` starts automatically.

## Using the terminal

**Sign in** — place a finger any time the home screen is up; no tap needed. The
`Sign In` button just prompts with a beep for members who need telling. The
verdict comes from `/attendance`, which is the single source of truth for the
door (`member_access_decision` in Postgres), so an expired membership is refused
identically at the door and in the dashboard.

**Enroll a fingerprint** — staff open the member on the dashboard and press
*Enroll Fingerprint*. That writes an `enrollment_requests` row; the device picks
it up within `ENROLL_POLL_SECONDS` and switches to the enrollment screen by
itself. The `Enroll Fingerprint` button on the terminal claims a waiting request
immediately instead of waiting for the poll. The device chooses the free sensor
slot, captures twice, and reports the slot back — the mapping is written only
after Supabase confirms. If the report fails, the template is deleted from the
sensor rather than left orphaned.

**Enrolling a brand-new member from the terminal is not possible** with the
current API, and I did not fake it: a member needs a name, phone, plan and
membership dates, which is a form, not a 240×320 keypad, and
`/fingerprint-assignment` will only assign a slot against a `request_id` that
already references a member row. `Member Lookup` gives you the read-only half —
type a membership ID on the keypad and see the name, status, expiry and whether
they would be let in. If you do want member creation at the door, it needs a new
Edge Function that creates the member and its enrollment request in one call;
say the word and I will add it.

## Offline behaviour

The door keeps working without Wi-Fi. `/device-sync` hands back a cache of
`{fingerprint_id, name, allowed}` — no biometric data — which is stored in
`cache.json`. Offline scans are decided from that cache and appended to
`queue.jsonl`, then replayed on the next sync. Event IDs are `GYM-001-000412`
style and `UNIQUE` in Postgres, so a replay can never double-count attendance.

The footer shows `ONLINE` / `OFFLINE` and `Qn` when events are waiting.

## Security

- The device holds the **anon key** and its **device key**. Neither can read the
  members table: the anon key is bounded by RLS, and the Edge Functions require
  both headers. The service-role key stays on your laptop and in Vercel's server
  environment.
- `config.py` is gitignored. Do not paste a real device key into a chat, a
  screenshot, or this repo.
- Rotate a key by re-running `provision-device.mjs`; the old one dies at once.
- **TLS verification is off by default** (`VERIFY_TLS = False`), which is the
  MicroPython norm but does mean the connection is encrypted without proving
  who is on the other end — someone on the same network could impersonate
  Supabase. To fix that, download Supabase's root CA (ISRG Root X1) in DER form,
  upload it as `isrg_root_x1.der`, and set `VERIFY_TLS = True`. Do it before the
  terminal goes on a public gym network; the certificate expires in 2035, so
  diarise a re-upload.
- Emergency egress must be physical hardware. Nothing in this firmware should
  ever stand between a person and the way out.

## Tuning

| Setting | Effect |
|---|---|
| `HEARTBEAT_SECONDS` | Dashboard marks a device offline after 3 minutes of silence; 60 is right |
| `ENROLL_POLL_SECONDS` | How fast the terminal reacts to the dashboard's Enroll button |
| `HTTP_TIMEOUT` | Raise on slow Wi-Fi; each scan blocks for at most this long before falling back to the cache |
| `scan_cooldown_seconds` | Server-side (gym_settings) — repeat scans inside the window return `duplicate` and record nothing |
