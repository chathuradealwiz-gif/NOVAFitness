"""Vector artwork for the terminal: the fingerprint mark and the
finger-on-sensor illustration.

There is no framebuffer on this display (nova_display.py), so nothing here can
be composited off-screen and blitted. Everything is built from fill_rect(), and
the fingerprint is precomputed once into a row -> x-offsets table so that a
moving scan band costs a few rows of small rects rather than a full redraw.

Frames are advanced by the caller from loops it already owns (the sensor poll
in r503.wait_finger), because the device has one thread and the door must not
wait on an animation.
"""

import math

from nova_display import RED, BORDER_HI, MUTED, TEXT, CARD


# --- fingerprint -------------------------------------------------------------

_CACHE = {}


def _build(w, h):
    """Concentric open arcs, as a list of x-offsets per row.

    Five ellipses sharing a centre, each clipped so the bottom stays open --
    that gap is what makes a stack of ellipses read as a fingerprint rather
    than a target.
    """
    cx = w // 2
    cy = int(h * 0.46)
    rows = [bytearray() for _ in range(h)]
    n = 5
    for k in range(n):
        f = 1.0 - k * 0.2                     # outer ridge -> inner ridge
        a = max(2, int(cx * f * 0.94))
        b = max(3, int(cy * f * 1.02))
        for y in range(max(0, cy - b), min(h, cy + b)):
            t = (y - cy) / float(b)
            if t * t >= 1.0:
                continue
            dx = a * math.sqrt(1.0 - t * t)
            # Below the centre the arc narrows to nothing; cut it before it
            # closes so the ridges end in open tails.
            if y > cy and dx < a * 0.34:
                continue
            for x in (cx - int(dx), cx + int(dx)):
                if 0 <= x < w - 1:
                    rows[y].append(x)
    return rows


def _rows(w, h):
    key = (w, h)
    table = _CACHE.get(key)
    if table is None:
        table = _build(w, h)
        _CACHE[key] = table
    return table


class Fingerprint:
    """A fingerprint at a fixed pixel size, drawable and animatable in place."""

    def __init__(self, w, h, weight=2):
        self.w = w
        self.h = h
        self.weight = weight
        self.rows = _rows(w, h)

    def _paint(self, d, x, y, r0, r1, color):
        wt = self.weight
        for r in range(max(0, r0), min(self.h, r1)):
            row = self.rows[r]
            yy = y + r
            for xo in row:
                d.fill_rect(x + xo, yy, wt, 1, color)

    def draw(self, d, x, y, color=BORDER_HI):
        self._paint(d, x, y, 0, self.h, color)

    def scan(self, d, x, y, prev, cur, hot=RED, base=BORDER_HI, band=7):
        """Move the highlight band from `prev` to `cur` (row indices).

        Only the two bands are touched, so a frame is ~14 rows of rects and the
        sensor keeps being polled at its normal rate.
        """
        if prev is not None:
            self._paint(d, x, y, prev, prev + band, base)
        self._paint(d, x, y, cur, cur + band, hot)

    def fill(self, d, x, y, prev_pct, pct, hot=RED, base=BORDER_HI):
        """Fill the ridges bottom-up to `pct`, repainting only the change."""
        p0 = self.h - (self.h * max(0, min(100, prev_pct)) // 100)
        p1 = self.h - (self.h * max(0, min(100, pct)) // 100)
        if p1 < p0:
            self._paint(d, x, y, p1, p0, hot)     # grew
        elif p1 > p0:
            self._paint(d, x, y, p0, p1, base)    # shrank / reset


# --- finger meeting the sensor ----------------------------------------------

def finger_on_sensor(d, x, y, phase, bg=CARD, accent=RED):
    """A fingertip coming down onto the sensor pad, 6 phases.

    Occupies 62x52 from (x, y). Phase 0-3 is the approach, 4-5 is contact with
    the ring lit -- so the member can see *what* to do, not just read that they
    should do it.
    """
    d.fill_rect(x, y, 62, 52, bg)

    drop = (phase if phase < 4 else 3) * 3          # 0,3,6,9 then held at 9
    contact = phase >= 4

    # Sensor pad: a rounded plate with a ring. Drawn art, not a portrait of the
    # module - it reads as "put your finger here" on any sensor.
    py = y + 34
    d.round_frame(x + 8, py, 46, 16, bg, accent if contact else BORDER_HI, r=6)
    d.fill_rect(x + 20, py + 6, 22, 3, accent if contact else MUTED)

    # Fingertip: a rounded stub pointing down.
    fy = y + 2 + drop
    d.round_rect(x + 22, fy, 18, 26, TEXT if contact else MUTED, r=7)
    d.fill_rect(x + 26, fy + 6, 10, 2, bg)          # a nail crease, for shape
    d.fill_rect(x + 26, fy + 11, 10, 2, bg)

    if contact:
        # Contact ticks flanking the fingertip - drawn beside it, not over it,
        # so the finger stays a solid shape.
        spread = 4 if phase == 4 else 8
        for side in (x + 20 - spread, x + 42 + spread):
            d.hline(side - 3, py - 5, 6, accent)
            d.hline(side - 2, py - 10, 4, accent)


