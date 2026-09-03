"""Bring-up test. Run in Thonny before main.py:  >>> import selftest

Checks each subsystem in the order that failures cascade, so the first FAIL is
the one to fix.
"""

import time
import config as cfg
from machine import Pin, SPI

def line(name, ok, detail=""):
    print("%-22s %s %s" % (name, "PASS" if ok else "FAIL", detail))
    return ok


def run():
    print("\nNOVA FITNESS device self-test - %s\n" % cfg.DEVICE_CODE)

    # 1. Display
    try:
        from nova_display import Display, RED, TEXT, BLACK
        d = Display(cfg)
        d.fill(BLACK)
        d.text_center("SELF TEST", 140, RED, BLACK, 2, 2)
        line("TFT ILI9341", True)
    except Exception as e:
        line("TFT ILI9341", False, str(e))
        return

    # 2. Touch
    try:
        from xpt2046 import Touch
        t = Touch(cfg)
        d.text_center("TOUCH THE SCREEN", 180, TEXT, BLACK, 1, 1)
        deadline = time.ticks_add(time.ticks_ms(), 8000)
        pos = None
        while pos is None and time.ticks_diff(deadline, time.ticks_ms()) > 0:
            pos = t.position()
            time.sleep_ms(30)
        line("XPT2046 touch", pos is not None,
             "at %s" % (pos,) if pos else "no touch in 8 s - check T_IRQ/T_CS wiring")
    except Exception as e:
        line("XPT2046 touch", False, str(e))

    # 3. Fingerprint sensor
    try:
        from fingerprint import Fingerprint
        fp = Fingerprint(cfg)
        capacity = fp.capacity()
        count = fp.template_count()
        line("Fingerprint sensor", True,
             "%d of %d slots used, %d free" % (count, capacity, capacity - count))
        print("                       used slots: %s" % fp.used_slots())
    except Exception as e:
        line("Fingerprint sensor", False, str(e))

    # 4. Buzzer
    try:
        from machine import Pin, PWM
        p = PWM(Pin(cfg.PIN_BUZZER), freq=2200, duty=512)
        time.sleep_ms(150)
        p.deinit()
        line("Buzzer", True, "did you hear it?")
    except Exception as e:
        line("Buzzer", False, str(e))

    # 5. Uplink - Wi-Fi, 4G, or Wi-Fi with 4G behind it (LINK in config.py)
    from nova_net import Uplink, SupabaseDevice, NetworkError
    wifi = Uplink(cfg, on_status=lambda m: print("   ...", m))
    if not line("Uplink (%s)" % getattr(cfg, "LINK", "auto"),
                wifi.connect(), wifi.status_text()):
        return

    # 6. Supabase Edge Functions, one at a time
    api = SupabaseDevice(cfg, wifi)
    try:
        hb = api.heartbeat(0)
        line("device-heartbeat", True, hb.get("server_time", ""))
    except NetworkError as e:
        line("device-heartbeat", False, str(e))
        print("\n  device_unauthorized => re-run scripts/provision-device.mjs")
        print("  and copy DEVICE_CODE / DEVICE_KEY into config.py.\n")
        return

    try:
        data = api.sync([])
        line("device-sync", True, "%d members cached" % len(data.get("cache", [])))
    except NetworkError as e:
        line("device-sync", False, str(e))

    try:
        enrollment = api.poll_enrollment()
        line("fingerprint-assignment", True,
             "pending: %s" % (enrollment.get("member_name") if enrollment else "none"))
    except NetworkError as e:
        line("fingerprint-assignment", False, str(e))

    print("\nAll green? Reboot and main.py takes over.\n")


run()
