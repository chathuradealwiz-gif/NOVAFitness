"""Wi-Fi provisioning over the terminal's own access point.

The door cannot be told its Wi-Fi password over Wi-Fi it does not have yet, and
the NOVA dashboard is on the internet the door cannot reach. So the terminal
serves the setup page itself: it brings up an access point, a phone joins that,
and a form on 192.168.4.1 collects the credentials. Nothing here touches the
internet, and the gym never needs a laptop or Thonny to move a router.

    NOVA-SETUP-GYM-001   <- the terminal's own network, WPA2
    http://192.168.4.1/  <- the form, served from flash

Both are shown on the TFT while the portal runs, which is the part a product
with no screen has to solve with a sticker.

What it saves
    wifi.json, newest network first, read ahead of config.py's WIFI list by
    nova_net.WiFi. A credential is only written after it has been proved to
    connect - a mistyped password fails at the form, where someone is standing
    to retype it, instead of at the next reboot with nobody there.

What it does not do
    No DNS responder, so no "sign in to network" popup appears; the address is
    on the screen instead. Adding one is ~40 lines if the popup is wanted.

The portal is deliberately time-boxed by its caller. A door that advertises a
setup network indefinitely is a door anyone in the car park can point at their
own router.
"""

import json
import os
import time

import network
import socket

CRED_PATH = "wifi.json"
MAX_SAVED = 4
AP_IP = "192.168.4.1"


# --- stored credentials -----------------------------------------------------
def saved_networks():
    """[(ssid, password)] from flash, newest first. Empty when unprovisioned."""
    try:
        with open(CRED_PATH) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    out = []
    for item in data if isinstance(data, list) else []:
        # Tolerant of both shapes: the file is small enough to hand-edit, and a
        # half-written entry should cost one network, not every network.
        if isinstance(item, dict) and item.get("ssid"):
            out.append((item["ssid"], item.get("password", "")))
        elif isinstance(item, (list, tuple)) and len(item) == 2 and item[0]:
            out.append((item[0], item[1]))
    return out


def save_network(ssid, password):
    """Store one network at the front of the list, replacing any same-SSID
    entry. The previous ones are kept: a gym with a spare router should not
    have to be reprovisioned when it swaps back."""
    nets = [(s, p) for s, p in saved_networks() if s != ssid]
    nets.insert(0, (ssid, password))
    del nets[MAX_SAVED:]
    tmp = CRED_PATH + ".tmp"
    payload = [{"ssid": s, "password": p} for s, p in nets]
    # Written to a temporary file and renamed, so a power cut during the write
    # leaves the old credentials intact rather than a truncated file that
    # parses as "no networks at all".
    with open(tmp, "w") as f:
        json.dump(payload, f)
    try:
        os.remove(CRED_PATH)
    except OSError:
        pass
    os.rename(tmp, CRED_PATH)
    return nets


def forget_all():
    try:
        os.remove(CRED_PATH)
    except OSError:
        pass


def ap_credentials(cfg):
    """The setup network's name and password, both derived from the device.

    Deterministic, so the pair on the screen is the same one every time and
    can be written in the installation notes - but not guessable from the
    device code alone, which is printed on the case.
    """
    code = str(getattr(cfg, "DEVICE_CODE", "NOVA"))
    ssid = ("NOVA-SETUP-%s" % code)[:32]
    key = str(getattr(cfg, "DEVICE_KEY", "")) or code
    # A small deterministic digest. WPA2 needs eight characters; four digits
    # after "nova" is what a staff member can read off a screen and type.
    h = 0
    for ch in key:
        h = (h * 31 + ord(ch)) & 0xFFFFFF
    return ssid, "nova%04d" % (h % 10000)


# --- HTTP -------------------------------------------------------------------
def _unquote(s):
    """Form-encoded text back to a string. Wi-Fi passwords are full of the
    characters that need this, and a password decoded wrong is a support call
    that looks exactly like a broken radio."""
    s = s.replace("+", " ")
    parts = s.split("%")
    out = parts[0]
    for p in parts[1:]:
        try:
            out += chr(int(p[:2], 16)) + p[2:]
        except ValueError:
            out += "%" + p
    return out


def _form(body):
    fields = {}
    for pair in body.split("&"):
        if "=" in pair:
            k, v = pair.split("=", 1)
            fields[_unquote(k)] = _unquote(v)
    return fields


def _escape(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


_PAGE = """<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NOVA FITNESS setup</title><style>
*{box-sizing:border-box}body{margin:0;padding:24px 18px;font:16px/1.5 -apple-system,
BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#111418;color:#f2f4f7}
h1{font-size:19px;margin:0 0 4px}p.sub{margin:0 0 22px;color:#98a2b3;font-size:14px}
label{display:block;margin:16px 0 6px;font-size:13px;color:#98a2b3}
select,input{width:100%%;padding:13px;border-radius:9px;border:1px solid #333b47;
background:#1a1f26;color:#f2f4f7;font-size:16px}
button{width:100%%;margin-top:22px;padding:15px;border:0;border-radius:9px;
background:#e11d2e;color:#fff;font-size:16px;font-weight:600}
.msg{padding:12px 14px;border-radius:9px;margin-bottom:18px;font-size:14px}
.err{background:#3a1114;border:1px solid #7a1d26}
.ok{background:#0f2e19;border:1px solid #1d7a3d}
</style></head><body>
<h1>NOVA FITNESS</h1><p class="sub">%s &middot; Wi-Fi setup</p>
%s
<form method="POST" action="/save">
<label for="ssid">Network</label>
<select id="ssid" name="ssid">%s</select>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="off"
 placeholder="Leave empty for an open network">
<button type="submit">Connect</button>
</form>
<p class="sub" style="margin-top:22px">The terminal keeps admitting members
from its offline list while you do this.</p>
</body></html>"""

_DONE = """<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connected</title><style>body{margin:0;padding:40px 20px;font:16px/1.6
-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#111418;
color:#f2f4f7;text-align:center}h1{color:#3ddc84;font-size:20px}
p{color:#98a2b3;font-size:14px}</style></head><body>
<h1>Connected</h1><p>%s is saved.</p>
<p>The terminal is back online. You can close this page and rejoin your usual
network.</p></body></html>"""


class SetupPortal:
    """Runs the access point and the form until a network is saved.

    on_status is the same one-line sink the rest of the firmware uses, so
    progress lands on the TFT without this module knowing what a display is.
    """

    def __init__(self, cfg, on_status=None, on_try=None):
        self.cfg = cfg
        self.on_status = on_status or (lambda msg: None)
        # Injected so the portal can prove a credential works before writing
        # it, without owning the STA interface or knowing how the rest of the
        # firmware connects.
        self.on_try = on_try
        self.ssid, self.password = ap_credentials(cfg)
        self.ap = None
        self.sock = None

    # --- lifecycle ----------------------------------------------------------
    def start(self):
        self.ap = network.WLAN(network.AP_IF)
        self.ap.active(True)
        try:
            self.ap.config(essid=self.ssid, password=self.password,
                           authmode=network.AUTH_WPA2_PSK)
        except (OSError, ValueError):
            # Some ports name the keyword differently; an open setup network
            # is worse than a closed one but far better than no setup at all.
            try:
                self.ap.config(essid=self.ssid)
                self.password = ""
            except OSError:
                pass
        deadline = time.ticks_add(time.ticks_ms(), 5000)
        while not self.ap.active() and time.ticks_diff(deadline, time.ticks_ms()) > 0:
            time.sleep_ms(100)

        # DHCP hands out a DNS server of 0.0.0.0 by default, and a phone given
        # no resolver decides the network is malformed: Android in particular
        # keeps the association but routes everything over mobile data, so the
        # form times out while the Wi-Fi settings still say "connected".
        # Pointing DNS at the terminal is enough to stop that - nothing here
        # answers a query, but no client asks one to load an address it was
        # typed directly.
        try:
            self.ap.ifconfig((AP_IP, "255.255.255.0", AP_IP, AP_IP))
        except (OSError, ValueError):
            pass

        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("0.0.0.0", 80))
        self.sock.listen(1)
        # Non-blocking accept, so the caller's deadline is honoured even when
        # nobody ever joins the network.
        self.sock.settimeout(1)
        return self.ssid, self.password, "http://%s/" % AP_IP

    def stop(self):
        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass
            self.sock = None
        if self.ap:
            try:
                self.ap.active(False)
            except OSError:
                pass
            self.ap = None

    # --- the form -----------------------------------------------------------
    def scan(self):
        """Nearby SSIDs, strongest first. The dropdown exists so nobody has to
        type a network name correctly on a phone keyboard."""
        try:
            sta = network.WLAN(network.STA_IF)
            sta.active(True)
            found = sta.scan()
        except (OSError, RuntimeError):
            return []
        seen = []
        for net in sorted(found, key=lambda n: n[3], reverse=True):
            try:
                name = net[0].decode("utf-8", "ignore").strip()
            except AttributeError:
                name = str(net[0]).strip()
            if name and name not in seen and name != self.ssid:
                seen.append(name)
        return seen[:20]

    def _page(self, message="", error=False):
        options = "".join('<option value="%s">%s</option>' % (_escape(s), _escape(s))
                          for s in self.scan())
        if not options:
            options = '<option value="">(no networks found)</option>'
        banner = ""
        if message:
            banner = '<div class="msg %s">%s</div>' % ("err" if error else "ok",
                                                       _escape(message))
        return _PAGE % (_escape(str(getattr(self.cfg, "DEVICE_CODE", ""))),
                        banner, options)

    @staticmethod
    def _send(conn, body, status="200 OK", ctype="text/html"):
        payload = body.encode() if isinstance(body, str) else body
        head = ("HTTP/1.1 %s\r\nContent-Type: %s\r\nContent-Length: %d\r\n"
                "Connection: close\r\n\r\n" % (status, ctype, len(payload)))
        try:
            conn.send(head.encode())
            # Sent in slices: a phone's receive window is smaller than the
            # page, and one send() of the whole thing silently truncates it.
            for i in range(0, len(payload), 512):
                conn.send(payload[i:i + 512])
        except OSError:
            pass

    @staticmethod
    def _request(conn):
        """(method, path, body) or None. Reads the head, then exactly as much
        body as Content-Length declares."""
        conn.settimeout(5)
        buf = b""
        while b"\r\n\r\n" not in buf and len(buf) < 4096:
            try:
                chunk = conn.recv(512)
            except OSError:
                return None
            if not chunk:
                break
            buf += chunk
        if b"\r\n\r\n" not in buf:
            return None
        head, _, rest = buf.partition(b"\r\n\r\n")
        lines = head.decode("utf-8", "ignore").split("\r\n")
        parts = lines[0].split(" ")
        if len(parts) < 2:
            return None
        length = 0
        for l in lines[1:]:
            if l.lower().startswith("content-length:"):
                try:
                    length = int(l.split(":", 1)[1].strip())
                except ValueError:
                    length = 0
        while len(rest) < length:
            try:
                chunk = conn.recv(512)
            except OSError:
                break
            if not chunk:
                break
            rest += chunk
        return parts[0], parts[1], rest.decode("utf-8", "ignore")

    def run(self, timeout_s=300, on_tick=None):
        """Serve until a network connects or the window closes.

        Returns the (ssid, password) that worked, or None. on_tick is called
        between connections so the caller can keep a clock or a countdown
        moving, and can abort by returning False.
        """
        deadline = time.ticks_add(time.ticks_ms(), int(timeout_s * 1000))
        while time.ticks_diff(deadline, time.ticks_ms()) > 0:
            if on_tick is not None and on_tick() is False:
                return None
            try:
                conn, _addr = self.sock.accept()
            except OSError:
                continue                    # the 1 s accept timeout, not a fault
            try:
                req = self._request(conn)
                if req is None:
                    continue
                method, path, body = req
                if method == "POST" and path.startswith("/save"):
                    fields = _form(body)
                    ssid = fields.get("ssid", "").strip()
                    pw = fields.get("password", "")
                    if not ssid:
                        self._send(conn, self._page("Choose a network.", True))
                        continue
                    self.on_status("Trying %s" % ssid)
                    if self.on_try is not None and not self.on_try(ssid, pw):
                        # Wrong password, or out of range. Said here, with
                        # someone standing at the door to fix it.
                        self._send(conn, self._page(
                            "Could not connect to %s. Check the password."
                            % ssid, True))
                        continue
                    save_network(ssid, pw)
                    self.on_status("Saved %s" % ssid)
                    self._send(conn, _DONE % _escape(ssid))
                    time.sleep_ms(400)      # let the reply leave before the AP does
                    return ssid, pw
                elif path == "/" or path.startswith("/?"):
                    self._send(conn, self._page())
                else:
                    # Everything else, including the phone's captive-portal
                    # probe, is pointed at the form. A meta refresh rather than
                    # a 302: with no DNS responder the probe is fetched by IP
                    # anyway, and this renders as a link if it is not followed.
                    self._send(conn,
                               '<!DOCTYPE html><meta http-equiv="refresh" '
                               'content="0;url=http://%s/">'
                               '<a href="http://%s/">NOVA FITNESS setup</a>'
                               % (AP_IP, AP_IP))
            finally:
                try:
                    conn.close()
                except OSError:
                    pass
        return None
