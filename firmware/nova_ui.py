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
import time

HEADER_H = 44
FOOTER_H = 24


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

    # --- screens ------------------------------------------------------------
    def splash(self, line=""):
        d = self.d
        d.fill(BLACK)
        d.text_center("NOVA", 118, TEXT, BLACK, 4, 4)
        d.text_center("FITNESS", 166, RED, BLACK, 3, 4)
        d.hline(60, 206, 120, BORDER)
        d.text_center(line.upper()[:26], 224, MUTED, BLACK, 1, 1)

    def status_line(self, line):
        """Repaint just the splash's status line, without redrawing the logo."""
        self.d.fill_rect(0, 224, WIDTH, 10, BLACK)
        self.d.text_center(line.upper()[:26], 224, MUTED, BLACK, 1, 1)

    def home(self, buttons, hint="Place finger to sign in"):
        d = self.d
        self.header()
        self.body()
        # Scan card: the primary affordance, with the red accent rail on the
        # left edge that .nova-card-accent gives the "today" cards on the web.
        d.round_frame(12, 58, WIDTH - 24, 116, CARD, BORDER, r=10)
        d.fill_rect(14, 72, 3, 88, RED)
        self.label("Fingerprint", 28, 74)
        d.text("READY", 28, 92, TEXT, CARD, 3, 3)
        for i, line in enumerate(d.wrap(hint, 24)[:2]):
            d.text(line, 28, 132 + i * 12, MUTED, CARD, 1, 0)
        for b in buttons:
            b.draw(d)

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

    def progress(self, step, total, y=196):
        """Segmented bar for the two-capture enrollment."""
        d = self.d
        seg = (WIDTH - 56) // total
        for i in range(total):
            x = 28 + i * seg
            d.fill_rect(x, y, seg - 6, 5, RED if i < step else BORDER)

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
