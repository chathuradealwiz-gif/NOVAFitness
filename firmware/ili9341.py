from time import sleep_ms


class ILI9341:

    def __init__(self, spi, cs, dc, rst, width=240, height=320):

        self.spi = spi
        self.cs = cs
        self.dc = dc
        self.rst = rst

        self.width = width
        self.height = height

        self.cs.init(self.cs.OUT, value=1)
        self.dc.init(self.dc.OUT, value=0)
        self.rst.init(self.rst.OUT, value=1)

        self.reset()
        self.init_display()

    # ==========================================
    # RESET
    # ==========================================

    def reset(self):

        self.rst.value(0)
        sleep_ms(100)

        self.rst.value(1)
        sleep_ms(120)

    # ==========================================
    # COMMAND
    # ==========================================

    def write_cmd(self, cmd):

        self.cs.value(0)
        self.dc.value(0)

        self.spi.write(bytes([cmd]))

        self.cs.value(1)

    # ==========================================
    # DATA
    # ==========================================

    def write_data(self, data):

        self.cs.value(0)
        self.dc.value(1)

        self.spi.write(data)

        self.cs.value(1)

    # ==========================================
    # INITIALIZE
    # ==========================================

    def init_display(self):

        self.write_cmd(0x01)
        sleep_ms(120)

        self.write_cmd(0x28)

        self.write_cmd(0x3A)
        self.write_data(b'\x55')

        self.write_cmd(0x36)
        self.write_data(b'\x48')

        self.write_cmd(0x11)
        sleep_ms(120)

        self.write_cmd(0x29)
        sleep_ms(20)

    # ==========================================
    # SET DISPLAY WINDOW
    # ==========================================

    def set_window(self, x0, y0, x1, y1):

        self.write_cmd(0x2A)

        self.write_data(bytes([
            (x0 >> 8) & 0xFF,
            x0 & 0xFF,
            (x1 >> 8) & 0xFF,
            x1 & 0xFF
        ]))

        self.write_cmd(0x2B)

        self.write_data(bytes([
            (y0 >> 8) & 0xFF,
            y0 & 0xFF,
            (y1 >> 8) & 0xFF,
            y1 & 0xFF
        ]))

        self.write_cmd(0x2C)

    # ==========================================
    # FILL SCREEN
    # ==========================================

    def fill(self, color):

        hi = (color >> 8) & 0xFF
        lo = color & 0xFF

        self.set_window(
            0,
            0,
            self.width - 1,
            self.height - 1
        )

        self.cs.value(0)
        self.dc.value(1)

        line = bytes([hi, lo]) * self.width

        for _ in range(self.height):

            self.spi.write(line)

        self.cs.value(1)

    # ==========================================
    # DRAW PIXEL
    # ==========================================

    def pixel(self, x, y, color):

        if x < 0 or x >= self.width:
            return

        if y < 0 or y >= self.height:
            return

        self.set_window(x, y, x, y)

        self.write_data(bytes([
            (color >> 8) & 0xFF,
            color & 0xFF
        ]))

    # ==========================================
    # DRAW CHARACTER
    # ==========================================

    def char(self, x, y, char, color=0xFFFF, scale=1):

        # Simple 5x7 font
        font = {

            'A': [0x1E,0x05,0x05,0x1E,0x00],
            'B': [0x1F,0x15,0x15,0x0A,0x00],
            'C': [0x0E,0x11,0x11,0x0A,0x00],
            'D': [0x1F,0x11,0x11,0x0E,0x00],
            'E': [0x1F,0x15,0x15,0x11,0x00],
            'F': [0x1F,0x05,0x05,0x01,0x00],
            'G': [0x0E,0x11,0x15,0x1D,0x00],
            'H': [0x1F,0x04,0x04,0x1F,0x00],
            'I': [0x11,0x1F,0x11,0x00,0x00],
            'J': [0x08,0x10,0x10,0x0F,0x00],
            'K': [0x1F,0x04,0x0A,0x11,0x00],
            'L': [0x1F,0x10,0x10,0x10,0x00],
            'M': [0x1F,0x02,0x04,0x02,0x1F],
            'N': [0x1F,0x02,0x04,0x1F,0x00],
            'O': [0x0E,0x11,0x11,0x0E,0x00],
            'P': [0x1F,0x05,0x05,0x02,0x00],
            'Q': [0x0E,0x11,0x19,0x1E,0x00],
            'R': [0x1F,0x05,0x0D,0x12,0x00],
            'S': [0x12,0x15,0x15,0x09,0x00],
            'T': [0x01,0x1F,0x01,0x00,0x00],
            'U': [0x0F,0x10,0x10,0x0F,0x00],
            'V': [0x07,0x08,0x10,0x08,0x07],
            'W': [0x1F,0x08,0x04,0x08,0x1F],
            'X': [0x11,0x0A,0x04,0x0A,0x11],
            'Y': [0x01,0x02,0x1C,0x02,0x01],
            'Z': [0x19,0x15,0x13,0x00,0x00],

            '0': [0x0E,0x11,0x11,0x0E,0x00],
            '1': [0x12,0x1F,0x10,0x00,0x00],
            '2': [0x19,0x15,0x12,0x00,0x00],
            '3': [0x11,0x15,0x0A,0x00,0x00],
            '4': [0x07,0x04,0x1F,0x04,0x00],
            '5': [0x17,0x15,0x09,0x00,0x00],
            '6': [0x0E,0x15,0x15,0x08,0x00],
            '7': [0x01,0x01,0x19,0x07,0x00],
            '8': [0x0A,0x15,0x15,0x0A,0x00],
            '9': [0x02,0x15,0x15,0x0E,0x00],

            ':': [0x00,0x0A,0x00,0x00,0x00],
            '-': [0x04,0x04,0x04,0x00,0x00],
            '!': [0x00,0x1D,0x00,0x00,0x00],
            ' ': [0x00,0x00,0x00,0x00,0x00]
        }

        char = char.upper()

        if char not in font:
            char = ' '

        bitmap = font[char]

        for col in range(5):

            bits = bitmap[col]

            for row in range(7):

                if bits & (1 << row):

                    for dx in range(scale):

                        for dy in range(scale):

                            self.pixel(
                                x + col * scale + dx,
                                y + row * scale + dy,
                                color
                            )

    # ==========================================
    # DRAW TEXT
    # ==========================================

    def text(self, x, y, message, color=0xFFFF, scale=2):

        original_x = x

        for char in str(message):

            if char == '\n':

                y += 8 * scale
                x = original_x

            else:

                self.char(
                    x,
                    y,
                    char,
                    color,
                    scale
                )

                x += 6 * scale