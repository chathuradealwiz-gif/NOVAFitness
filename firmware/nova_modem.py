"""A7670C 4G uplink, shaped like the WiFi class in nova_net.

One method matters to the rest of the firmware: fetch(), which takes the same
head and body nova_net builds for Wi-Fi and returns the same raw response
bytes. Everything above the transport - the five Edge Function calls, the
offline queue, the decision logic - cannot tell which link carried a request.

Settled on the bench with test_modem.py; see firmware/README.md for the two
SSL settings that are not defaults and why each one is needed.
"""

import time
from machine import UART, Pin

# Bumped whenever this file changes, so "did that upload actually land?" is one
# print rather than an evening of re-diagnosing a fixed bug.
VERSION = 4

_OK = "OK"
_ERR = ("ERROR", "+CME ERROR", "+CMS ERROR")


class ModemError(Exception):
    pass


class Modem:
    def __init__(self, cfg, on_status=None):
        self.cfg = cfg
        self.on_status = on_status or (lambda msg: None)
        self.timeout = getattr(cfg, "HTTP_TIMEOUT", 12)
        self.uart = UART(
            getattr(cfg, "MODEM_UART", 1),
            baudrate=getattr(cfg, "MODEM_BAUD", 115200),
            tx=cfg.PIN_MODEM_TX,
            rx=cfg.PIN_MODEM_RX,
            # Short, because read() blocks for this long whenever the buffer is
            # empty. At 1000 every command cost its whole timeout - eleven of
            # them per request added up to 46 seconds of a loop that also has a
            # door to answer. Reads are guarded by any() as well; this is just
            # the backstop.
            timeout=50,
            rxbuf=2048,
        )
        # Open-drain: PWK is an input to the modem's power circuit, not a line
        # to drive high. Released floats, pressed pulls to ground.
        self._pwrkey = (
            Pin(cfg.PIN_MODEM_PWRKEY, Pin.OPEN_DRAIN, value=1)
            if getattr(cfg, "PIN_MODEM_PWRKEY", None) is not None else None)
        self._attached = False
        self._rssi = None
        self.last_raw = b""

    # --- AT plumbing --------------------------------------------------------
    def _read(self):
        """Whatever is waiting, without blocking for more.

        A bare read() sits until the UART's own timeout even when the modem
        answered in a millisecond, which turned every timeout into a cost
        rather than a limit.
        """
        n = self.uart.any()
        return self.uart.read(n) if n else None

    def _at(self, cmd, timeout_ms=3000):
        self._read()                        # drop anything stale
        self.uart.write(cmd + "\r\n")
        deadline = time.ticks_add(time.ticks_ms(), timeout_ms)
        buf = b""
        while time.ticks_diff(deadline, time.ticks_ms()) > 0:
            chunk = self._read()
            if chunk:
                buf += chunk
                tail = buf.decode("utf-8", "ignore")
                # ">" is CCHSEND's prompt for payload; it never says OK, so
                # without this the send alone costs a full timeout.
                if _OK in tail or ">" in tail or any(e in tail for e in _ERR):
                    break
            else:
                time.sleep_ms(5)
        return [l.strip() for l in buf.decode("utf-8", "ignore").splitlines()
                if l.strip() and l.strip() != cmd]

    @staticmethod
    def _ok(lines):
        return any(l == _OK for l in lines)

    @staticmethod
    def _value(lines, prefix):
        for l in lines:
            if l.startswith(prefix):
                return l[len(prefix):].strip()
        return None

    def _urc(self, lines, prefix, timeout_ms):
        """The URC for a command that may answer before its own OK is read.

        A fast TLS handshake puts +CCHOPEN in the same read as the OK, so it
        is already in `lines` and waiting for it again burns the whole timeout
        on something that has been and gone. A slow one arrives later. Both
        happen, and which you get depends on the network that second.
        """
        for l in lines:
            if l.startswith(prefix):
                return l
        return self._wait_urc(prefix, timeout_ms)

    def _wait_urc(self, prefix, timeout_ms):
        deadline = time.ticks_add(time.ticks_ms(), timeout_ms)
        buf = b""
        while time.ticks_diff(deadline, time.ticks_ms()) > 0:
            chunk = self._read()
            if chunk:
                buf += chunk
                for l in buf.decode("utf-8", "ignore").splitlines():
                    l = l.strip()
                    if l.startswith(prefix):
                        return l
            else:
                time.sleep_ms(10)
        return None

    def power_toggle(self, ms=1500):
        if self._pwrkey is None:
            return
        self._pwrkey(0)
        time.sleep_ms(ms)
        self._pwrkey(1)

    # --- the WiFi-shaped interface -----------------------------------------
    def connected(self):
        return self._attached

    def rssi(self):
        return self._rssi

    def status_text(self):
        if not self._attached:
            return "4G offline"
        return "4G LTE %s dBm" % self._rssi if self._rssi else "4G LTE"

    def ensure(self):
        return self._attached or self.connect()

    def connect(self, register_timeout=None):
        """Wake, register, and bring up the data context. True once attached."""
        limit = register_timeout or getattr(self.cfg,
                                            "MODEM_REGISTER_TIMEOUT", 90)
        self._attached = False

        if not self._wake():
            self.on_status("Modem not responding")
            return False

        if (self._value(self._at("AT+CPIN?", 5000), "+CPIN:") or "") != "READY":
            self.on_status("SIM not ready")
            return False

        self.on_status("Registering 4G")
        deadline = time.ticks_add(time.ticks_ms(), limit * 1000)
        while time.ticks_diff(deadline, time.ticks_ms()) > 0:
            raw = self._value(self._at("AT+CEREG?", 3000), "+CEREG:") or ""
            stat = raw.split(",")[1].strip() if "," in raw else None
            if stat in ("1", "5"):          # home or roaming; both attached
                break
            time.sleep(3)
        else:
            self.on_status("4G registration failed")
            return False

        self._read_rssi()

        apn = getattr(self.cfg, "MODEM_APN", "")
        self._at('AT+CGDCONT=1,"IP","%s"' % apn, 5000)
        if getattr(self.cfg, "MODEM_APN_USER", ""):
            self._at('AT+CGAUTH=1,1,"%s","%s"'
                     % (self.cfg.MODEM_APN_PASS, self.cfg.MODEM_APN_USER), 5000)
        self._at("AT+CGACT=1,1", 30000)
        addr = self._value(self._at("AT+CGPADDR=1", 10000), "+CGPADDR:") or ""
        ip = addr.split(",")[-1].strip().strip('"') if "," in addr else ""
        # 0.0.0.0 means attached with no address, which is a wrong APN.
        if not ip or ip == "0.0.0.0":
            self.on_status("No IP for APN %s" % apn)
            return False

        self._attached = True
        self.on_status("4G %s" % ip)
        return True

    def _wake(self, attempts=2):
        for i in range(attempts):
            for _ in range(5):
                if self._ok(self._at("AT", 500)):
                    self._at("ATE0", 1000)      # stop the command echo
                    return True
            if i < attempts - 1:
                self.power_toggle()
                time.sleep(15)                  # cold boot is about 12 s
        return False

    def _read_rssi(self):
        raw = self._value(self._at("AT+CSQ", 3000), "+CSQ:")
        try:
            csq = int(raw.split(",")[0])
        except (AttributeError, ValueError):
            self._rssi = None
            return
        self._rssi = None if csq == 99 else -113 + 2 * csq

    # --- transport ----------------------------------------------------------
    def fetch(self, host, head, body, timeout=None):
        """Send one HTTP request over TLS and return the raw response bytes.

        Same signature and same return as WiFi.fetch, so SupabaseDevice does
        not care which link it holds.
        """
        if not self.ensure():
            raise ModemError("4G offline")

        timeout = timeout or self.timeout
        req = head.encode() + body if isinstance(head, str) else head + body

        self._at("AT+CCHCLOSE=0", 3000)     # a killed request may still hold it
        self._at("AT+CCHSTOP", 3000)
        self._at("AT+CCHSTART", 10000)

        # The two that are not defaults, both needed against Supabase:
        #   enableSNI       Cloudflare serves thousands of certificates per IP
        #                   and cannot choose one without the hostname.
        #   ignorelocaltime the modem has no battery-backed clock and reads
        #                   1970, so every certificate looks not-yet-valid.
        self._at('AT+CSSLCFG="sslversion",0,3', 3000)     # TLS 1.2
        self._at('AT+CSSLCFG="authmode",0,%d'
                 % (1 if getattr(self.cfg, "VERIFY_TLS", False) else 0), 3000)
        self._at('AT+CSSLCFG="ignorelocaltime",0,1', 3000)
        self._at('AT+CSSLCFG="enableSNI",0,1', 3000)
        self._at("AT+CCHSSLCFG=0,0", 3000)

        try:
            # client_type 2 is TLS. With 1 the socket opens unencrypted and
            # the server answers "plain HTTP request was sent to HTTPS port".
            lines = self._at('AT+CCHOPEN=0,"%s",443,2' % host, 5000)
            opened = self._urc(lines, "+CCHOPEN:", timeout * 1000 + 20000)
            if not opened or not opened.rstrip().endswith(",0"):
                raise ModemError("connect %s: %s" % (host, opened or "no reply"))

            self._at("AT+CCHSEND=0,%d" % len(req), 5000)
            time.sleep_ms(300)                  # the ">" prompt
            self.uart.write(req)

            raw = b""
            deadline = time.ticks_add(time.ticks_ms(), timeout * 1000 + 10000)
            last = time.ticks_ms()
            while time.ticks_diff(deadline, time.ticks_ms()) > 0:
                chunk = self._read()
                if chunk:
                    raw += chunk
                    last = time.ticks_ms()
                    # The peer closing is the tidy end marker, but only once a
                    # response has actually started: a PEER_CLOSED left over
                    # from the previous request would otherwise end this one
                    # before its first byte, which reads upstream as a
                    # truncated response rather than as the race it is.
                    if b"+CCH_PEER_CLOSED" in raw and b"HTTP/" in raw:
                        break
                    # Cloudflare does not always close promptly, and waiting
                    # for it spent the whole timeout on every request - which
                    # is what left the main loop with no time to read the
                    # sensor. So stop as soon as the response is provably
                    # whole, by its own framing.
                    if self._complete(raw):
                        break
                elif raw and time.ticks_diff(time.ticks_ms(), last) > 1500:
                    break
                time.sleep_ms(20)
            # Kept for diagnosis: when a reply comes back wrong, the bytes on
            # the wire are the only thing that settles why.
            self.last_raw = raw
            if not raw:
                raise ModemError("no response from %s" % host)
            data = self._strip_urcs(raw)
            # Fail here rather than hand a fragment upstream: _decode would
            # report "truncated response" with no clue whose fault it was, and
            # a NetworkError makes Uplink drop the link and rebuild it.
            if not data.startswith(b"HTTP/") or data.find(b"\r\n\r\n") < 0:
                raise ModemError("incomplete reply from %s (%d bytes)"
                                 % (host, len(data)))
            return data
        finally:
            self._at("AT+CCHCLOSE=0", 5000)
            self._at("AT+CCHSTOP", 5000)

    @classmethod
    def _complete(cls, raw):
        """Is the HTTP response whole, judged by its own framing?

        Guessing at the tail does not work - a header ending in a digit reads
        as a chunked terminator and truncates the reply. So the headers are
        parsed first, then whichever length rule they declare:
        Content-Length counts bytes, chunked ends at a zero-length chunk. If
        neither is given, the peer closing or a gap in the stream decides,
        back in the read loop.
        """
        data = cls._strip_urcs(raw)
        split = data.find(b"\r\n\r\n")
        if not data.startswith(b"HTTP/") or split < 0:
            return False                    # headers not in yet

        header = data[:split].lower()
        body = data[split + 4:]

        if b"transfer-encoding: chunked" in header:
            # A zero on a line of its own, not merely a body ending in "0".
            return body.rstrip().endswith(b"\r\n0")

        at = header.find(b"content-length:")
        if at >= 0:
            try:
                length = int(header[at + 15:].split(b"\r\n")[0].strip())
            except ValueError:
                return False
            return len(body) >= length

        return False

    @staticmethod
    def _strip_urcs(raw):
        """Drop the modem's own chatter from around the HTTP response.

        Received data arrives interleaved with +CCHRECV: DATA,0,<n> markers
        and a trailing +CCH_PEER_CLOSED. The parser upstream expects a plain
        HTTP response, so the bookkeeping lines come out here rather than
        teaching it about the modem.
        """
        out = bytearray()
        for ln in raw.split(b"\r\n"):
            s = ln.strip()
            if (s.startswith(b"+CCH") or s == b"OK" or s == b"") and not out:
                continue                        # preamble before the status line
            if s.startswith(b"+CCH"):
                continue
            out.extend(ln + b"\r\n")
        # bytes(), not bytearray: MicroPython's bytearray has no find().
        out = bytes(out)
        start = out.find(b"HTTP/")
        return out[start:] if start >= 0 else out
