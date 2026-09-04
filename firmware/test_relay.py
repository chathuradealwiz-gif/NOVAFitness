"""Solenoid bench test. Run from Thonny with the lock wired up.

    >>> import test_relay              # three pulses, as the door does them
    >>> test_relay.pulse(3000)         # hold it open for three seconds
    >>> test_relay.hold()              # energised until you press Ctrl-C
    >>> test_relay.idle()              # force it back to locked

Uses PIN_DOOR_RELAY / RELAY_ACTIVE_HIGH / DOOR_UNLOCK_MS from config.py, so
what you hear here is exactly what a granted fingerprint does - if the polarity
is wrong the lock sits open at import and clicks shut on the pulse, which is
the sign to flip RELAY_ACTIVE_HIGH.
"""

import time
from machine import Pin

import config as cfg

ON = 1 if cfg.RELAY_ACTIVE_HIGH else 0
OFF = 1 - ON

if cfg.PIN_DOOR_RELAY is None:
    raise SystemExit("PIN_DOOR_RELAY is None in config.py - nothing to test")

relay = Pin(cfg.PIN_DOOR_RELAY, Pin.OUT, value=OFF)


def idle():
    """Back to locked. Worth calling after a Ctrl-C out of hold()."""
    relay(OFF)


def pulse(ms=None):
    ms = ms or cfg.DOOR_UNLOCK_MS
    print("unlock  %d ms" % ms)
    relay(ON)
    time.sleep_ms(ms)
    relay(OFF)
    print("lock")


def hold():
    """Energised until interrupted - for checking the coil does not cook."""
    print("holding unlocked; Ctrl-C to stop")
    relay(ON)
    try:
        while True:
            time.sleep_ms(200)
    finally:
        idle()
        print("lock")


def run(times=3, gap_ms=1500):
    print("relay on GPIO%d, active %s" %
          (cfg.PIN_DOOR_RELAY, "high" if cfg.RELAY_ACTIVE_HIGH else "low"))
    try:
        for i in range(times):
            print("-- %d/%d" % (i + 1, times))
            pulse()
            time.sleep_ms(gap_ms)
    finally:
        # A Ctrl-C mid-pulse would otherwise leave the door standing open.
        idle()


run()
