"""Where does sign-in time actually go?

    import diag_timing

Place your finger when asked. Prints milliseconds per stage.
"""

import time
import config as cfg
from r503 import R503
from nova_net import WiFi, SupabaseDevice, iso_now
from nova_store import Store


def ms(t0):
    return time.ticks_diff(time.ticks_ms(), t0)


fp = R503(cfg)
wifi = WiFi(cfg)
api = SupabaseDevice(cfg, wifi)
store = Store(cfg.DEVICE_CODE)

t = time.ticks_ms()
wifi.connect()
print("wifi.connect        %5d ms" % ms(t))

print("\nPLACE YOUR FINGER NOW")
t = time.ticks_ms()
while fp.get_image() != 0:
    time.sleep_ms(20)
print("waiting for finger  %5d ms  (your reaction time, not the device)" % ms(t))

t = time.ticks_ms()
fp.img2tz(1)
print("img2tz  (HOLD TIME) %5d ms  <-- how long the finger must stay still" % ms(t))
print("  ...you can lift off now")

t = time.ticks_ms()
match = fp.search(1)
print("search 200 slots    %5d ms  -> %s" % (ms(t), match))

t = time.ticks_ms()
data = api.attendance(store.next_event_id(), match[0] if match else 1, "entry", iso_now())
net = ms(t)
print("attendance (HTTPS)  %5d ms  -> granted=%s" % (net, data.get("access_granted")))

t = time.ticks_ms()
api.heartbeat(0)
print("2nd HTTPS call      %5d ms  (shows per-request TLS cost)" % ms(t))

print("\nThe screen holds after this are fixed waits in main.py:")
print("  granted -> hold(2000) = 2.0 s")
print("  denied  -> hold(3500) = 3.5 s")
