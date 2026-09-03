# NOVA FITNESS — ESP32-S3 door terminal (MicroPython)

Firmware for the entrance terminal: R307 fingerprint sensor, 2.4" ILI9341
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
                                 │  R307 · TFT ·   │
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
| `fingerprint.py` | Sensor protocol: identify, enroll, slot allocation. One driver for the whole ZFM family (R307, R503) |
| `nova_net.py` | Wi-Fi, hand-rolled HTTPS POST, the five API calls |
| `nova_store.py` | Offline queue, authorisation cache and pending erasures on flash |
| `calibrate.py` | Run once, prints the `TOUCH_CAL` numbers |
| `selftest.py` | Bring-up check, subsystem by subsystem |
| `test_modem.py` | Bench test for the A7670C 4G module, SIM through to HTTPS |
| `test_relay.py` | Bench test for the solenoid relay |
| `config.example.py` | Copy to `config.py` and fill in |

## Wiring — additions to the tested arrangement

Every GPIO in `ESP32_S3_R503_TFT_Pin_Arrangement.md` stays exactly as it is.

### Fingerprint sensor (R307)

The R307 replaced the R503 for capacity: 1000 templates against 200, which is
what a 500-member gym needs. Same UART, same 57600 baud, same command set — the
driver did not change. What changed is the supply:

| R307 wire | Function | Connects to |
|---|---|---|
| Red | VCC | **5 V at the HW-688 terminal** — not 3.3 V, not the ESP32's 5V pin |
| Black | GND | buck terminal, same star point |
| Yellow | TXD | GPIO16 — 3.3 V logic, direct |
| Green | RXD | GPIO17 — accepts 3.3 V |
| Blue | WAKEUP | GPIO41 (`PIN_FP_WAKEUP`), or unconnected to poll instead |
| White | VT (3.3 V touch supply) | **3.3 V** if WAKEUP is used, else unconnected |

Leaving WAKEUP off is workable but has a cost worth understanding. The idle
loop then calls `get_image()` repeatedly and the sensor is blind between
calls — a finger arriving in the gap is not seen, which reads to a member as
"it only works sometimes". The blue capture light strobing on and off *is*
that polling: the R307 lights it while imaging, not as a standby indicator.
The gap stretches with anything slow in the loop, and on 4G an enrollment poll
is a fresh TLS handshake every `ENROLL_POLL_SECONDS`, so the sensor can be
blind for most of each cycle.

Wire it and the loop reads a pin instead, images only when a finger is really
there, and the light stops strobing. **VT must go to 3.3 V** — WAKEUP is the
output of a touch circuit VT powers, and unpowered it never asserts, which is
indistinguishable from a broken wire. Measure the polarity before trusting
`FP_WAKEUP_ACTIVE_HIGH`: backwards means the door images constantly and never
when you want it to.

The R503 ran on 3.3 V; **the R307 will not start below 4.2 V.** Its data lines
stay 3.3 V TTL, so no level shifter is needed. Wire colours vary between
suppliers — measure before connecting: TXD idles high at ~3.3 V, RXD floats near
zero. Add 100 µF + 100 nF at the connector, as with the modem.

Moving the sensor to 5 V takes it off the ESP32's onboard 3.3 V regulator, which
now has that headroom for the display.

The R307 has no RGB ring, so `SENSOR_HAS_AURA = False` and `aura()` returns
immediately instead of waiting out a timeout on every screen change. Nothing is
lost: the TFT and buzzer already carried every cue the ring gave.

### 4G modem (SIMCom A7670C, FS-MCore V1.2)

Wi-Fi is the link the firmware uses today. The modem is the second route, and
`test_modem.py` exercises it on its own before any of `main.py` depends on it.

| A7670C pin | Function | Connects to |
|---|---|---|
| VIN | supply | **5 V at the HW-688 terminal**, same star point as the sensor |
| GND | ground | buck terminal |
| VDD | UART level reference | 3.3 V — the board level-shifts against this |
| TX | modem TX | GPIO7 |
| RX | modem RX | GPIO18 |
| PWK | power key | GPIO40 — pulsed low to toggle power |
| NET | network LED | unconnected (`PIN_MODEM_NET = None`) |
| PEN | power enable | unconnected |

GPIO7/18/40 were free; nothing above moves. The modem takes UART1 — UART0 is
the Thonny REPL and UART2 is the fingerprint sensor, so all three coexist.

**The supply is the part that bites.** The board peaks at **2.3 A** on transmit
even though it idles near 20 mA, and those peaks land during registration and
each TLS handshake. Off the ESP32's 5V pin it browns the board out mid-attach,
which reads as a modem that answers `AT` and never registers. VIN goes to the
buck, and 470 µF + 100 nF sit at the connector — the peak is short, but for
1–2 ms it is the whole supply.

Fit the antenna before powering up. Nano SIM, contacts toward the board, and
the SIM needs a **data** plan: a voice-only SIM registers happily and then
never gets an IP.

### Testing it

Set `MODEM_APN` in `config.py` for your operator (Dialog `dialogbb`, Mobitel
`mobitel3g`, Hutch `hutch3g`, Airtel `airtelgprs.com`), then:

```
>>> import test_modem
```

It climbs a ladder — modem answers → SIM ready → signal → LTE registration →
data context with an IP → an HTTPS POST of a real `/device-heartbeat`. The
first FAIL is the one to fix; everything below it fails for the same reason.
Helpers for when one sticks: `rf()` for a radio that reports no signal,
`tls_probe()` for a handshake that will not complete, `post_socket()` to see a
whole request and reply, `console()` for an `AT>` prompt.
The last rung means the whole path works, not just that the radio attached, so
**turn the Wi-Fi router off while testing** or you will not know which link
carried it. `test_modem.console()` drops you at an `AT>` prompt for poking at a
failure, and `test_modem.power_toggle()` pulses PWK if the board came up asleep.

**Verified working** on a Dialog SIM: −71 dBm, registered on `41302`, APN
`dialogbb`, a CGNAT address from `AT+CGPADDR`, and `HTTP/1.1 200 OK` from
`/device-heartbeat` with a real `server_time` — the door's own request, over
LTE, TLS and all.

Two settings had to be right, and neither is a default. Both cost an evening,
so they are written down rather than left in the code alone:

| Setting | Why |
|---|---|
| `AT+CSSLCFG="enableSNI",0,1` | Supabase sits behind Cloudflare, where one IP serves thousands of certificates. Without the hostname in the handshake the server cannot pick one. SIMCom ships this **off**, which works against their single-certificate examples and fails against everything else. |
| `AT+CSSLCFG="ignorelocaltime",0,1` | The modem has no battery-backed clock and reads 1970 until the network tells it otherwise, so every certificate looks not-yet-valid. `AT+CLTS=1` fixes the cause but only takes effect after a modem restart. |

The same fault appeared three different ways and never once said "SNI":
`+HTTPACTION: 1,715,0` from the AT HTTP stack, `+CCHOPEN: 0,15` from the
socket, and — when the socket was opened with `client_type` 1 — a plaintext
Cloudflare `400 The plain HTTP request was sent to HTTPS port`, which is the
modem admitting it never wrapped the connection. `client_type` **2** is TLS.

`tls_probe()` found it by trying the combinations against the real server
rather than reasoning about error codes; it is still in the file for the next
time a handshake fails.

The AT HTTP stack (`AT+HTTPINIT` / `AT+HTTPACTION`) is **not** used and has
been removed. Beyond being opaque on failure, `AT+HTTPPARA="USERDATA"` caps
near 256 bytes — one Supabase JWT is most of that, and the three headers the
Edge Functions need do not fit. Moving the anon key to a `?apikey=` query
parameter made it fit and the gateway answered `401`. The socket path sends
all three headers properly and gets its `200`.

When the modem will not answer `AT` at all, work outward from the board rather
than up the ladder. `test_modem.listen()` prints whatever it says unprompted —
a healthy A7670C announces `RDY`, `+CPIN:` and `SMS DONE` a few seconds after
power-up, so silence there means nothing is arriving on GPIO7 and garbage means
the wrong baud rate, which `test_modem.scan_baud()` will find. Silence with the
PWR LED lit is one of three things: TX/RX swapped, no common ground between the
buck and the ESP32, or a VDD/VREF pad left unconnected — the onboard level
shifter is referenced to it, and without 3.3 V there nothing crosses in either
direction even though every other wire is right.

PWK is driven open-drain, like a button to ground; it is never pulled up to
3.3 V. Many FS-MCore boards power up on their own as soon as VIN arrives, so if
the PWR LED is already lit, PWK is not what is wrong.

Common outcomes: no reply to `AT` is TX/RX swapped or VIN not on the buck;
`+CPIN: SIM PIN` is a PIN-locked card, not wiring; a `+CSQ` of 99 that clears
within a few seconds is just the first scan, one that persists is the antenna; `CEREG 2` forever is
coverage or a data-less SIM; an IP of `0.0.0.0` is the wrong APN; and an
`+HTTPACTION` status of 7xx is the modem's own DNS/TLS failure rather than
anything Supabase said.

### Choosing the link

`LINK` in `config.py` decides what carries device traffic:

| `LINK` | Behaviour |
|---|---|
| `"wifi"` | Wi-Fi only — what the terminal did before the modem existed |
| `"4g"` | Modem only — **use this to test 4G**, see below |
| `"auto"` | Wi-Fi first, modem when no configured SSID answers. What a deployed door runs |

Set `LINK = "4g"` when you want a conclusive test. Under `"auto"` a working
router means the modem is never reached, so a green run tells you nothing
about it — the same trap as testing a generator without cutting the mains.

`nova_net.Uplink` holds both links and picks between them. It answers
`ensure()`, `connect()`, `connected()`, `rssi()`, `status_text()` and
`fetch()` exactly as the old `WiFi` class did, so `main.py`, `selftest.py` and
every Edge Function call are unchanged — they cannot tell which link carried a
request. A link that fails mid-request is dropped, so the next call re-runs
the ladder and can fall through to the other one.

`selftest.py` prints the mode it is running (`Uplink (4g)`), and the device
health screen shows whichever link is live.

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

The relay that drives the solenoid lock is on GPIO5 (`PIN_DOOR_RELAY`). A granted
fingerprint pulses it for `DOOR_UNLOCK_MS` (1 s) and re-locks; no reed switch is
fitted, so nothing waits on a door contact. Set `PIN_DOOR_RELAY` to `None` to
run display-only on the bench.

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

**Device health** — *Info → Device Health* runs the checks live rather than
reporting cached status: it asks the sensor for its system parameters and
template count, stats the filesystem, and reads the Wi-Fi and server state. A
banner says `ALL CHECKS PASS` or `n FAULTS`, and any failing row is red with the
reason on it — a sensor confirmation code, an unreachable server, the last
unhandled error from the main loop.

Sensor capacity comes from the chip's own `ReadSysPara`, not from the datasheet
and not from the seller. These modules ship in 200- and 1000-template variants
that are labelled interchangeably, and the firmware used to assume 200
everywhere. On a 1000-template unit that silently capped `search()` at slot 200
and read only half the index table, so members enrolled above it would never
have matched. The health screen shows the model, capacity, enrolled and free,
and warns amber below 5% of the library (a floor of ten slots) — a fixed ten
was most of a warning on a 200-slot sensor and no warning at all on 1000.

**On a new sensor, run `selftest.py` and confirm the capacity before enrolling
anyone.** A 200-slot module sold as a 1000 is common, and the alternative to
one command now is discovering it at member 201.

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
