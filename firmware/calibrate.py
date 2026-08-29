"""Touch calibration. Run once from Thonny, then paste the result into config.py.

    >>> import calibrate

Tap the crosshair in each corner. The script prints the TOUCH_CAL tuple and the
swap/invert flags for your panel's orientation.
"""

import time
import config as cfg
from nova_display import Display, BLACK, RED, TEXT, MUTED, CARD, WIDTH, HEIGHT
from xpt2046 import Touch

TARGETS = [(20, 20, "TOP LEFT"), (WIDTH - 20, 20, "TOP RIGHT"),
           (20, HEIGHT - 20, "BOTTOM LEFT"), (WIDTH - 20, HEIGHT - 20, "BOTTOM RIGHT")]


def crosshair(d, x, y):
    d.fill_rect(x - 12, y - 1, 25, 3, RED)
    d.fill_rect(x - 1, y - 12, 3, 25, RED)


def sample(d, t, x, y, label):
    d.fill(BLACK)
    d.text_center("TAP THE CROSS", 130, TEXT, BLACK, 2, 2)
    d.text_center(label, 160, MUTED, BLACK, 1, 2)
    crosshair(d, x, y)
    while t.pressed():
        time.sleep_ms(20)
    raw = None
    while raw is None:
        raw = t.raw()
        time.sleep_ms(20)
    t.wait_release(3000)
    return raw


def run():
    d = Display(cfg)
    t = Touch(cfg)
    pts = [sample(d, t, x, y, label) for x, y, label in TARGETS]

    rx = [p[0] for p in pts]
    ry = [p[1] for p in pts]

    # Which raw axis moves with the screen's X? Compare the left pair against
    # the right pair; whichever raw axis separates them is the X axis.
    dx_rx = abs((rx[1] + rx[3]) - (rx[0] + rx[2]))
    dx_ry = abs((ry[1] + ry[3]) - (ry[0] + ry[2]))
    swap = dx_ry > dx_rx

    xs, ys = (ry, rx) if swap else (rx, ry)
    x_left = (xs[0] + xs[2]) // 2
    x_right = (xs[1] + xs[3]) // 2
    y_top = (ys[0] + ys[1]) // 2
    y_bottom = (ys[2] + ys[3]) // 2

    invert_x = x_left > x_right
    invert_y = y_top > y_bottom
    cal = (min(x_left, x_right), max(x_left, x_right),
           min(y_top, y_bottom), max(y_top, y_bottom))

    d.fill(BLACK)
    d.text_center("PASTE INTO", 90, MUTED, BLACK, 1, 2)
    d.text_center("CONFIG.PY", 110, TEXT, BLACK, 2, 2)
    d.text_center("SEE THONNY", 150, MUTED, BLACK, 1, 2)

    print("\n# --- paste into config.py ---")
    print("TOUCH_CAL = %r" % (cal,))
    print("TOUCH_SWAP_XY = %s" % swap)
    print("TOUCH_INVERT_X = %s" % invert_x)
    print("TOUCH_INVERT_Y = %s" % invert_y)
    print("# ----------------------------\n")
    print("raw points:", pts)
    return cal


run()
