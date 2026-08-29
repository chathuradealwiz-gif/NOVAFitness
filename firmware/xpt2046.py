"""XPT2046 resistive touch controller."""

from machine import Pin, SoftSPI
import time

_CMD_X = 0xD0
_CMD_Y = 0x90


class Touch:
    def __init__(self, cfg):
        # Software SPI on purpose: the display owns hardware SPI(2) at 40 MHz
        # (nova_display.py). Opening SPI(2) here re-pointed that one peripheral
        # at the touch pins, so every display write after Touch() was created
        # went out pins 14/21/47 and the panel froze on whatever it last showed.
        # The XPT2046 only needs 1 MHz, so bit-banging it costs nothing.
        self.spi = SoftSPI(
            baudrate=1_000_000,
            polarity=0,
            phase=0,
            sck=Pin(cfg.PIN_TCH_CLK),
            mosi=Pin(cfg.PIN_TCH_MOSI),
            miso=Pin(cfg.PIN_TCH_MISO),
        )

        self.cs = Pin(cfg.PIN_TCH_CS, Pin.OUT, value=1)
        self.irq = Pin(cfg.PIN_TCH_IRQ, Pin.IN, Pin.PULL_UP)

        self.cal = cfg.TOUCH_CAL
        self.swap = cfg.TOUCH_SWAP_XY
        self.inv_x = cfg.TOUCH_INVERT_X
        self.inv_y = cfg.TOUCH_INVERT_Y

        self.width = 240
        self.height = 320

        self._rx = bytearray(2)

    def _read(self, cmd):
        """Read one 12-bit value from the XPT2046."""
        self.cs.value(0)
        time.sleep_us(5)

        self.spi.write(bytes([cmd]))
        self.spi.readinto(self._rx)

        self.cs.value(1)
        time.sleep_us(5)

        return ((self._rx[0] << 8) | self._rx[1]) >> 3

    def _median(self, cmd, n=5):
        vals = []

        for _ in range(n):
            vals.append(self._read(cmd))

        vals.sort()
        return vals[n // 2]

    def pressed(self):
        return self.irq.value() == 0

    def raw(self):
        """Return a raw X/Y touch point, or None."""

        if not self.pressed():
            return None

        # Allow the panel to settle after the finger touches it.
        time.sleep_ms(10)

        x = self._median(_CMD_X)
        y = self._median(_CMD_Y)

        if not self.pressed():
            return None

        # Basic sanity check.
        if x < 100 or y < 100:
            return None

        if x > 4000 or y > 4000:
            return None

        return x, y

    def position(self):
        """Return touch position in screen pixels, or None."""

        r = self.raw()

        if r is None:
            return None

        rx, ry = r

        if self.swap:
            rx, ry = ry, rx

        xmin, xmax, ymin, ymax = self.cal

        x = (rx - xmin) * self.width // max(1, xmax - xmin)
        y = (ry - ymin) * self.height // max(1, ymax - ymin)

        if self.inv_x:
            x = self.width - 1 - x

        if self.inv_y:
            y = self.height - 1 - y

        x = min(self.width - 1, max(0, x))
        y = min(self.height - 1, max(0, y))

        return x, y

    def wait_release(self, timeout_ms=1500):
        start = time.ticks_ms()

        while self.pressed():
            if time.ticks_diff(time.ticks_ms(), start) > timeout_ms:
                return

            time.sleep_ms(10)

        time.sleep_ms(30)

    def tap(self):
        """Return the touch position after a completed press."""

        p = self.position()

        if p is None:
            return None

        self.wait_release()

        return p