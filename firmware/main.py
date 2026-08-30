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
import time
import gc

import config as cfg
from nova_display import RED, GREEN, AMBER, MUTED
from nova_ui import UI, Button
from xpt2046 import Touch
from r503 import R503, FingerprintError, AURA_BREATHE, AURA_FLASH, AURA_OFF, BLUE, PURPLE
from r503 import RED as AURA_RED
from nova_net import WiFi, SupabaseDevice, NetworkError, iso_now
from nova_store import Store


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
        self.buttons = self._home_buttons()

    # --- layout -------------------------------------------------------------
    def _home_buttons(self):
        """One button only. Signing in needs no button - the idle loop watches
        the sensor - so the only thing staff ever has to press is enrollment."""
        return [
            Button("Add New User", 12, 240, 216, 44, primary=True, key="ENROLL"),
        ]

    def footer_text(self):
        net = "ONLINE" if self.online else "OFFLINE"
        pending = self.store.pending()
        tail = " Q%d" % pending if pending else ""
        return "%s  %s%s" % (cfg.DEVICE_CODE, net, tail)

    def show_home(self, hint="Place finger to sign in"):
        self.ui.home(self.buttons, hint)
        self.ui.footer(self.footer_text())
        self.fp.aura(AURA_BREATHE, BLUE, 100)

    # --- boot ---------------------------------------------------------------
    def boot(self):
        self.ui.status_line("Connecting Wi-Fi")
        if self.wifi.connect():
            self.ui.status_line("Contacting NOVA")
            try:
                self.api.heartbeat(self.store.pending())
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
        data = self.api.sync(events)
        accepted = data.get("accepted", [])
        if accepted:
            self.store.drop(accepted)
        if data.get("cache") is not None:
            self.store.save_cache(data["cache"])
        if data.get("server_time"):
            self.api.set_clock(data["server_time"])

    def tick(self):
        """Timed background work. Never raises into the main loop."""
        now = time.ticks_ms()
        if time.ticks_diff(now, self.last_heartbeat) > cfg.HEARTBEAT_SECONDS * 1000:
            self.last_heartbeat = now
            try:
                self.api.heartbeat(self.store.pending())
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
        self.ui.busy("Scanning", "Place your finger on the sensor")
        self.ui.footer(self.footer_text())
        self.fp.aura(AURA_BREATHE, BLUE, 60)
        if prompted:
            self.buzzer.prompt()

        try:
            if not self.fp.wait_finger(8000):
                self.fp.aura(AURA_OFF, BLUE)
                self.show_home("Timed out - try again")
                return
            self.fp.img2tz(1)
            self.buzzer.tap()
            self.ui.busy("Reading", "Checking your fingerprint")
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

        self.ui.busy("Enrolling", member, accent=AMBER)
        self.ui.footer("ID %s" % membership_id if membership_id else self.footer_text())
        self.buzzer.prompt()
        time.sleep_ms(700)

        try:
            slot = self.fp.free_slot()
            if slot is None:
                raise OSError("Sensor full")

            def on_step(step, msg):
                # msg is the instruction for the member ("place flat", "lift
                # off"); the percentage tells staff it is still moving.
                self.ui.busy("Enrolling  %d%%" % (step * 100 // 4), msg,
                             accent=AMBER)
                self.ui.progress(step, 4)
                self.ui.footer(member[:26])
                if step in (1, 2):
                    self.buzzer.prompt()
                self.api.report_progress(request_id, step, 4, msg)

            self.fp.enroll(slot, on_step=on_step)
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
                        if hit.key == "ENROLL":
                            self.enroll_pressed()
                    else:
                        self.touch.wait_release()
                    continue

                # Idle: a finger on the sensor signs in without touching anything.
                try:
                    if self.fp.get_image() == 0:
                        # Convert first, draw second. img2tz() is the step the
                        # finger has to stay still for, so anything drawn before
                        # it is added to how long the member must hold.
                        self.fp.img2tz(1)
                        self.buzzer.tap()          # "got it - you can lift off"
                        self.ui.busy("Reading", "Checking your fingerprint")
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
                try:
                    self.ui.message("Error", str(e)[:80], RED)
                    self.hold(4000)
                    self.show_home()
                except Exception:
                    time.sleep(2)


if __name__ == "__main__":
    Terminal().run()
