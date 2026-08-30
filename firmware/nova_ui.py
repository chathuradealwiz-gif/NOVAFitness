"""The NOVA FITNESS terminal UI.

Follows the web app's design language (tailwind.config.ts / globals.css) so the
door terminal and the dashboard read as one product:

  - nova-black ground, nova-card panels with a nova-border hairline
  - a red rail across the top of the app bar, like .nova-rail
  - display type is uppercase and letter-spaced, like .nova-label / .nova-btn
  - one red primary action per screen, everything else a ghost button

The 8x8 font is scaled and letter-spaced to imitate Orbitron/Rajdhani's wide
uppercase; at 240x320 that is as close as a bitmap font gets.
"""

from nova_display import (Display, WIDTH, HEIGHT, BLACK, SURFACE, CARD,
                          ELEVATED, BORDER, BORDER_HI, RED, RED_DEEP, TEXT,
                          MUTED, WHITE, GREEN, AMBER)
from nova_art import Fingerprint, finger_on_sensor
import time

HEADER_H = 44
FOOTER_H = 24

# Health rows that fit between the verdict banner and the buttons.
ROWS_PER_SCREEN = 13

# Whoever is standing at the door reads this once and never again, so it is
# sized like a watermark rather than a credit line.
AUTHOR = "by Pasan Weerasinghe"


class Button:
    """A tap target. Primary buttons are the red gradient, ghost buttons the
    bordered translucent style from .nova-btn-ghost."""

    def __init__(self, label, x, y, w, h, primary=False, enabled=True, key=None):
        self.label = label
        self.x, self.y, self.w, self.h = x, y, w, h
        self.primary = primary
        self.enabled = enabled
        self.key = key if key is not None else label

    def hit(self, pos):
        if not self.enabled or pos is None:
            return False
        x, y = pos
        return self.x <= x < self.x + self.w and self.y <= y < self.y + self.h

    def draw(self, d, pressed=False):
        if self.primary:
            fill = RED_DEEP if pressed else RED
            border = RED
            fg = WHITE
        else:
            fill = ELEVATED if pressed else CARD
            border = BORDER_HI if pressed else BORDER
            fg = TEXT
        if not self.enabled:
            fill, border, fg = SURFACE, BORDER, MUTED
        d.round_frame(self.x, self.y, self.w, self.h, fill, border, r=8)
        scale = 2 if self.h >= 40 else 1
        spacing = 2 if scale == 2 else 1
        label = self.label.upper()
        while d.text_w(label, scale, spacing) > self.w - 12 and scale > 1:
            scale -= 1
            spacing = 1
        d.text_center(label, self.y + (self.h - 8 * scale) // 2, fg, fill,
                      scale, spacing, cx=self.x + self.w // 2)


class UI:
    def __init__(self, cfg):
        self.d = Display(cfg)
        self.device_code = cfg.DEVICE_CODE
        self._footer = ""
        # Two sizes: a small mark on the home card, a large one to animate on
        # the scan and enrollment screens. Built once, reused for the life of
        # the terminal (nova_art caches the row tables).
        self.fp_small = Fingerprint(34, 44, weight=2)
        self.fp_large = Fingerprint(76, 96, weight=3)
        self._band = None          # current scan band row
        self._phase = 0            # finger-on-sensor phase
        self._fill = 0             # enrollment fill percent already painted
        self._clock_text = None    # last clock string painted on the home screen
        self._ticks = 0

    # --- chrome -------------------------------------------------------------
    def header(self, title=None, accent=RED):
        d = self.d
        d.fill_rect(0, 0, WIDTH, HEADER_H, SURFACE)
        d.fill_rect(0, 0, WIDTH, 2, accent)          # the .nova-rail highlight
        d.hline(0, HEADER_H - 1, WIDTH, BORDER)
        if title:
            d.text(title.upper(), 12, 18, TEXT, SURFACE, 1, 2)
        else:
            # Wordmark: NOVA in text, FITNESS in red, as in components/Logo.
            x = d.text("NOVA", 12, 16, TEXT, SURFACE, 2, 2)
            d.text(" FITNESS", x, 16, RED, SURFACE, 2, 2)

    def footer(self, text):
        d = self.d
        y = HEIGHT - FOOTER_H
        d.fill_rect(0, y, WIDTH, FOOTER_H, SURFACE)
        d.hline(0, y, WIDTH, BORDER)
        d.text(text[:29], 8, y + 8, MUTED, SURFACE, 1, 0)
        self._footer = text

    def body(self, color=BLACK):
        self.d.fill_rect(0, HEADER_H, WIDTH, HEIGHT - HEADER_H - FOOTER_H, color)

    def label(self, text, x, y, color=MUTED):
        """The .nova-label style: tiny, uppercase, widely tracked."""
        self.d.text(text.upper(), x, y, color, None, 1, 2)

    def watermark(self, y, bg=BLACK):
        self.d.text_center(AUTHOR, y, MUTED, bg, 1, 0)

    # --- screens ------------------------------------------------------------
    def splash(self, line=""):
        d = self.d
        d.fill(BLACK)
        d.text_center("NOVA", 118, TEXT, BLACK, 4, 4)
        d.text_center("FITNESS", 166, RED, BLACK, 3, 4)
        d.hline(60, 206, 120, BORDER)
        d.text_center(line.upper()[:26], 224, MUTED, BLACK, 1, 1)
        self.watermark(292)

    def status_line(self, line):
        """Repaint just the splash's status line, without redrawing the logo."""
        self.d.fill_rect(0, 224, WIDTH, 10, BLACK)
        self.d.text_center(line.upper()[:26], 224, MUTED, BLACK, 1, 1)

    def home(self, buttons, hint="Place finger to sign in", clock="", date=""):
        d = self.d
        self.header()
        self.body()
        # The clock is what members look at while they wait, so it gets the top
        # of the screen and the largest type on the terminal.
        d.round_frame(12, 54, WIDTH - 24, 62, CARD, BORDER, r=10)
        self._clock_text = None
        self.clock(clock, date)
        # Scan card: the primary affordance, with the red accent rail on the
        # left edge that .nova-card-accent gives the "today" cards on the web.
        d.round_frame(12, 124, WIDTH - 24, 104, CARD, BORDER, r=10)
        d.fill_rect(14, 138, 3, 76, RED)
        self.label("Fingerprint", 28, 140)
        d.text("READY", 28, 158, TEXT, CARD, 3, 3)
        for i, line in enumerate(d.wrap(hint, 17)[:2]):
            d.text(line, 28, 194 + i * 12, MUTED, CARD, 1, 0)
        # The fingerprint mark sits inside the card, on the red rail's side of
        # the panel, so "READY" and the thing you press are one object.
        self.fp_small.draw(d, 180, 152, RED)
        for b in buttons:
            b.draw(d)
        self.watermark(286)

    def clock(self, text, date=""):
        """Repaint just the clock, so the minute can tick over without the home
        screen being redrawn under a member's finger."""
        if text == self._clock_text:
            return
        self._clock_text = text
        d = self.d
        d.fill_rect(16, 58, WIDTH - 32, 54, CARD)
        if text:
            d.text_center(text, 62, TEXT, CARD, 4, 4)
            if date:
                d.text_center(date.upper()[:26], 100, MUTED, CARD, 1, 1)
        else:
            # No clock until the first heartbeat: the board has no RTC battery,
            # and a wrong time is worse than none on the screen members read.
            d.text_center("NOVA FITNESS", 76, MUTED, CARD, 2, 2)

    # --- info / admin -------------------------------------------------------
    def info(self, buttons):
        """Staff actions, one tap off the home screen. Members see a red INFO
        button and nothing else; the admin actions live behind it."""
        d = self.d
        self.header("Info")
        self.body()
        d.round_frame(12, 58, WIDTH - 24, 74, CARD, BORDER, r=10)
        d.fill_rect(14, 72, 3, 46, RED)
        self.label("Staff", 28, 74)
        for i, line in enumerate(d.wrap("Admin actions for this terminal.", 24)[:2]):
            d.text(line, 28, 94 + i * 12, MUTED, CARD, 1, 0)
        for b in buttons:
            b.draw(d)

    def health(self, rows, faults, buttons):
        """Diagnostics: a verdict banner, then one line per check.

        The banner exists so the answer to "is it broken?" does not require
        reading fifteen rows: green and a count, or red and the first fault
        named. The rows below are the detail for whoever has to fix it.
        """
        d = self.d
        self.header("Device Health", RED if faults else GREEN)
        self.body()

        accent = RED if faults else GREEN
        d.round_frame(12, 48, WIDTH - 24, 22, CARD, accent, r=8)
        if faults:
            banner = "%d FAULT%s" % (len(faults), "" if len(faults) == 1 else "S")
        else:
            banner = "ALL CHECKS PASS"
        d.text_center(banner, 55, accent, CARD, 1, 2)

        # 12px pitch is what makes every check fit between the banner and the
        # buttons. Paging through diagnostics while standing at a broken door is
        # its own small punishment, so the whole list is on one screen.
        d.round_frame(12, 74, WIDTH - 24, 170, CARD, BORDER, r=10)
        y = 80
        for label, value, color in rows[:ROWS_PER_SCREEN]:
            d.text(label.upper()[:10], 24, y, MUTED, CARD, 1, 1)
            d.text(str(value)[:13], 118, y, color, CARD, 1, 0)
            y += 12

        for b in buttons:
            b.draw(d)

    # --- fingerprint scan ---------------------------------------------------
    def scan(self, title="Scanning", detail="Place your finger on the sensor"):
        """Waiting for a finger: a large print with a travelling scan band, and
        below it a fingertip coming down onto the sensor pad."""
        d = self.d
        self.header(title)
        self.body()
        d.round_frame(12, 58, WIDTH - 24, 206, CARD, BORDER, r=10)
        d.fill_rect(14, 72, 3, 60, RED)
        self.fp_large.draw(d, 82, 72, BORDER_HI)
        self._band = None
        self._phase = 0
        self._ticks = 0
        finger_on_sensor(d, 89, 178, 0)
        for i, line in enumerate(d.wrap(detail, 26)[:2]):
            d.text_center(line, 236 + i * 14, MUTED, CARD, 1, 0)

    def scan_tick(self):
        """One animation frame. Called from the sensor poll loop, so it must
        stay cheap - it repaints two bands of ridges and the fingertip."""
        d = self.d
        h = self.fp_large.h
        nxt = 0 if self._band is None else self._band + 6
        if nxt >= h:
            nxt = 0
        self.fp_large.scan(d, 82, 72, self._band, nxt)
        self._band = nxt
        self._ticks += 1
        if self._ticks % 3 == 0:
            self._phase = (self._phase + 1) % 6
            finger_on_sensor(d, 89, 178, self._phase)

    # --- reading ------------------------------------------------------------
    def reading(self, title="Reading", detail="Checking your fingerprint"):
        """Static: the fingerprint mark and the word. The search and the Edge
        Function call both block, so anything moving here would only freeze
        part-way through and look broken."""
        d = self.d
        # The wordmark, not the screen title, in the header: a member looking up
        # mid-scan should see whose door this is. "READING" is on the card.
        self.header()
        self.body()
        d.round_frame(12, 70, WIDTH - 24, 150, CARD, BORDER, r=10)
        self.fp_large.draw(d, 82, 92, RED)
        d.text_center(title.upper()[:16], 196, TEXT, CARD, 2, 2)

    def busy(self, title, detail="", accent=RED):
        d = self.d
        self.header(title, accent)
        self.body()
        d.round_frame(12, 70, WIDTH - 24, 150, CARD, BORDER, r=10)
        lines = d.wrap(detail, 20)[:4]
        y = 118 - len(lines) * 10
        d.text_center(title.upper()[:16], y, TEXT, CARD, 2, 2)
        for i, line in enumerate(lines):
            d.text_center(line, y + 34 + i * 14, MUTED, CARD, 1, 1)
        return y + 34 + len(lines) * 14

    # --- enrollment ---------------------------------------------------------
    def enroll_begin(self, member):
        """Chrome for the enrollment screen, drawn once.

        Each step then repaints only the percentage, the ridges that changed
        and the instruction - a full redraw per capture makes the screen blink
        at exactly the moment the member is being told to hold still.
        """
        d = self.d
        self.header("Enrolling", AMBER)
        self.body()
        d.round_frame(12, 58, WIDTH - 24, 206, CARD, BORDER, r=10)
        d.fill_rect(14, 72, 3, 40, AMBER)
        self.fp_large.draw(d, 30, 104, BORDER_HI)
        self._fill = 0
        self._phase = 0
        self._ticks = 0
        finger_on_sensor(d, 148, 126, 0, accent=AMBER)
        d.text_center(member[:26], 76, TEXT, CARD, 1, 1)

    def enroll_step(self, step, total, msg):
        d = self.d
        pct = step * 100 // total
        d.fill_rect(60, 88, 120, 16, CARD)
        d.text_center("%d%%" % pct, 88, AMBER, CARD, 2, 2)
        self.fp_large.fill(d, 30, 104, self._fill, pct, hot=AMBER)
        self._fill = pct
        self.progress(step, total, y=214, color=AMBER)
        d.fill_rect(20, 228, WIDTH - 40, 28, CARD)
        for i, line in enumerate(d.wrap(msg, 26)[:2]):
            d.text_center(line, 228 + i * 14, MUTED, CARD, 1, 0)

    def enroll_tick(self):
        """The fingertip keeps moving while the sensor waits for a capture, so
        a member who has not placed their finger yet can see what to do."""
        self._ticks += 1
        if self._ticks % 3:
            return
        self._phase = (self._phase + 1) % 6
        finger_on_sensor(self.d, 148, 126, self._phase, accent=AMBER)

    def progress(self, step, total, y=196, color=RED):
        """Segmented bar for the two-capture enrollment."""
        d = self.d
        seg = (WIDTH - 56) // total
        for i in range(total):
            x = 28 + i * seg
            d.fill_rect(x, y, seg - 6, 5, color if i < step else BORDER)

    def result(self, granted, title, name="", detail="", meta=""):
        """The scan verdict. Green only ever means the door opened; every
        denial is nova-red, matching the dashboard's status pills."""
        d = self.d
        accent = GREEN if granted else RED
        self.header("Access", accent)
        self.body()
        d.round_frame(12, 58, WIDTH - 24, 190, CARD, accent, r=10)
        d.fill_rect(12, 58, WIDTH - 24, 4, accent)
        d.text_center(title.upper()[:14], 88, accent, CARD, 3, 3)
        if name:
            for i, line in enumerate(d.wrap(name, 19)[:2]):
                d.text_center(line, 132 + i * 18, TEXT, CARD, 2, 1)
        y = 176
        for line in d.wrap(detail, 26)[:2]:
            d.text_center(line, y, MUTED, CARD, 1, 0)
            y += 14
        if meta:
            d.hline(28, 214, WIDTH - 56, BORDER)
            d.text_center(meta[:28], 226, MUTED, CARD, 1, 0)

    def message(self, title, detail="", accent=AMBER, buttons=()):
        d = self.d
        self.header(title, accent)
        self.body()
        d.round_frame(12, 62, WIDTH - 24, 140, CARD, BORDER, r=10)
        d.text_center(title.upper()[:16], 86, accent, CARD, 2, 2)
        y = 122
        for line in d.wrap(detail, 26)[:4]:
            d.text_center(line, y, MUTED, CARD, 1, 0)
            y += 14
        for b in buttons:
            b.draw(d)

    # --- numeric keypad -----------------------------------------------------
    def keypad_buttons(self):
        """Twelve keys, thumb-sized. Layout mirrors a phone dial pad."""
        keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "CLR", "0", "OK"]
        out = []
        bw, bh, gap = 68, 42, 8
        x0, y0 = 14, 128
        for i, k in enumerate(keys):
            col, row = i % 3, i // 3
            out.append(Button(k, x0 + col * (bw + gap), y0 + row * (bh + gap),
                              bw, bh, primary=(k == "OK"), key=k))
        out.append(Button("Back", 14, 128 + 4 * (bh + gap), 212, 38, key="BACK"))
        return out

    def keypad(self, prompt, value, buttons):
        d = self.d
        self.header(prompt)
        self.body()
        d.round_frame(12, 58, WIDTH - 24, 56, ELEVATED, BORDER_HI if value else BORDER, r=10)
        shown = value if value else "-"
        d.text_center(shown[:12], 78, TEXT if value else MUTED, ELEVATED, 3, 3)
        for b in buttons:
            b.draw(d)

    def keypad_value(self, value):
        """Repaint only the entry field, so a keypress feels instant."""
        d = self.d
        d.round_rect(14, 60, WIDTH - 28, 52, ELEVATED, r=9)
        shown = value if value else "-"
        d.text_center(shown[:12], 78, TEXT if value else MUTED, ELEVATED, 3, 3)

    # --- feedback -----------------------------------------------------------
    def flash(self, button, touch):
        """Press state, then wait for the finger to come off."""
        button.draw(self.d, pressed=True)
        touch.wait_release()
        button.draw(self.d, pressed=False)
