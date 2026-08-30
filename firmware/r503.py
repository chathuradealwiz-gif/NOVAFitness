"""R503 / R503Pro fingerprint sensor over UART.

Packet format (all big-endian):
    EF 01 | addr(4) | PID(1) | length(2) | payload(n) | checksum(2)
where length counts the payload plus the two checksum bytes, and the checksum
is the sum of PID, both length bytes and the payload, truncated to 16 bits.

Slot numbering: the sensor's page id is what the backend calls fingerprint_id,
and it is only unique per device - which is exactly how the `members` table
scopes it (fingerprint_device_id + fingerprint_id).
"""

from machine import UART, Pin
import time

_START = b"\xEF\x01"
_ADDR = b"\xFF\xFF\xFF\xFF"
_PID_CMD = 0x01
_PID_ACK = 0x07

# Commands
_GET_IMAGE = 0x01
_IMG2TZ = 0x02
_SEARCH = 0x04
_REG_MODEL = 0x05
_STORE = 0x06
_DELETE = 0x0C
_EMPTY = 0x0D
_TEMPLATE_NUM = 0x1D
_READ_INDEX = 0x1F
_AURA = 0x35

# Confirmation codes worth naming
OK = 0x00
NO_FINGER = 0x02
IMAGE_FAIL = 0x03
IMAGE_MESSY = 0x06
FEW_FEATURES = 0x07
NO_MATCH = 0x09
NOT_FOUND = 0x0A
ENROLL_MISMATCH = 0x0A

# Aura LED control / colour
AURA_BREATHE = 0x01
AURA_FLASH = 0x02
AURA_ON = 0x03
AURA_OFF = 0x04
RED = 0x01
BLUE = 0x02
PURPLE = 0x03

MAX_SLOTS = 200


class FingerprintError(Exception):
    def __init__(self, code, where=""):
        super().__init__("R503 %s failed: 0x%02X" % (where, code))
        self.code = code


class R503:
    def __init__(self, cfg):
        self.uart = UART(
            2,
            baudrate=57600,
            bits=8,
            parity=None,
            stop=1,
            tx=cfg.PIN_FP_TX,
            rx=cfg.PIN_FP_RX,
            timeout=1000
        )

    # --- transport ----------------------------------------------------------

    def _send(self, payload):
        length = len(payload) + 2

        body = bytes([
            _PID_CMD,
            length >> 8,
            length & 0xFF
        ]) + payload

        checksum = sum(body) & 0xFFFF

        while self.uart.any():
            self.uart.read()

        self.uart.write(
            _START +
            _ADDR +
            body +
            bytes([
                checksum >> 8,
                checksum & 0xFF
            ])
        )

    def _recv(self, timeout_ms=2000):
        deadline = time.ticks_add(time.ticks_ms(), timeout_ms)
        buf = bytearray()

        while time.ticks_diff(deadline, time.ticks_ms()) > 0:
            # Only ever read what is already buffered. A bare uart.read() blocks
            # for the full UART timeout (1 s) whenever the sensor has not replied
            # yet, which used to add ~1-2 s to every single command.
            waiting = self.uart.any()
            chunk = self.uart.read(waiting) if waiting else None

            if chunk:
                buf.extend(chunk)

                # Resynchronise on the EF 01 packet header.
                #
                # MicroPython on this ESP32-S3 build does not provide
                # bytearray.find(), so search for EF 01 manually.
                idx = -1

                for i in range(len(buf) - 1):
                    if buf[i] == 0xEF and buf[i + 1] == 0x01:
                        idx = i
                        break

                if idx > 0:
                    del buf[:idx]

                if len(buf) >= 9:
                    length = (buf[7] << 8) | buf[8]
                    total = 9 + length

                    if len(buf) >= total:
                        pkt = bytes(buf[:total])

                        if pkt[6] != _PID_ACK:
                            raise FingerprintError(0xFF, "ack")

                        return pkt[9:total - 2]

            else:
                time.sleep_ms(2)

        raise OSError("R503 timeout")

    def _cmd(self, payload, where="", timeout_ms=2000):
        self._send(payload)

        data = self._recv(timeout_ms)

        if not data:
            raise OSError("R503 empty response")

        return data[0], data[1:]

    def _expect(self, payload, where, timeout_ms=2000):
        code, rest = self._cmd(payload, where, timeout_ms)

        if code != OK:
            raise FingerprintError(code, where)

        return rest

    # --- operations ---------------------------------------------------------

    def aura(self, control, color, speed=80, times=0):
        """Ring LED. times=0 means run until changed."""
        try:
            self._cmd(
                bytes([
                    _AURA,
                    control,
                    speed,
                    color,
                    times
                ]),
                "aura",
                800
            )
        except Exception:
            pass

    def get_image(self):
        """Non-blocking single attempt. Returns the confirmation code."""
        code, _ = self._cmd(
            bytes([_GET_IMAGE]),
            "get_image"
        )

        return code

    def wait_finger(self, timeout_ms=10000, poll_ms=120):
        deadline = time.ticks_add(time.ticks_ms(), timeout_ms)

        while time.ticks_diff(deadline, time.ticks_ms()) > 0:
            try:
                if self.get_image() == OK:
                    return True
            except OSError:
                pass

            time.sleep_ms(poll_ms)

        return False

    def wait_removed(self, timeout_ms=8000):
        deadline = time.ticks_add(time.ticks_ms(), timeout_ms)

        while time.ticks_diff(deadline, time.ticks_ms()) > 0:
            try:
                if self.get_image() != OK:
                    return True
            except OSError:
                pass

            time.sleep_ms(120)

        return False

    def img2tz(self, buffer_id):
        self._expect(
            bytes([
                _IMG2TZ,
                buffer_id
            ]),
            "img2tz"
        )

    def search(self, buffer_id=1, start=0, count=MAX_SLOTS):
        """Returns (page_id, score) or None when no match."""

        payload = bytes([
            _SEARCH,
            buffer_id,
            start >> 8,
            start & 0xFF,
            count >> 8,
            count & 0xFF
        ])

        code, rest = self._cmd(
            payload,
            "search",
            3000
        )

        if code == NOT_FOUND:
            return None

        if code != OK:
            raise FingerprintError(code, "search")

        page = (rest[0] << 8) | rest[1]
        score = (rest[2] << 8) | rest[3]

        return page, score

    def reg_model(self):
        self._expect(
            bytes([_REG_MODEL]),
            "reg_model"
        )

    def store(self, page_id, buffer_id=1):
        self._expect(
            bytes([
                _STORE,
                buffer_id,
                page_id >> 8,
                page_id & 0xFF
            ]),
            "store",
            3000
        )

    def delete(self, page_id, count=1):
        self._expect(
            bytes([
                _DELETE,
                page_id >> 8,
                page_id & 0xFF,
                count >> 8,
                count & 0xFF
            ]),
            "delete",
            3000
        )

    def template_count(self):
        rest = self._expect(
            bytes([_TEMPLATE_NUM]),
            "template_num"
        )

        return (rest[0] << 8) | rest[1]

    def used_slots(self):
        """Every occupied page id, read from the sensor's index table."""

        used = []

        for page in range(2):
            try:
                table = self._expect(
                    bytes([
                        _READ_INDEX,
                        page
                    ]),
                    "read_index"
                )
            except Exception:
                break

            for byte_i, byte in enumerate(table):
                for bit in range(8):
                    if byte & (1 << bit):
                        used.append(
                            page * 256 +
                            byte_i * 8 +
                            bit
                        )

        return used

    def free_slot(self):
        """Lowest unused page id."""

        used = set(self.used_slots())

        for i in range(1, MAX_SLOTS):
            if i not in used:
                return i

        return None

    # --- composite flows ----------------------------------------------------

    def identify(self, timeout_ms=8000):
        """Wait for a finger and search. Returns (page_id, score) or None."""

        if not self.wait_finger(timeout_ms):
            return None

        self.img2tz(1)

        return self.search(1)

    def enroll(self, page_id, on_step=None, timeout_ms=15000, attempts=3):
        """Two-capture enrollment into page_id.

        The two captures have to be the same finger in roughly the same place.
        When they are not, reg_model() answers ENROLL_MISMATCH - which is what
        the "it goes red on step 3" failure is. That is a placement problem, not
        a fault, so both captures are retaken rather than failing the whole
        enrollment on the first miss.
        """

        def step(n, msg):
            if on_step:
                on_step(n, msg)

        def capture(buffer_id, prompt):
            step(buffer_id, prompt)
            if not self.wait_finger(timeout_ms):
                self.aura(AURA_OFF, BLUE)
                raise OSError("No finger")
            self.img2tz(buffer_id)

        for attempt in range(attempts):
            self.aura(AURA_BREATHE, BLUE, 80)

            capture(1, "Place finger flat on the sensor")

            step(1, "Lift your finger off")
            self.wait_removed()

            capture(2, "Place the SAME finger again")

            step(3, "Checking the two scans")
            try:
                self.reg_model()
                break
            except FingerprintError as e:
                if e.code != ENROLL_MISMATCH or attempt == attempts - 1:
                    raise
                # Same finger, different position. Say so and start over.
                self.aura(AURA_FLASH, RED, 60, 2)
                step(1, "Scans differ - press the same spot, flat and still")
                time.sleep_ms(1200)

        step(4, "Saving")

        self.store(page_id)

        self.aura(
            AURA_FLASH,
            PURPLE,
            60,
            3
        )

        return page_id