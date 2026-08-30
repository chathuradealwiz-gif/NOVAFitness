"""NOVA FITNESS door terminal - main loop.

    boot -> Wi-Fi -> heartbeat (sets the clock) -> device-sync (loads the
    offline authorisation cache) -> idle

Idle does three things at once: watches the sensor for a finger, watches the
touchscreen for a tap, and on a timer sends the heartbeat, drains the offline
queue and polls for an enrollment request from the dashboard.

Nothing here blocks the door: if Supabase is unreachable the decision is made
from the cached list and the event is queued for the next sync.
"""

from machine import Pin, PWM
import sys
import os
import time
import gc

import config as cfg
from nova_display import RED, GREEN, AMBER, MUTED, TEXT
from nova_ui import UI, Button
from xpt2046 import Touch
from r503 import R503, FingerprintError, AURA_BREATHE, AURA_FLASH, AURA_OFF, BLUE, PURPLE
from r503 import RED as AURA_RED
from nova_net import WiFi, SupabaseDevice, NetworkError, iso_now
from nova_store import Store


DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def button_at(buttons, pos):
    """The button under `pos`, or None.

    Not next((b for b in buttons if b.hit(pos)), None): MicroPython's next()
    takes only the iterator, so the default argument raises TypeError.
    """
    for b in buttons:
        if b.hit(pos):
            return b
    return None


# --- buzzer -----------------------------------------------------------------
class Buzzer:
    def __init__(self, pin):
        self.pin = pin
        self.pwm = None

    def tone(self, freq, ms):
        try:
            self.pwm = PWM(Pin(self.pin), freq=freq, duty=512)
            time.sleep_ms(ms)
            self.pwm.deinit()
        except Exception:
            pass

    def granted(self):
        self.tone(1800, 90)
        time.sleep_ms(40)
        self.tone(2400, 140)

    def denied(self):
        self.tone(400, 250)
        time.sleep_ms(70)
        self.tone(400, 250)

    def tap(self):
        self.tone(2600, 25)

    def prompt(self):
        self.tone(2000, 60)


# --- door -------------------------------------------------------------------
class Door:
    def __init__(self):
        self.relay = None
        if cfg.PIN_DOOR_RELAY is not None:
            idle = 0 if cfg.RELAY_ACTIVE_HIGH else 1
            self.relay = Pin(cfg.PIN_DOOR_RELAY, Pin.OUT, value=idle)
        self.reed = (Pin(cfg.PIN_REED, Pin.IN, Pin.PULL_UP)
                     if cfg.PIN_REED is not None else None)

    def unlock(self, ms=None):
        if self.relay is None:
            return
        ms = ms or cfg.DOOR_UNLOCK_MS
        self.relay(1 if cfg.RELAY_ACTIVE_HIGH else 0)
        time.sleep_ms(ms)
        self.relay(0 if cfg.RELAY_ACTIVE_HIGH else 1)


class Terminal:
    def __init__(self):
        self.ui = UI(cfg)
        self.ui.splash("Starting")
        self.touch = Touch(cfg)
        self.buzzer = Buzzer(cfg.PIN_BUZZER)
        self.door = Door()
        self.store = Store(cfg.DEVICE_CODE)

        self.ui.status_line("Fingerprint sensor")
        self.fp = R503(cfg)
        self.fp.aura(AURA_OFF, BLUE)

        self.wifi = WiFi(cfg, on_status=self.ui.status_line)
        self.api = SupabaseDevice(cfg, self.wifi)

        self.online = False
        self.last_heartbeat = 0
        self.last_poll = 0
        self._since_gc = 0
        # Set whenever show_home() runs, so a nested screen can tell that
        # something underneath it (an enrollment started from the dashboard)
        # has already returned the terminal to the home screen.
        self.home_shown = False
        # Last unhandled error from the main loop, surfaced on the health
        # screen: the one thing you want when the door misbehaved an hour ago.
        self.last_error = ""
        self.boot_ticks = time.ticks_ms()
        self.buttons = self._home_buttons()

    # --- layout -------------------------------------------------------------
    def _home_buttons(self):
        """One button only, and it is not an admin action.

        Signing in needs no button - the idle loop watches the sensor - so the
        home screen belongs to the member: the clock, the scan prompt, and Info.
        Enrollment moved behind Info so a member cannot start it by accident.
        """
        return [
            Button("Info", 12, 240, 216, 44, primary=True, key="INFO"),
        ]

    def _info_buttons(self):
        return [
            Button("Add New User", 12, 148, 216, 44, primary=True, key="ENROLL"),
            Button("Device Health", 12, 200, 216, 44, key="HEALTH"),
            Button("Back", 12, 252, 216, 40, key="BACK"),
        ]

    # --- clock --------------------------------------------------------------
    def local_time(self):
        """(HH:MM, "Sat 30 Aug") in gym time, or ("", "") before the first sync.

        The RTC is set from the server in UTC and the board has no battery for
        it, so the offset is applied here rather than stored in the clock.
        """
        if not self.api.clock_synced:
            return "", ""
        offset = getattr(cfg, "TZ_OFFSET_MINUTES", 330)
        t = time.localtime(time.time() + offset * 60)
        return ("%02d:%02d" % (t[3], t[4]),
                "%s %d %s" % (DAYS[t[6]], t[2], MONTHS[t[1] - 1]))

    def update_clock(self):
        """Called from the home screen's idle pass; repaints only on a change."""
        clock, date = self.local_time()
        self.ui.clock(clock, date)

    def footer_text(self):
        net = "ONLINE" if self.online else "OFFLINE"
        pending = self.store.pending()
        tail = " Q%d" % pending if pending else ""
        return "%s  %s%s" % (cfg.DEVICE_CODE, net, tail)

    def show_home(self, hint="Place finger to sign in"):
        self.home_shown = True
        clock, date = self.local_time()
        self.ui.home(self.buttons, hint, clock, date)
        self.ui.footer(self.footer_text())
        self.fp.aura(AURA_BREATHE, BLUE, 100)

    # --- boot ---------------------------------------------------------------
    def boot(self):
        self.ui.status_line("Connecting Wi-Fi")
        if self.wifi.connect():
            self.ui.status_line("Contacting NOVA")
            try:
                self.api.heartbeat(self.store.pending(), self.health_snapshot())
                self.online = True
                self.last_heartbeat = time.ticks_ms()
                self.ui.status_line("Syncing members")
                self.do_sync()
            except NetworkError as e:
                self.ui.status_line(str(e)[:26])
                time.sleep(2)
        else:
            self.ui.status_line("Offline mode")
            time.sleep(2)
        gc.collect()
        self.show_home()

    # --- background work ----------------------------------------------------
    def do_sync(self):
        """Drain the queue and refresh the offline cache in one round trip."""
        events = self.store.queued(200)
        reported = self.store.erased()
        data = self.api.sync(events, reported)
        accepted = data.get("accepted", [])
        if accepted:
            self.store.drop(accepted)
        # Only once the response is in hand: a failed post raises, and the
        # confirmations stay on flash for the next attempt.
        if reported:
            self.store.clear_erased(reported)
        if data.get("cache") is not None:
            self.store.save_cache(data["cache"])
        if data.get("server_time"):
            self.api.set_clock(data["server_time"])
        self.erase_slots(data.get("erase") or [])

    def erase_slots(self, slots):
        """Delete the templates the dashboard asked us to erase.

        A deleted member's biometric data only really leaves the gym here: the
        template sits in the sensor's own flash, and dropping them from the
        authorisation cache would just make the door say no while the print
        stayed on the device.

        Confirmations are held on flash and sent with the next sync, so an
        erasure is never lost to a reboot between deleting and reporting. A slot
        the sensor no longer holds counts as erased - that is the desired end
        state, and retrying it forever would block the rest of the queue.
        """
        done = []
        for slot in slots:
            try:
                self.fp.delete(int(slot))
                done.append(int(slot))
            except FingerprintError:
                done.append(int(slot))       # already gone
            except OSError:
                break                        # sensor busy; try again next sync
        if done:
            self.store.mark_erased(done)

    def tick(self):
        """Timed background work. Never raises into the main loop."""
        now = time.ticks_ms()
        if time.ticks_diff(now, self.last_heartbeat) > cfg.HEARTBEAT_SECONDS * 1000:
            self.last_heartbeat = now
            try:
                self.api.heartbeat(self.store.pending(), self.health_snapshot())
                was_offline = not self.online
                self.online = True
                if was_offline or self.store.pending():
                    self.do_sync()
                self.ui.footer(self.footer_text())
            except NetworkError:
                if self.online:
                    self.online = False
                    self.ui.footer(self.footer_text())

        if time.ticks_diff(now, self.last_poll) > cfg.ENROLL_POLL_SECONDS * 1000:
            self.last_poll = now
            if self.online:
                try:
                    enrollment = self.api.poll_enrollment()
                except NetworkError:
                    return
                if enrollment:
                    # Staff pressed "Enroll fingerprint" on the member's page.
                    self.run_enrollment(enrollment)

    # --- fingerprint sign-in ------------------------------------------------
    def sign_in(self, prompted=False):
        self.ui.scan("Scanning", "Place your finger on the sensor")
        self.ui.footer(self.footer_text())
        self.fp.aura(AURA_BREATHE, BLUE, 60)
        if prompted:
            self.buzzer.prompt()

        try:
            if not self.fp.wait_finger(8000, on_tick=self.ui.scan_tick):
                self.fp.aura(AURA_OFF, BLUE)
                self.show_home("Timed out - try again")
                return
            self.fp.img2tz(1)
            self.buzzer.tap()
            self.ui.reading("Reading", "Checking your fingerprint")
            match = self.fp.search(1)
        except (FingerprintError, OSError) as e:
            self.fp.aura(AURA_FLASH, AURA_RED, 60, 3)
            self.buzzer.denied()
            self.ui.result(False, "Try Again", "", "Sensor could not read that finger")
            self.hold(2500)
            self.show_home()
            return

        if match is None:
            self.fp.aura(AURA_FLASH, AURA_RED, 60, 3)
            self.buzzer.denied()
            self.ui.result(False, "Denied", "Unknown User",
                           "Fingerprint not registered")
            self.hold(3000)
            self.show_home()
            return

        fingerprint_id, score = match
        self.record_entry(fingerprint_id, score)

    def record_entry(self, fingerprint_id, score=0):
        event_id = self.store.next_event_id()
        timestamp = iso_now()

        if self.online:
            try:
                data = self.api.attendance(event_id, fingerprint_id, "entry", timestamp)
                self.render_decision(
                    data.get("access_granted", False),
                    data.get("member_name", ""),
                    data.get("message", ""),
                    data.get("reason", ""),
                    data.get("membership_end"),
                )
                return
            except NetworkError:
                self.online = False          # fall through to the cache

        allowed, name, reason = self.store.decide_offline(fingerprint_id)
        self.store.enqueue({
            "event_id": event_id,
            "fingerprint_id": fingerprint_id,
            "event_type": "entry",
            "timestamp": timestamp,
        })
        message = "Welcome" if allowed else (
            "Fingerprint Not Registered"
            if reason == "FINGERPRINT_NOT_REGISTERED" else "Access Denied")
        self.render_decision(allowed, name, message, reason, None, offline=True)

    def render_decision(self, granted, name, message, reason, membership_end,
                        offline=False):
        meta = ""
        if membership_end:
            meta = "Valid until %s" % membership_end
        elif offline:
            meta = "Offline - will sync"

        if granted:
            self.fp.aura(AURA_FLASH, PURPLE, 60, 2)
            self.buzzer.granted()
            self.ui.result(True, "Welcome", name or "Member",
                           message or "Access granted", meta)
            self.ui.footer(self.footer_text())
            self.door.unlock()
            self.hold(1200)
        else:
            self.fp.aura(AURA_FLASH, AURA_RED, 60, 3)
            self.buzzer.denied()
            self.ui.result(False, "Denied", name, message or "Access denied", meta)
            self.ui.footer(self.footer_text())
            self.hold(3500)
        self.show_home()

    # --- enrollment ---------------------------------------------------------
    def run_enrollment(self, enrollment):
        """Runs the request the dashboard created. The device picks the free
        sensor slot and reports it back (docs/API.md)."""
        request_id = enrollment.get("request_id")
        member = enrollment.get("member_name") or "New member"
        membership_id = enrollment.get("membership_id") or ""

        self.ui.enroll_begin(member)
        self.ui.footer("ID %s" % membership_id if membership_id else self.footer_text())
        self.buzzer.prompt()
        time.sleep_ms(700)

        try:
            slot = self.fp.free_slot()
            if slot is None:
                raise OSError("Sensor full")

            def on_step(step, msg):
                # msg is the instruction for the member ("place flat", "lift
                # off"); the ridges fill to the same percentage the dashboard
                # is showing staff on the member's page.
                self.ui.enroll_step(step, 4, msg)
                if step in (1, 2):
                    self.buzzer.prompt()
                self.api.report_progress(request_id, step, 4, msg)

            self.fp.enroll(slot, on_step=on_step, on_tick=self.ui.enroll_tick)
        except (FingerprintError, OSError) as e:
            self.fp.aura(AURA_FLASH, AURA_RED, 60, 3)
            self.buzzer.denied()
            reason = str(e)
            try:
                self.api.report_enrollment(request_id, False, error=reason)
            except NetworkError:
                pass
            self.ui.message("Enroll Failed", reason, RED)
            self.hold(3500)
            self.show_home()
            return

        # The slot only counts once Supabase has stored the mapping.
        try:
            self.api.report_enrollment(request_id, True, fingerprint_id=slot)
        except NetworkError as e:
            # The template is on the sensor but the backend does not know about
            # it. Remove it rather than leave an orphan slot that would let an
            # unassigned finger through the offline cache path later.
            try:
                self.fp.delete(slot)
            except Exception:
                pass
            self.buzzer.denied()
            self.ui.message("Enroll Failed", "No connection to NOVA. Try again.", RED)
            self.hold(3500)
            self.show_home()
            return

        self.buzzer.granted()
        self.ui.result(True, "Enrolled", member, "Slot %d saved" % slot,
                       "ID %s" % membership_id if membership_id else "")
        self.hold(3000)
        try:
            self.do_sync()               # pull the new member into the cache
        except NetworkError:
            pass
        self.show_home()

    def enroll_pressed(self):
        """The Enroll button. Enrollment is always started from the dashboard
        (it needs the member record); the device just claims the request."""
        if not self.online:
            self.ui.message("Offline", "Enrollment needs a connection to NOVA.", AMBER)
            self.hold(2500)
            self.show_home()
            return
        self.ui.busy("Enroll", "Looking for a pending request", accent=AMBER)
        try:
            enrollment = self.api.poll_enrollment()
        except NetworkError as e:
            self.online = False
            self.ui.message("No Connection", str(e), RED)
            self.hold(2500)
            self.show_home()
            return

        if not enrollment:
            self.ui.message(
                "Nothing Pending",
                "Open the member on the dashboard and press Enroll Fingerprint, "
                "then tap this again.", AMBER)
            self.hold(5000)
            self.show_home()
            return
        self.run_enrollment(enrollment)

    # --- info / health ------------------------------------------------------
    def info_screen(self):
        """The admin menu behind the home screen's Info button.

        A nested loop rather than a state in run(), matching how the keypad
        already works - but it still calls tick(), so heartbeats and the
        enrollment poll keep running while someone stands here reading.
        """
        buttons = self._info_buttons()
        self.ui.info(buttons)
        self.ui.footer(self.footer_text())
        self.home_shown = False

        while True:
            try:
                self.tick()
            except Exception:
                pass

            # tick() can run an enrollment the dashboard requested, which ends
            # on the home screen. Without this the loop would keep matching taps
            # against Info's buttons over a screen that no longer shows them.
            if self.home_shown:
                return

            pos = self.touch.position()
            if pos is None:
                time.sleep_ms(30)
                continue

            hit = button_at(buttons, pos)
            if hit is None:
                self.touch.wait_release()
                continue

            self.buzzer.tap()
            self.ui.flash(hit, self.touch)

            if hit.key == "BACK":
                self.show_home()
                return
            if hit.key == "ENROLL":
                # Returns to the home screen itself, whatever the outcome.
                self.enroll_pressed()
                return
            if hit.key == "HEALTH":
                self.health_screen()
                if self.home_shown:
                    return
                # Back to the menu the staff member came from.
                self.ui.info(buttons)
                self.ui.footer(self.footer_text())
                self.home_shown = False

    def health_snapshot(self):
        """Live probe of every component, as plain data.

        One source of truth for both readers: the terminal's own health screen
        renders it, and the heartbeat ships it to the dashboard. Probing twice
        would let the screen and the web app disagree about the same second.
        """
        snap = {}

        # capacity() proves the sensor link end to end: a real command with a
        # 16-byte reply, not just "the UART did not error".
        try:
            capacity = self.fp.capacity()
            enrolled = self.fp.template_count()
            snap["sensor"] = "ok"
            snap["capacity"] = capacity
            snap["enrolled"] = enrolled
            snap["free_slots"] = capacity - enrolled
        except FingerprintError as e:
            snap["sensor"] = "error"
            snap["sensor_error"] = "Err 0x%02X" % e.code
        except OSError as e:
            # Almost always the wiring or the baud rate, so name it plainly.
            snap["sensor"] = "error"
            snap["sensor_error"] = str(e)[:40] or "No reply"

        gc.collect()
        snap["free_ram"] = gc.mem_free()
        snap["total_ram"] = gc.mem_free() + gc.mem_alloc()

        try:
            st = os.statvfs("/")
            snap["free_flash"] = st[0] * st[3]
            snap["total_flash"] = st[0] * st[2]
        except OSError:
            pass

        snap["wifi"] = self.wifi.connected()
        snap["rssi"] = self.wifi.rssi()
        snap["clock_synced"] = self.api.clock_synced
        snap["queue"] = self.store.pending()
        snap["pending_erasures"] = len(self.store.erased())
        # ticks_diff handles the counter wrap; beyond ~12 days it is wrong, and
        # a terminal up that long is not the case anyone is debugging.
        snap["uptime_s"] = time.ticks_diff(time.ticks_ms(), self.boot_ticks) // 1000
        if self.last_error:
            snap["last_error"] = self.last_error[:120]
        return snap

    def health_rows(self, snap=None):
        """Render a snapshot as (label, value, colour) rows, plus the faults."""
        if snap is None:
            snap = self.health_snapshot()

        rows = []
        faults = []

        def fail(label, value):
            faults.append("%s: %s" % (label, value))
            rows.append((label, value, RED))

        if snap.get("sensor") == "ok":
            free = snap["free_slots"]
            rows.append(("Sensor", "OK", GREEN))
            rows.append(("Capacity", "%d slots" % snap["capacity"], TEXT))
            rows.append(("Enrolled", "%d prints" % snap["enrolled"], TEXT))
            # Amber before it bites: enrollment fails outright at zero free.
            rows.append(("Free", "%d left" % free,
                         RED if free <= 0 else AMBER if free < 10 else GREEN))
        else:
            fail("Sensor", snap.get("sensor_error", "No reply")[:13])

        free_ram = snap.get("free_ram", 0)
        rows.append(("Memory", "%d KB" % (free_ram // 1024),
                     RED if free_ram < 16000 else AMBER if free_ram < 40000 else GREEN))

        if "free_flash" in snap:
            free_fs = snap["free_flash"]
            rows.append(("Flash", "%d KB" % (free_fs // 1024),
                         RED if free_fs < 20000 else GREEN))
        else:
            fail("Flash", "Unreadable")

        # The display and touch panel cannot be probed over a bus - but you are
        # reading this row on the display, and you pressed a button to get here,
        # so both are proven by the fact that this screen is in front of you.
        rows.append(("Display", "OK", GREEN))
        rows.append(("Touch", "OK", GREEN))

        if snap.get("wifi"):
            rows.append(("Wi-Fi", self.wifi.status_text().replace("WiFi ", ""), GREEN))
        else:
            fail("Wi-Fi", "Offline")

        if self.online:
            rows.append(("Server", "Online", GREEN))
        else:
            fail("Server", "Unreachable")

        clock, _ = self.local_time()
        if clock:
            rows.append(("Clock", clock, GREEN))
        else:
            fail("Clock", "Not set")

        pending = snap.get("queue", 0)
        rows.append(("Queue", "%d events" % pending, AMBER if pending else GREEN))

        if snap.get("last_error"):
            fail("Last error", snap["last_error"][:13])

        return rows, faults

    def health_screen(self):
        # Side by side: the checks fill the screen, leaving one button row.
        buttons = [
            Button("Re-check", 12, 250, 105, 40, key="REFRESH"),
            Button("Back", 123, 250, 105, 40, key="BACK"),
        ]
        rows, faults = self.health_rows()
        self.ui.health(rows, faults, buttons)
        self.ui.footer(self.footer_text())
        self.home_shown = False

        while True:
            try:
                self.tick()
            except Exception:
                pass

            # Same as in info_screen: an enrollment may have taken the screen.
            if self.home_shown:
                return

            pos = self.touch.position()
            if pos is None:
                time.sleep_ms(30)
                continue

            hit = button_at(buttons, pos)
            if hit is None:
                self.touch.wait_release()
                continue

            self.buzzer.tap()
            self.ui.flash(hit, self.touch)

            if hit.key == "BACK":
                return
            if hit.key == "REFRESH":
                rows, faults = self.health_rows()
                self.ui.health(rows, faults, buttons)
                self.ui.footer(self.footer_text())

    # --- member lookup ------------------------------------------------------
    def lookup(self):
        buttons = self.ui.keypad_buttons()
        value = ""
        self.ui.keypad("Membership ID", value, buttons)
        self.ui.footer(self.footer_text())

        while True:
            pos = self.touch.position()
            if pos is None:
                time.sleep_ms(30)
                continue
            hit = button_at(buttons, pos)
            if hit is None:
                self.touch.wait_release()
                continue
            self.buzzer.tap()
            self.ui.flash(hit, self.touch)

            if hit.key == "BACK":
                self.show_home()
                return
            if hit.key == "CLR":
                value = value[:-1]
                self.ui.keypad_value(value)
            elif hit.key == "OK":
                if not value:
                    continue
                self.show_member(value)
                return
            elif len(value) < 8:
                value += hit.key
                self.ui.keypad_value(value)

    def show_member(self, membership_id):
        self.ui.busy("Lookup", "Membership %s" % membership_id)
        try:
            data = self.api.lookup(membership_id=membership_id)
        except NetworkError as e:
            self.ui.message("No Connection", str(e), RED)
            self.hold(2500)
            self.show_home()
            return

        if not data.get("found"):
            self.ui.message("Not Found", "No member with ID %s" % membership_id, AMBER)
            self.hold(3000)
            self.show_home()
            return

        member = data["member"]
        granted = data.get("access_granted", False)
        slot = member.get("fingerprint_id")
        detail = "Finger slot %s" % slot if slot is not None else "No fingerprint enrolled"
        meta = "Until %s" % member.get("membership_end", "-")
        self.ui.result(granted, member.get("status", "").upper()[:10] or "MEMBER",
                       member.get("name", ""), detail, meta)
        self.ui.footer(self.footer_text())
        self.hold(6000)
        self.show_home()

    # --- helpers ------------------------------------------------------------
    def hold(self, ms):
        """Show a screen for a while, but let a tap cut it short."""
        deadline = time.ticks_add(time.ticks_ms(), ms)
        while time.ticks_diff(deadline, time.ticks_ms()) > 0:
            if self.touch.pressed():
                self.touch.wait_release()
                return
            time.sleep_ms(40)

    # --- main loop ----------------------------------------------------------
    def run(self):
        self.boot()
        while True:
            try:
                self.tick()

                pos = self.touch.position()
                if pos is not None:
                    hit = button_at(self.buttons, pos)
                    if hit is not None:
                        self.buzzer.tap()
                        self.ui.flash(hit, self.touch)
                        if hit.key == "INFO":
                            self.info_screen()
                    else:
                        self.touch.wait_release()
                    continue

                # Only the home screen reaches this point — every other screen
                # runs its own loop — so this is where the clock ticks over.
                self.update_clock()

                # Idle: a finger on the sensor signs in without touching anything.
                try:
                    if self.fp.get_image() == 0:
                        # Convert first, draw second. img2tz() is the step the
                        # finger has to stay still for, so anything drawn before
                        # it is added to how long the member must hold.
                        self.fp.img2tz(1)
                        self.buzzer.tap()          # "got it - you can lift off"
                        self.ui.reading("Reading", "Checking your fingerprint")
                        match = self.fp.search(1)
                        if match is None:
                            self.fp.aura(AURA_FLASH, AURA_RED, 60, 3)
                            self.buzzer.denied()
                            self.ui.result(False, "Denied", "Unknown User",
                                           "Fingerprint not registered")
                            self.hold(3000)
                            self.show_home()
                        else:
                            self.record_entry(match[0], match[1])
                except FingerprintError:
                    self.show_home("Try again - press flat and still")
                except OSError:
                    pass

                # Poll twice as often, and collect every ~3s instead of every
                # pass: a full collect between polls is dead time in which a
                # finger already on the sensor is not noticed.
                time.sleep_ms(30)
                self._since_gc += 1
                if self._since_gc >= 100:
                    self._since_gc = 0
                    gc.collect()

            except Exception as e:
                # A door terminal must not drop to the REPL in the middle of a
                # gym. Show it, then carry on.
                # The screen only has room for str(e); the console gets the
                # traceback, which is the only thing that names the failing line.
                sys.print_exception(e)
                # Kept for the health screen: by the time anyone is called out
                # to look at the terminal, this message is long off the screen.
                self.last_error = str(e)
                try:
                    self.ui.message("Error", str(e)[:80], RED)
                    self.hold(4000)
                    self.show_home()
                except Exception:
                    time.sleep(2)


if __name__ == "__main__":
    Terminal().run()
