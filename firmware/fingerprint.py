"""ZFM-family fingerprint sensor over UART (R307, R503, R503Pro, DY50/FPM10A).

Every module in this family speaks the same command set, so one driver covers
all of them. NOVA FITNESS ships the R307: 1000 templates, optical, 5 V supply.

Packet format (all big-endian):
    EF 01 | addr(4) | PID(1) | length(2) | payload(n) | checksum(2)
where length counts the payload plus the two checksum bytes, and the checksum
is the sum of PID, both length bytes and the payload, truncated to 16 bits.

Slot numbering: the sensor's page id is what the backend calls fingerprint_id,
and it is only unique per device - which is exactly how the `members` table
scopes it (fingerprint_device_id + fingerprint_id).

Two sensor differences this driver absorbs, so the same firmware runs on either
module and a swap needs no code change:

  * Library size. The R307 holds 1000 templates and the base R503 only 200.
    Nothing here hardcodes a limit: capacity() asks the chip (ReadSysPara).
  * The RGB aura ring (0x35) is an R503 feature; the R307 has no ring. aura()
    is a no-op unless cfg.SENSOR_HAS_AURA is set. Nothing is lost by that -
    every cue the ring gave is also on the TFT and the buzzer.
"""

from machine import UART, Pin
import time

_START = b"\xEF\x01"
_ADDR = b"\xFF\xFF\xFF\xFF"
_PID_CMD = 0x01
_PID_ACK = 0x07
# Template transfer streams the character file in its own packets, separate
# from the command acknowledgement: DATA for every packet but the last, END for
# the last one. A transfer is "ACK, then packets until END".
_PID_DATA = 0x02
_PID_END = 0x08

# Commands
_GET_IMAGE = 0x01
_IMG2TZ = 0x02
_MATCH = 0x03
_SEARCH = 0x04
_REG_MODEL = 0x05
_STORE = 0x06
_LOAD_CHAR = 0x07
_UP_CHAR = 0x08
_DOWN_CHAR = 0x09
_DELETE = 0x0C
_EMPTY = 0x0D
_TEMPLATE_NUM = 0x1D
_READ_INDEX = 0x1F
_READ_SYS_PARA = 0x0F
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

# Fallback only, and deliberately not taken from a datasheet. This family ships
# in 200- and 1000-template variants that sellers label interchangeably, so the
# chip is the only honest source: capacity() asks it via ReadSysPara and only
# falls back to cfg.SENSOR_CAPACITY (then this) when the sensor will not answer.
MAX_SLOTS = 1000


class FingerprintError(Exception):
    def __init__(self, code, where=""):
        super().__init__("Sensor %s failed: 0x%02X" % (where, code))
        self.code = code


class Fingerprint:
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
        # Bytes read from the UART but not yet consumed as a whole packet.
        # Persists across reads because a template arrives as a run of packets.
        self._buf = bytearray()
        # Filled on first use from ReadSysPara.
        self._capacity = None
        self._packet = None
        # The R503 has an RGB ring; the R307 does not, and answering 0x35 on a
        # module without one just burns 800 ms of the member's time per call.
        self.has_aura = bool(getattr(cfg, "SENSOR_HAS_AURA", False))
        # What the sensor is believed to be, for the health screen and the
        # dashboard. Never used to decide capacity - the chip settles that.
        self.model = getattr(cfg, "SENSOR_MODEL", "R307")
        self._declared_capacity = getattr(cfg, "SENSOR_CAPACITY", MAX_SLOTS)

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

        # Anything still buffered belongs to the command that just finished, so
        # it must not be parsed as a reply to this one.
        self._buf = bytearray()

        self.uart.write(
            _START +
            _ADDR +
            body +
            bytes([
                checksum >> 8,
                checksum & 0xFF
            ])
        )

    def _send_data(self, payload, last=False):
        """One packet of an outgoing template stream (DownChar).

        Unlike _send() this must not flush the receive buffer: the sensor stays
        silent until the whole stream has landed, and clearing mid-transfer
        would throw away its final acknowledgement.
        """
        length = len(payload) + 2

        body = bytes([
            _PID_END if last else _PID_DATA,
            length >> 8,
            length & 0xFF
        ]) + payload

        checksum = sum(body) & 0xFFFF

        self.uart.write(
            _START +
            _ADDR +
            body +
            bytes([
                checksum >> 8,
                checksum & 0xFF
            ])
        )

    def _recv_packet(self, timeout_ms=2000):
        """The next whole packet, as (pid, payload).

        Leftovers stay in self._buf between calls. A template arrives as a run
        of packets and the UART hands them over in arbitrary chunks, so the tail
        of one read is regularly the head of the next packet.
        """
        deadline = time.ticks_add(time.ticks_ms(), timeout_ms)
        buf = self._buf

        while True:
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
                    del buf[:total]
                    return pkt[6], pkt[9:total - 2]

            if time.ticks_diff(deadline, time.ticks_ms()) <= 0:
                raise OSError("Sensor timeout")

            # Only ever read what is already buffered. A bare uart.read() blocks
            # for the full UART timeout (1 s) whenever the sensor has not replied
            # yet, which used to add ~1-2 s to every single command.
            waiting = self.uart.any()
            chunk = self.uart.read(waiting) if waiting else None

            if chunk:
                buf.extend(chunk)
            else:
                time.sleep_ms(2)

    def _recv(self, timeout_ms=2000):
        pid, payload = self._recv_packet(timeout_ms)

        if pid != _PID_ACK:
            raise FingerprintError(0xFF, "ack")

        return payload

    def _cmd(self, payload, where="", timeout_ms=2000):
        self._send(payload)

        data = self._recv(timeout_ms)

        if not data:
            raise OSError("Sensor empty response")

        return data[0], data[1:]

    def _expect(self, payload, where, timeout_ms=2000):
        code, rest = self._cmd(payload, where, timeout_ms)

        if code != OK:
            raise FingerprintError(code, where)

        return rest

    # --- operations ---------------------------------------------------------

    def aura(self, control, color, speed=80, times=0):
        """Ring LED. times=0 means run until changed.

        A no-op on a sensor without a ring. The R307 answers 0x35 with an error
        after a full timeout, so calling it anyway would add most of a second to
        every screen change - and the TFT and buzzer already carry every cue the
        ring used to give.
        """
        if not self.has_aura:
            return
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

    def wait_finger(self, timeout_ms=10000, poll_ms=120, on_tick=None):
        """Wait for a finger. `on_tick` runs once per poll.

        The terminal has one thread, so this loop is the only place an idle
        animation can be advanced while the sensor is being waited on. It runs
        after the sensor read, never before: a frame drawn first would be added
        to how long the member has to hold still.
        """
        deadline = time.ticks_add(time.ticks_ms(), timeout_ms)

        while time.ticks_diff(deadline, time.ticks_ms()) > 0:
            try:
                if self.get_image() == OK:
                    return True
            except OSError:
                pass

            if on_tick:
                try:
                    on_tick()
                except Exception:
                    pass          # never let a dropped frame block the door

            time.sleep_ms(poll_ms)

        return False

    def wait_removed(self, timeout_ms=8000, on_tick=None):
        deadline = time.ticks_add(time.ticks_ms(), timeout_ms)

        while time.ticks_diff(deadline, time.ticks_ms()) > 0:
            try:
                if self.get_image() != OK:
                    return True
            except OSError:
                pass

            if on_tick:
                try:
                    on_tick()
                except Exception:
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

    def search(self, buffer_id=1, start=0, count=None):
        """Returns (page_id, score) or None when no match.

        The range searched is the sensor's real library size, never a constant:
        on the R307 a hardcoded 200 would silently refuse every member enrolled
        into a slot above it - the 300th member would simply stop being let in.
        """
        if count is None:
            try:
                count = self.capacity()
            except (FingerprintError, OSError):
                count = self._declared_capacity

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

    # --- template transfer --------------------------------------------------
    #
    # The sensor's flash is the only copy of a member's fingerprint, and a
    # member cannot be re-derived from anything else: if the module dies, all
    # 500 of them come back to the desk and enrol again. These three commands
    # are what make that a swap instead of a re-enrolment.
    #
    # A template is opaque - the vendor's own feature encoding, not ISO 19794-2 -
    # so it can only ever be handed back to a sensor of the same family. It is
    # stored, never interpreted, and never matched anywhere but on the chip.

    def load_char(self, page_id, buffer_id=1):
        """Flash page -> char buffer."""
        self._expect(
            bytes([
                _LOAD_CHAR,
                buffer_id,
                page_id >> 8,
                page_id & 0xFF
            ]),
            "load_char",
            3000
        )

    def up_char(self, buffer_id=1, timeout_ms=6000):
        """Char buffer -> host. Returns the raw template bytes.

        The reply is an acknowledgement followed by a run of data packets, the
        last of them flagged END. Length is not announced anywhere, so the end
        marker is the only thing that says the template is complete - which is
        why a truncated read has to raise rather than return a short template
        that would be stored as a valid backup.
        """
        self._send(bytes([_UP_CHAR, buffer_id]))

        ack = self._recv(timeout_ms)
        if not ack:
            raise OSError("Sensor empty response")

        code = ack[0]
        if code != OK:
            raise FingerprintError(code, "up_char")

        out = bytearray()

        while True:
            pid, payload = self._recv_packet(timeout_ms)

            if pid == _PID_DATA:
                out.extend(payload)
            elif pid == _PID_END:
                out.extend(payload)
                return bytes(out)
            else:
                raise FingerprintError(0xFF, "up_char")

    def down_char(self, data, buffer_id=1, timeout_ms=6000):
        """Host -> char buffer. Pair with store() to put it back in the library."""
        if not data:
            raise ValueError("empty template")

        self._send(bytes([_DOWN_CHAR, buffer_id]))

        ack = self._recv(timeout_ms)
        if not ack:
            raise OSError("Sensor empty response")

        code = ack[0]
        if code != OK:
            raise FingerprintError(code, "down_char")

        size = self.packet_size()

        for i in range(0, len(data), size):
            chunk = data[i:i + size]
            self._send_data(chunk, last=(i + size >= len(data)))
            # The sensor acknowledges nothing until the stream ends, but it does
            # have to write each packet away. Without a breath between them a
            # 512-byte template arrives faster than it is consumed and the tail
            # is dropped.
            time.sleep_ms(4)

    def match(self, timeout_ms=3000):
        """1:1 compare of the two char buffers. Returns the score, or None."""
        code, rest = self._cmd(bytes([_MATCH]), "match", timeout_ms)

        if code == NO_MATCH:
            return None
        if code != OK:
            raise FingerprintError(code, "match")

        return (rest[0] << 8) | rest[1]

    def packet_size(self):
        """Bytes per data packet. Cached; asked once."""
        if self._packet is None:
            try:
                self._packet = self.sys_params()["packet"]
            except (FingerprintError, OSError):
                self._packet = 128
        return self._packet

    def backup(self, page_id):
        """The stored template for a slot, read back out of the library.

        Read from flash rather than from whatever is still in the buffer after
        an enrolment: the backup must be byte-for-byte what the sensor will
        actually match against, not what was on its way there.
        """
        self.load_char(page_id, 1)
        return self.up_char(1)

    def restore(self, page_id, data):
        """Write a backed-up template into a slot."""
        self.down_char(data, 1)
        self.store(page_id, 1)

    def sys_params(self):
        """ReadSysPara: the sensor's own account of itself.

        16 bytes, big-endian: status register, system id, library size, security
        level, device address, packet size code, baud rate code. The library
        size is the only honest answer to "how many prints fit" - it is what the
        chip enforces, not what a datasheet claims.
        """
        rest = self._expect(bytes([_READ_SYS_PARA]), "sys_para")
        if len(rest) < 16:
            raise OSError("Sensor short sys_para")
        return {
            "status": (rest[0] << 8) | rest[1],
            "capacity": (rest[4] << 8) | rest[5],
            "security": (rest[6] << 8) | rest[7],
            # Packet size is an index into 32/64/128/256 bytes, not a length.
            "packet": 32 << (((rest[12] << 8) | rest[13]) & 0x03),
            "baud": (((rest[14] << 8) | rest[15]) & 0xFF) * 9600,
        }

    def capacity(self):
        """Template slots this sensor actually has. Cached; asked once.

        Asked, never assumed: a 200-slot module sold as a 1000 would otherwise
        only reveal itself when member 201 failed to enrol.
        """
        if self._capacity is None:
            self._capacity = self.sys_params()["capacity"] or self._declared_capacity
        return self._capacity

    def template_count(self):
        rest = self._expect(
            bytes([_TEMPLATE_NUM]),
            "template_num"
        )

        return (rest[0] << 8) | rest[1]

    def used_slots(self):
        """Every occupied page id, read from the sensor's index table."""

        used = []

        # One index page covers 256 slots. Two covered a 200-template sensor and
        # only half of what the R307 needs, so ask how many the library uses.
        try:
            pages = min(4, (self.capacity() + 255) // 256)
        except (FingerprintError, OSError):
            pages = min(4, (self._declared_capacity + 255) // 256)

        for page in range(pages):
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
        """Lowest unused page id, or None when the sensor is full."""

        used = set(self.used_slots())

        try:
            limit = self.capacity()
        except (FingerprintError, OSError):
            limit = self._declared_capacity

        for i in range(1, limit):
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

    def enroll(self, page_id, on_step=None, timeout_ms=15000, attempts=3,
               on_tick=None):
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
            if not self.wait_finger(timeout_ms, on_tick=on_tick):
                self.aura(AURA_OFF, BLUE)
                raise OSError("No finger")
            self.img2tz(buffer_id)

        for attempt in range(attempts):
            self.aura(AURA_BREATHE, BLUE, 80)

            capture(1, "Place finger flat on the sensor")

            step(1, "Lift your finger off")
            self.wait_removed(on_tick=on_tick)

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