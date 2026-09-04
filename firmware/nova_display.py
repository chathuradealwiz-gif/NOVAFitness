"""ILI9341 driver for the NOVA FITNESS terminal.

Deliberately a separate file from the existing ili9341.py: the UI layer needs
scaled text, rounded panels and a fast rect fill, and this keeps the tested
prototype driver untouched. 240x320 portrait, no full framebuffer (that would
cost 150 KB), so everything draws straight to the panel.
"""

from machine import Pin, SPI
import framebuf
import time


# NOVA palette from tailwind.config.ts, converted to RGB565.
def rgb(r, g, b):
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


BLACK = rgb(0x08, 0x08, 0x0A)      # nova-black
SURFACE = rgb(0x10, 0x10, 0x14)    # nova-surface
CARD = rgb(0x16, 0x16, 0x1C)       # nova-card
ELEVATED = rgb(0x1D, 0x1D, 0x25)   # nova-elevated
BORDER = rgb(0x26, 0x26, 0x2F)     # nova-border
BORDER_HI = rgb(0x3A, 0x3A, 0x47)  # nova-borderBright
RED = rgb(0xFF, 0x1E, 0x3C)        # nova-red
RED_DEEP = rgb(0xC1, 0x10, 0x2A)   # nova-redDeep
TEXT = rgb(0xF2, 0xF2, 0xF5)       # nova-text
MUTED = rgb(0x8E, 0x8E, 0x9C)      # nova-muted
# One step below MUTED and still legible. BORDER_HI is a line colour: at 5:6:7
# per channel it disappears into the black ground when it is used for 8px type,
# which is what happened to the credit line.
DIM = rgb(0x62, 0x62, 0x70)
WHITE = rgb(0xFF, 0xFF, 0xFF)
GREEN = rgb(0x22, 0xC5, 0x5E)      # granted state only
AMBER = rgb(0xF5, 0x9E, 0x0B)

WIDTH = 240
HEIGHT = 320


class Display:
    def __init__(self, cfg):
        self.spi = SPI(2, baudrate=40_000_000, polarity=0, phase=0,
                       sck=Pin(cfg.PIN_TFT_SCK),
                       mosi=Pin(cfg.PIN_TFT_MOSI),
                       miso=Pin(cfg.PIN_TFT_MISO))
        self.cs = Pin(cfg.PIN_TFT_CS, Pin.OUT, value=1)
        self.dc = Pin(cfg.PIN_TFT_DC, Pin.OUT, value=0)
        self.rst = Pin(cfg.PIN_TFT_RST, Pin.OUT, value=1)
        # Scratch buffer for one band of pixels; 240px * 2 bytes = 480 B.
        self._band = bytearray(WIDTH * 2)
        self._glyph = bytearray(8)
        self._gfb = framebuf.FrameBuffer(self._glyph, 8, 8, framebuf.MONO_HLSB)
        self.reset()
        self.init()

    # --- low level ----------------------------------------------------------
    def _cmd(self, c, data=None):
        self.cs(0)
        self.dc(0)
        self.spi.write(bytes([c]))
        if data:
            self.dc(1)
            self.spi.write(data)
        self.cs(1)

    def reset(self):
        self.rst(1)
        time.sleep_ms(10)
        self.rst(0)
        time.sleep_ms(20)
        self.rst(1)
        time.sleep_ms(150)

    def init(self):
        self._cmd(0x01)                              # software reset
        time.sleep_ms(150)
        self._cmd(0xCF, b"\x00\xC1\x30")
        self._cmd(0xED, b"\x64\x03\x12\x81")
        self._cmd(0xE8, b"\x85\x00\x78")
        self._cmd(0xCB, b"\x39\x2C\x00\x34\x02")
        self._cmd(0xF7, b"\x20")
        self._cmd(0xEA, b"\x00\x00")
        self._cmd(0xC0, b"\x23")                     # power control 1
        self._cmd(0xC1, b"\x10")                     # power control 2
        self._cmd(0xC5, b"\x3E\x28")                 # VCOM 1
        self._cmd(0xC7, b"\x86")                     # VCOM 2
        self._cmd(0x36, b"\x48")                     # MADCTL: portrait, BGR
        self._cmd(0x3A, b"\x55")                     # 16-bit colour
        self._cmd(0xB1, b"\x00\x18")
        self._cmd(0xB6, b"\x08\x82\x27")
        self._cmd(0xF2, b"\x00")
        self._cmd(0x26, b"\x01")
        self._cmd(0xE0, b"\x0F\x31\x2B\x0C\x0E\x08\x4E\xF1\x37\x07\x10\x03\x0E\x09\x00")
        self._cmd(0xE1, b"\x00\x0E\x14\x03\x11\x07\x31\xC1\x48\x08\x0F\x0C\x31\x36\x0F")
        self._cmd(0x11)                              # sleep out
        time.sleep_ms(120)
        self._cmd(0x29)                              # display on
        time.sleep_ms(20)

    def _window(self, x, y, w, h):
        x2, y2 = x + w - 1, y + h - 1
        self._cmd(0x2A, bytes([x >> 8, x & 0xFF, x2 >> 8, x2 & 0xFF]))
        self._cmd(0x2B, bytes([y >> 8, y & 0xFF, y2 >> 8, y2 & 0xFF]))
        self.cs(0)
        self.dc(0)
        self.spi.write(b"\x2C")
        self.dc(1)

    # --- primitives ---------------------------------------------------------
    def fill_rect(self, x, y, w, h, color):
        if w <= 0 or h <= 0:
            return
        if x < 0:
            w += x
            x = 0
        if y < 0:
            h += y
            y = 0
        w = min(w, WIDTH - x)
        h = min(h, HEIGHT - y)
        if w <= 0 or h <= 0:
            return
        hi, lo = color >> 8, color & 0xFF
        row = self._band
        for i in range(w):
            row[i * 2] = hi
            row[i * 2 + 1] = lo
        line = memoryview(row)[:w * 2]
        self._window(x, y, w, h)
        for _ in range(h):
            self.spi.write(line)
        self.cs(1)

    def fill(self, color):
        self.fill_rect(0, 0, WIDTH, HEIGHT, color)

    def hline(self, x, y, w, color):
        self.fill_rect(x, y, w, 1, color)

    def vline(self, x, y, h, color):
        self.fill_rect(x, y, 1, h, color)

    def rect(self, x, y, w, h, color):
        self.hline(x, y, w, color)
        self.hline(x, y + h - 1, w, color)
        self.vline(x, y, h, color)
        self.vline(x + w - 1, y, h, color)

    def round_rect(self, x, y, w, h, color, r=6):
        """Filled panel with the corners knocked off - the rounded-2xl the web
        cards use, approximated at this size by a three-step stair."""
        self.fill_rect(x + r, y, w - 2 * r, h, color)
        self.fill_rect(x, y + r, r, h - 2 * r, color)
        self.fill_rect(x + w - r, y + r, r, h - 2 * r, color)
        step = max(1, r // 3)
        for i in range(3):
            inset = r - (i + 1) * step
            off = i * step
            self.fill_rect(x + inset, y + off, w - 2 * inset, step, color)
            self.fill_rect(x + inset, y + h - off - step, w - 2 * inset, step, color)

    def disc(self, cx, cy, r, color):
        """Filled circle, drawn as one fill_rect per row.

        A row at a time rather than per pixel: every fill_rect is a window plus
        a burst of colour, and 2r of those is fast where 3r^2 single pixels
        would be visibly slow at this size.
        """
        for dy in range(-r, r + 1):
            dx = int((r * r - dy * dy) ** 0.5)
            self.fill_rect(cx - dx, cy + dy, 2 * dx + 1, 1, color)

    def ring(self, cx, cy, r, color, weight=2):
        """The outline of a circle, `weight` pixels thick."""
        inner = max(0, r - weight)
        for dy in range(-r, r + 1):
            dx = int((r * r - dy * dy) ** 0.5)
            if abs(dy) >= inner:
                # The cap rows: solid, because the inner circle has no width
                # left to subtract here.
                self.fill_rect(cx - dx, cy + dy, 2 * dx + 1, 1, color)
                continue
            ix = int((inner * inner - dy * dy) ** 0.5)
            self.fill_rect(cx - dx, cy + dy, dx - ix, 1, color)
            self.fill_rect(cx + ix, cy + dy, dx - ix + 1, 1, color)

    def round_frame(self, x, y, w, h, fill, border, r=6):
        self.round_rect(x, y, w, h, border, r)
        self.round_rect(x + 1, y + 1, w - 2, h - 2, fill, r)

    # --- text ---------------------------------------------------------------
    def text(self, s, x, y, fg=TEXT, bg=None, scale=1, spacing=0):
        """8x8 font scaled by an integer factor. bg=None draws only the lit
        pixels, for text over a panel that is already painted."""
        cw = 8 * scale + spacing
        for ch in s:
            if x >= WIDTH:
                break
            self._char(ch, x, y, fg, bg, scale)
            x += cw
        return x

    def _char(self, ch, x, y, fg, bg, scale):
        g = self._glyph
        self._gfb.fill(0)
        self._gfb.text(ch, 0, 0, 1)
        w = 8 * scale
        if x < 0 or y < 0 or x + w > WIDTH or y + 8 * scale > HEIGHT:
            return
        if bg is None:
            for row in range(8):
                bits = g[row]
                if not bits:
                    continue
                col = 0
                while col < 8:
                    if bits & (0x80 >> col):
                        run = 1
                        while col + run < 8 and (bits & (0x80 >> (col + run))):
                            run += 1
                        self.fill_rect(x + col * scale, y + row * scale,
                                       run * scale, scale, fg)
                        col += run
                    else:
                        col += 1
            return
        fhi, flo = fg >> 8, fg & 0xFF
        bhi, blo = bg >> 8, bg & 0xFF
        band = self._band
        self._window(x, y, w, 8 * scale)
        for row in range(8):
            bits = g[row]
            p = 0
            for col in range(8):
                on = bits & (0x80 >> col)
                for _ in range(scale):
                    band[p] = fhi if on else bhi
                    band[p + 1] = flo if on else blo
                    p += 2
            line = memoryview(band)[:p]
            for _ in range(scale):
                self.spi.write(line)
        self.cs(1)

    def text_w(self, s, scale=1, spacing=0):
        return len(s) * (8 * scale + spacing)

    def text_center(self, s, y, fg=TEXT, bg=None, scale=1, spacing=0, cx=WIDTH // 2):
        x = cx - self.text_w(s, scale, spacing) // 2
        return self.text(s, max(0, x), y, fg, bg, scale, spacing)

    def wrap(self, s, cols):
        """Greedy word wrap into lines of at most `cols` characters."""
        out, line = [], ""
        for word in s.split(" "):
            if not line:
                line = word
            elif len(line) + 1 + len(word) <= cols:
                line += " " + word
            else:
                out.append(line)
                line = word
        if line:
            out.append(line)
        return out
