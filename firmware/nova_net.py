"""Wi-Fi, HTTPS and the Supabase Edge Function client.

The device talks only to Edge Functions - never to PostgreSQL, never with the
service-role key. Every request carries three headers (docs/API.md):

    apikey: <anon key>              gets past the Functions gateway
    Authorization: Bearer <anon>    the gateway rejects a request without it
    x-device-key: <device key>      proves which door terminal this is

The POST is written by hand rather than with urequests: this needs a hard
timeout, has to cope with chunked responses, and must not allocate a second
copy of the body on a device with this little RAM.
"""

import network
import socket
import ssl
import json
import time
import machine
import ubinascii

_TLS_PORT = 443


class NetworkError(Exception):
    pass


def _parse_url(url):
    if url.startswith("https://"):
        rest = url[8:]
    elif url.startswith("http://"):
        raise NetworkError("refusing plaintext HTTP for device traffic")
    else:
        raise NetworkError("bad url: " + url)
    slash = rest.find("/")
    host = rest if slash < 0 else rest[:slash]
    path = "/" if slash < 0 else rest[slash:]
    return host, path


class WiFi:
    def __init__(self, cfg, on_status=None):
        self.networks = cfg.WIFI
        self.on_status = on_status or (lambda msg: None)
        self.wlan = network.WLAN(network.STA_IF)
        self.wlan.active(True)
        # Keep the radio out of power-save: it adds seconds of latency to the
        # first packet, which the user reads as a slow door.
        try:
            self.wlan.config(pm=network.WLAN.PM_NONE)
        except Exception:
            pass

    def connected(self):
        return self.wlan.isconnected()

    def rssi(self):
        try:
            return self.wlan.status("rssi")
        except Exception:
            return None

    def status_text(self):
        if not self.connected():
            return "WiFi offline"
        r = self.rssi()
        return "WiFi %s dBm" % r if r is not None else "WiFi connected"

    def connect(self, timeout_ms=20000):
        if self.wlan.isconnected():
            return True
        for ssid, password in self.networks:
            self.on_status("Connecting %s" % ssid)
            try:
                self.wlan.connect(ssid, password)
            except OSError:
                continue
            deadline = time.ticks_add(time.ticks_ms(), timeout_ms)
            while time.ticks_diff(deadline, time.ticks_ms()) > 0:
                if self.wlan.isconnected():
                    self.on_status("Connected %s" % self.wlan.ifconfig()[0])
                    return True
                time.sleep_ms(250)
            self.wlan.disconnect()
        self.on_status("WiFi failed")
        return False

    def ensure(self):
        return self.wlan.isconnected() or self.connect()


class SupabaseDevice:
    """One Edge Function call per method. Every method raises NetworkError on
    transport trouble and returns the decoded JSON otherwise."""

    def __init__(self, cfg, wifi):
        self.base = cfg.SUPABASE_URL.rstrip("/") + "/functions/v1"
        self.anon = cfg.SUPABASE_ANON_KEY
        self.device_code = cfg.DEVICE_CODE
        self.device_key = cfg.DEVICE_KEY
        self.firmware = cfg.FIRMWARE_VERSION
        self.timeout = cfg.HTTP_TIMEOUT
        self.verify = getattr(cfg, "VERIFY_TLS", False)
        self.wifi = wifi
        self._ctx = None
        # Offset between the ESP32's clock and the server's, learned from
        # /device-heartbeat. There is no RTC battery in this design.
        self.clock_synced = False

    # --- transport ----------------------------------------------------------
    def _wrap_tls(self, sock, host):
        # MicroPython 1.19.1 provides ssl.wrap_socket(), not SSLContext.
        # Try SNI first; fall back for builds that do not accept
        # server_hostname.
        try:
            return ssl.wrap_socket(sock, server_hostname=host)
        except TypeError:
            return ssl.wrap_socket(sock)

    def _post(self, function, payload):
        if not self.wifi.ensure():
            raise NetworkError("offline")

        host, path = _parse_url("%s/%s" % (self.base, function))
        body = json.dumps(payload).encode()
        head = (
            "POST %s HTTP/1.1\r\n"
            "Host: %s\r\n"
            "apikey: %s\r\n"
            "Authorization: Bearer %s\r\n"
            "x-device-key: %s\r\n"
            "Content-Type: application/json\r\n"
            "Content-Length: %d\r\n"
            "Connection: close\r\n\r\n"
        ) % (path, host, self.anon, self.anon, self.device_key, len(body))

        sock = None
        try:
            addr = socket.getaddrinfo(host, _TLS_PORT)[0][-1]
            sock = socket.socket()
            sock.settimeout(self.timeout)
            sock.connect(addr)
            sock = self._wrap_tls(sock, host)
            sock.write(head.encode())
            sock.write(body)
            raw = self._read_all(sock)
        except OSError as e:
            raise NetworkError("post %s: %s" % (function, e))
        finally:
            if sock is not None:
                try:
                    sock.close()
                except Exception:
                    pass

        return self._decode(function, raw)

    def _read_all(self, sock):
        chunks = []
        while True:
            part = sock.read(512)
            if not part:
                break
            chunks.append(part)
        return b"".join(chunks)

    def _decode(self, function, raw):
        split = raw.find(b"\r\n\r\n")
        if split < 0:
            raise NetworkError("%s: truncated response" % function)
        header = raw[:split].decode()
        body = raw[split + 4:]

        try:
            status = int(header.split(" ")[1])
        except Exception:
            raise NetworkError("%s: bad status line" % function)

        if "chunked" in header.lower():
            body = self._dechunk(body)

        try:
            data = json.loads(body)
        except Exception:
            raise NetworkError("%s: HTTP %d, unparseable body" % (function, status))

        if status == 401:
            # Only the function itself reports device_unauthorized; a 401 from the
            # gateway (bad anon key, missing Authorization) means something else
            # entirely, so pass its own message through rather than blaming the key.
            reason = data.get("error") or data.get("message") or "unauthorized"
            raise NetworkError(reason)
        if status >= 400:
            raise NetworkError("%s: HTTP %d %s" % (function, status,
                                                   data.get("error", "")))
        return data

    @staticmethod
    def _dechunk(body):
        out = bytearray()
        while True:
            nl = body.find(b"\r\n")
            if nl < 0:
                break
            try:
                size = int(body[:nl].split(b";")[0], 16)
            except ValueError:
                break
            if size == 0:
                break
            out.extend(body[nl + 2:nl + 2 + size])
            body = body[nl + 2 + size + 2:]
        return bytes(out)

    # --- API (docs/API.md) --------------------------------------------------
    def heartbeat(self, pending=0, health=None):
        """Liveness plus, when given, a component health snapshot.

        The dashboard cannot reach the terminal - the device is outbound-only
        behind the gym's router - so the heartbeat is the only channel health
        can travel on. It rides along rather than taking its own round trip.
        """
        payload = {
            "device_id": self.device_code,
            "firmware_version": self.firmware,
            "network_status": self.wifi.status_text(),
            "pending_events": pending,
        }
        if health:
            payload["health"] = health
        data = self._post("device-heartbeat", payload)
        server_time = data.get("server_time")
        if server_time:
            self.set_clock(server_time)
        return data

    def attendance(self, event_id, fingerprint_id, event_type="entry",
                   timestamp=None, offline=False):
        return self._post("attendance", {
            "device_id": self.device_code,
            "event_id": event_id,
            "fingerprint_id": fingerprint_id,
            "event_type": event_type,
            "timestamp": timestamp or iso_now(),
            "offline": offline,
        })

    def sync(self, events, erased=None):
        """Drain the queue, refresh the cache, and confirm sensor erasures.

        `erased` is the slots deleted from the sensor since the last sync. They
        are reported here rather than one call per slot, and the server only
        closes a queue row once it is named — so a reset mid-erase just means
        the slot comes back on the next sync.
        """
        return self._post("device-sync", {
            "device_id": self.device_code,
            "events": events[:200],       # the function caps the batch anyway
            "erased": (erased or [])[:200],
        })

    def poll_enrollment(self):
        data = self._post("fingerprint-assignment", {
            "device_id": self.device_code,
            "action": "poll",
        })
        return data.get("enrollment")

    def report_enrollment(self, request_id, success, fingerprint_id=None, error=None):
        payload = {
            "device_id": self.device_code,
            "action": "report",
            "request_id": request_id,
            "success": bool(success),
        }
        if fingerprint_id is not None:
            payload["fingerprint_id"] = fingerprint_id
        if error:
            payload["error"] = error[:120]
        return self._post("fingerprint-assignment", payload)

    def report_progress(self, request_id, step, total, message):
        """Tell the dashboard how far the capture has got. Best-effort: the
        member is standing at the sensor, so a slow network must not stall the
        enrollment itself."""
        try:
            self._post("fingerprint-assignment", {
                "device_id": self.device_code,
                "action": "progress",
                "request_id": request_id,
                "progress_step": step,
                "progress_total": total,
                "progress_message": message[:120],
            })
        except Exception:
            pass

    def report_removed(self, fingerprint_id):
        return self._post("fingerprint-assignment", {
            "device_id": self.device_code,
            "action": "removed",
            "fingerprint_id": fingerprint_id,
        })

    def backup_template(self, member_id, fingerprint_id, sensor_model, template):
        """Upload one captured template for safe keeping.

        The sensor's flash is otherwise the only copy of a member's fingerprint,
        and nothing in the database can regenerate one - losing the module means
        every member enrolling again.
        """
        return self._post("fingerprint-template", {
            "device_id": self.device_code,
            "action": "store",
            "member_id": member_id,
            "fingerprint_id": fingerprint_id,
            "sensor_model": sensor_model,
            "template": ubinascii.b2a_base64(template).decode().strip(),
        })

    def fetch_templates(self, sensor_model):
        """Every template held for this device, for rebuilding a new sensor.

        The model is sent so the server can refuse templates from a different
        sensor family: they would restore without error and then match nobody.
        """
        data = self._post("fingerprint-template", {
            "device_id": self.device_code,
            "action": "fetch",
            "sensor_model": sensor_model,
        })
        out = []
        for row in data.get("templates") or []:
            try:
                out.append((
                    int(row["fingerprint_id"]),
                    ubinascii.a2b_base64(row["template"]),
                ))
            except (KeyError, ValueError):
                continue
        return out, data.get("incompatible", 0)

    def lookup(self, fingerprint_id=None, membership_id=None):
        payload = {"device_id": self.device_code}
        if fingerprint_id is not None:
            payload["fingerprint_id"] = fingerprint_id
        if membership_id is not None:
            payload["membership_id"] = str(membership_id)
        return self._post("member-lookup", payload)

    # --- clock --------------------------------------------------------------
    def set_clock(self, iso):
        """Trust the server clock; the board has no RTC battery."""
        try:
            date, rest = iso.split("T")
            y, mo, d = (int(v) for v in date.split("-"))
            rest = rest.rstrip("Z").split("+")[0]
            hh, mm, ss = rest.split(":")
            machine.RTC().datetime(
                (y, mo, d, 0, int(hh), int(mm), int(float(ss)), 0))
            self.clock_synced = True
        except Exception:
            pass


def iso_now():
    t = time.gmtime()
    return "%04d-%02d-%02dT%02d:%02d:%02dZ" % (t[0], t[1], t[2], t[3], t[4], t[5])