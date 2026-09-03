"""A7670C 4G bench test. Run from Thonny with the SIM in and the antenna on.

    >>> import test_modem              # the whole ladder, top to bottom
    >>> test_modem.at("AT+CSQ")        # one command, prints the raw reply
    >>> test_modem.console()           # type AT commands until Ctrl-C
    >>> test_modem.power_toggle()      # pulse PWK if the board is asleep

Each step is a rung: SIM before signal, signal before registration,
registration before a data context, and only then an HTTPS request. The first
FAIL is the one to fix - everything under it fails for the same reason.

The last rung posts a real /device-heartbeat over the modem, so a clean run
proves the whole path, not just that the radio attached. Nothing here touches
Wi-Fi, so run it with the router off to be certain of what carried the request.
"""

import time
from machine import UART, Pin

import config as cfg

_OK = "OK"
_ERR = ("ERROR", "+CME ERROR", "+CMS ERROR")

if getattr(cfg, "PIN_MODEM_TX", None) is None:
    raise SystemExit("PIN_MODEM_TX is None in config.py - no modem fitted")

uart = UART(
    getattr(cfg, "MODEM_UART", 1),
    baudrate=getattr(cfg, "MODEM_BAUD", 115200),
    tx=cfg.PIN_MODEM_TX,
    rx=cfg.PIN_MODEM_RX,
    timeout=1000,
    rxbuf=2048,          # a TLS reply arrives faster than the default buffer
)

# Open-drain, not push-pull: PWK is an input to the modem's own power circuit,
# and driving it to 3.3 V fights whatever the board pulls it to. Released means
# floating, pressed means pulled to ground - the same as a button across it.
_pwrkey = (Pin(cfg.PIN_MODEM_PWRKEY, Pin.OPEN_DRAIN, value=1)
           if getattr(cfg, "PIN_MODEM_PWRKEY", None) is not None else None)


def line(name, ok_, detail=""):
    print("%-22s %s %s" % (name, "PASS" if ok_ else "FAIL", detail))
    return ok_


# --- raw AT -----------------------------------------------------------------
def at(cmd, timeout_ms=3000, quiet=False):
    """Send one command, collect until OK/ERROR or timeout. Returns the lines."""
    uart.read()                                  # drop stale URCs
    uart.write(cmd + "\r\n")
    deadline = time.ticks_add(time.ticks_ms(), timeout_ms)
    buf = b""
    while time.ticks_diff(deadline, time.ticks_ms()) > 0:
        chunk = uart.read()
        if chunk:
            buf += chunk
            tail = buf.decode("utf-8", "ignore")
            if _OK in tail or any(e in tail for e in _ERR):
                break
        else:
            time.sleep_ms(20)
    lines = [l.strip() for l in buf.decode("utf-8", "ignore").splitlines()
             if l.strip() and l.strip() != cmd]
    if not quiet:
        for l in lines:
            print("   <", l)
    return lines


def ok(lines):
    return any(l == _OK for l in lines)


def value(lines, prefix):
    """The payload of the first `+PREFIX: ...` line, or None."""
    for l in lines:
        if l.startswith(prefix):
            return l[len(prefix):].strip()
    return None


def wait_urc(prefix, timeout_ms, quiet=False):
    """Wait for an unsolicited line - +HTTPACTION arrives long after its OK."""
    deadline = time.ticks_add(time.ticks_ms(), timeout_ms)
    buf = b""
    while time.ticks_diff(deadline, time.ticks_ms()) > 0:
        chunk = uart.read()
        if chunk:
            buf += chunk
            for l in buf.decode("utf-8", "ignore").splitlines():
                l = l.strip()
                if l.startswith(prefix):
                    if not quiet:
                        print("   <", l)
                    return l
        time.sleep_ms(50)
    return None


def power_toggle(ms=1500):
    """Pull PWK to ground and release. The board latches, so this is also off."""
    if _pwrkey is None:
        print("PIN_MODEM_PWRKEY is None - power the board by its own strap")
        return
    print("PWK to ground %d ms" % ms)
    _pwrkey(0)
    time.sleep_ms(ms)
    _pwrkey(1)


def listen(ms=20000):
    """Print whatever the modem says unprompted. Nothing is sent.

    A healthy A7670C is chatty on power-up - RDY, +CPIN:, SMS DONE. Silence
    here with the PWR LED lit means the ESP32 is not on the modem's TX line
    (swapped, or no common ground); garbage means the wrong baud rate.
    """
    print("listening %d ms - power-cycle the modem now" % ms)
    deadline = time.ticks_add(time.ticks_ms(), ms)
    seen = False
    while time.ticks_diff(deadline, time.ticks_ms()) > 0:
        chunk = uart.read()
        if chunk:
            seen = True
            print("   <", chunk)
        time.sleep_ms(50)
    if not seen:
        print("   (nothing - see the modem section of firmware/README.md)")
    return seen


def scan_baud(rates=(115200, 9600, 57600, 38400, 19200, 460800)):
    """Try AT at each rate. The A7670C autobauds, but a board that has been
    fixed to another rate answers on exactly one and looks dead on the rest."""
    global uart
    for rate in rates:
        uart = UART(getattr(cfg, "MODEM_UART", 1), baudrate=rate,
                    tx=cfg.PIN_MODEM_TX, rx=cfg.PIN_MODEM_RX,
                    timeout=1000, rxbuf=2048)
        time.sleep_ms(200)
        for _ in range(3):
            if ok(at("AT", 500, quiet=True)):
                print("answers at %d baud - set MODEM_BAUD = %d" % (rate, rate))
                return rate
        print("   no answer at %d" % rate)
    print("no answer at any rate - this is wiring or power, not baud")
    return None


def wake(attempts=3):
    """Answer on AT, toggling power between tries. True once it talks."""
    for i in range(attempts):
        for _ in range(5):
            if ok(at("AT", 500, quiet=True)):
                at("ATE0", 1000, quiet=True)      # stop it echoing commands back
                return True
        if i < attempts - 1:
            print("   ... no answer, toggling power (boot takes ~15 s)")
            power_toggle()
            time.sleep(15)
    return False


def host():
    """The Supabase hostname, without scheme or path."""
    return cfg.SUPABASE_URL.split("//")[-1].split("/")[0]


def dns():
    """Resolve the Supabase host through the modem. Splits a 7xx HTTPACTION
    error in two: no address here is DNS, an address here means TLS.

    The answer arrives as a +CDNSGIP URC well after the OK, and firmware
    revisions disagree about the argument list - so both forms are tried, and
    an ERROR from one is a rejected command rather than a failed lookup.
    """
    print("resolving", host())
    for cmd in ('AT+CDNSGIP="%s"' % host(),
                'AT+CDNSGIP="%s",1,10000' % host()):
        if not ok(at(cmd, 5000, quiet=True)):
            print("   %s -> ERROR (command not accepted, not a lookup failure)"
                  % cmd.split("=")[0])
            continue
        urc = wait_urc("+CDNSGIP:", 20000)
        if urc and urc.split(":")[1].strip().startswith("1"):
            print("   resolved - so the 715 is TLS, not the name")
            return True
        print("   no answer to", cmd.split("=")[0])
    print("\n   DNS is not resolving. Point it at a public resolver:")
    print('     at(\'AT+CDNSCFG="8.8.8.8","1.1.1.1"\')')
    print("   then dns() again. Nothing to change in Supabase - a lookup")
    print("   never reaches them, and Edge Functions have no IP allowlist.")
    return False


def rf():
    """Why the radio reports no signal. Run when +CSQ sits at 99.

    Checked in cost order: whether the receiver is even on, what modes and
    bands it will scan, and finally a full network scan - which takes up to
    two minutes and is the one answer that separates 'no coverage' from
    'coverage this module cannot use'.
    """
    print("\n-- is the radio on --")
    fun = value(at("AT+CFUN?", 5000), "+CFUN:")
    if fun and fun.strip() != "1":
        # 0 is minimum functionality, 4 is flight mode. Both answer AT happily
        # and neither ever measures anything.
        print("   CFUN is %s, not 1 - the receiver is off. Turning it on:" % fun)
        at("AT+CFUN=1", 15000)
        time.sleep(5)

    print("\n-- what it will look for --")
    at("AT+CNMP?", 5000)      # 2 auto, 13 GSM only, 38 LTE only
    at("AT+CBANDCFG?", 5000)  # bands enabled per mode
    at("AT+CPSI?", 5000)      # the fullest picture: mode, band, cell, level

    print("\n-- full network scan, up to 2 min --")
    found = at("AT+COPS=?", 180000)
    if not any("," in l for l in found if l.startswith("+COPS:")):
        print("\n   No operators at all. That is the antenna or the band -")
        print("   the A7670C-LNNV does not do TDD B40/B41, which is most of")
        print("   Dialog's LTE capacity here. See firmware/README.md.")
    return found


def console():
    """Type AT commands at the modem until Ctrl-C. For poking at a failure."""
    print("AT console - Ctrl-C to leave")
    try:
        while True:
            cmd = input("AT> ").strip()
            if cmd:
                at(cmd, 8000)
    except KeyboardInterrupt:
        print("\nbye")


# --- the ladder -------------------------------------------------------------
def _sim():
    state = value(at("AT+CPIN?", 5000), "+CPIN:") or "no answer"
    # SIM PIN / SIM PUK mean a locked card, not a wiring fault - say which.
    return line("SIM card", state == "READY", state)


def _signal(timeout=45):
    """Poll +CSQ until the radio reports a level.

    99 straight after power-up is not a fault - the receiver has not finished
    its first scan, and on a cold start that takes tens of seconds. Only 99
    that persists means no antenna or no coverage.
    """
    deadline = time.ticks_add(time.ticks_ms(), timeout * 1000)
    rssi = 99
    while time.ticks_diff(deadline, time.ticks_ms()) > 0:
        raw = value(at("AT+CSQ", 3000, quiet=True), "+CSQ:")
        try:
            rssi = int(raw.split(",")[0])
        except (AttributeError, ValueError):
            return line("Signal", False, "unreadable +CSQ")
        if rssi != 99:
            break
        print("   ... still scanning")
        time.sleep(3)
    if rssi == 99:
        return line("Signal", False,
                    "still 99 after %ss - antenna on the U.FL, or no coverage"
                    % timeout)
    dbm = -113 + 2 * rssi
    # Below about -100 dBm the attach still works and the TLS handshake does not.
    return line("Signal", dbm > -100, "%d dBm (csq %d)" % (dbm, rssi))


def _registered():
    limit = getattr(cfg, "MODEM_REGISTER_TIMEOUT", 90)
    deadline = time.ticks_add(time.ticks_ms(), limit * 1000)
    stat = None
    while time.ticks_diff(deadline, time.ticks_ms()) > 0:
        # 1 = home, 5 = roaming; both are attached. 2 = still searching.
        raw = value(at("AT+CEREG?", 3000, quiet=True), "+CEREG:") or ""
        stat = raw.split(",")[1].strip() if "," in raw else None
        if stat in ("1", "5"):
            operator = value(at("AT+COPS?", 5000, quiet=True), "+COPS:") or ""
            return line("LTE registration", True,
                        ("roaming " if stat == "5" else "") + operator)
        print("   ... CEREG %s, waiting" % stat)
        time.sleep(3)
    return line("LTE registration", False,
                "stat %s after %ss - coverage, or a SIM with no data plan"
                % (stat, limit))


def _context():
    apn = cfg.MODEM_APN
    at('AT+CGDCONT=1,"IP","%s"' % apn, 5000)
    if cfg.MODEM_APN_USER:
        at('AT+CGAUTH=1,1,"%s","%s"' % (cfg.MODEM_APN_PASS, cfg.MODEM_APN_USER),
           5000)
    at("AT+CGACT=1,1", 30000)
    addr = value(at("AT+CGPADDR=1", 10000), "+CGPADDR:") or ""
    ip = addr.split(",")[-1].strip().strip('"') if "," in addr else ""
    # 0.0.0.0 is the modem saying "attached, no address" - that is a wrong APN.
    return line("Data context", bool(ip) and ip != "0.0.0.0",
                ip or "no IP for APN '%s'" % apn)


def _step(cmd, timeout_ms=5000):
    """One setup command, named if it fails. A bare ERROR in a run of OKs is
    otherwise impossible to attribute, and the request still goes out - with
    that setting missing."""
    lines = at(cmd, timeout_ms, quiet=True)
    if not ok(lines):
        print("   ERROR from %s" % cmd.split(",")[0])
        return False
    return True


def post_socket(function="device-heartbeat", show=True):
    """The same POST over a raw TLS socket instead of the AT HTTP stack.

    AT+HTTPACTION reports failures as a bare 7xx with no way to ask why, and
    this firmware does not implement AT+CDNSGIP to narrow it down. A socket
    fails visibly instead: the open either connects or names its error, and
    the reply arrives as bytes you can read.

    This is also the shape the real transport wants. nova_net.py already
    builds its request by hand for the same reasons, so both links can share
    one builder rather than keeping a second, differently-broken copy.
    """
    body = ('{"device_id":"%s","firmware_version":"%s",'
            '"network_status":"4G bench test","pending_events":0}'
            % (cfg.DEVICE_CODE, cfg.FIRMWARE_VERSION))
    req = (
        "POST /functions/v1/%s HTTP/1.1\r\n"
        "Host: %s\r\n"
        "apikey: %s\r\n"
        "Authorization: Bearer %s\r\n"
        "x-device-key: %s\r\n"
        "Content-Type: application/json\r\n"
        "Content-Length: %d\r\n"
        "Connection: close\r\n\r\n%s"
    ) % (function, host(), cfg.SUPABASE_ANON_KEY, cfg.SUPABASE_ANON_KEY,
         cfg.DEVICE_KEY, len(body), body)

    at("AT+CCHCLOSE=0", 5000, quiet=True)     # a failed run may hold the session
    at("AT+CCHSTOP", 5000, quiet=True)

    # Settled by tls_probe(): (sslversion 3, ignorelocaltime 1, SNI 1) is the
    # combination that completes a handshake with Supabase's edge.
    _step("AT+CCHSTART", 10000)
    _step('AT+CSSLCFG="sslversion",0,3')      # TLS 1.2 explicitly, not "any"
    _step('AT+CSSLCFG="authmode",0,0')        # no server verification - see below
    # The modem has no battery-backed clock and reads 1970 until the network
    # tells it otherwise, which makes every certificate look not-yet-valid.
    _step('AT+CSSLCFG="ignorelocaltime",0,1')
    # SNI. Supabase sits behind Cloudflare, where one IP serves thousands of
    # certificates - without the hostname in the handshake the server cannot
    # pick one, and the connection dies before HTTP. SIMCom ships this off.
    _step('AT+CSSLCFG="enableSNI",0,1')
    _step("AT+CCHSSLCFG=0,0")

    print("connecting to %s:443" % host())
    # client_type 2 = SSL/TLS, 1 = plain TCP - which is the opposite of what
    # the docs for the neighbouring SIM7600 say. Opening with 1 connects, then
    # Cloudflare answers "400 The plain HTTP request was sent to HTTPS port",
    # which is the modem admitting it never wrapped the socket.
    #
    # The open resolves the name itself, so it doubles as the DNS test this
    # firmware gives us no other way to run.
    at('AT+CCHOPEN=0,"%s",443,2' % host(), 5000, quiet=True)
    opened = wait_urc("+CCHOPEN:", 60000)
    if not opened or not opened.rstrip().endswith(",0"):
        print("   open failed: %s" % (opened or "no +CCHOPEN at all"))
        print("   a non-zero code here is DNS or the TLS handshake -")
        print("   the connection never carried a byte of HTTP.")
        at("AT+CCHSTOP", 5000, quiet=True)
        return None

    print("   connected - sending %d bytes" % len(req))
    at("AT+CCHSEND=0,%d" % len(req), 5000, quiet=True)
    time.sleep_ms(300)                        # the ">" prompt
    uart.write(req)

    raw = b""
    deadline = time.ticks_add(time.ticks_ms(), 30000)
    while time.ticks_diff(deadline, time.ticks_ms()) > 0:
        chunk = uart.read()
        if chunk:
            raw += chunk
            if b"}" in raw and b"HTTP/1.1" in raw:
                time.sleep(1)                 # let the tail arrive
                raw += uart.read() or b""
                break
        time.sleep_ms(50)

    at("AT+CCHCLOSE=0", 5000, quiet=True)
    at("AT+CCHSTOP", 5000, quiet=True)

    text = raw.decode("utf-8", "ignore")
    if show:
        print("--- reply ---")
        print(text or "(nothing)")
        print("-------------")
    for l in text.splitlines():
        if l.startswith("HTTP/1.1"):
            print(l.strip())
            break
    return text


def tls_probe():
    """Find an SSL context that will complete a handshake with Cloudflare.

    +CCHOPEN's error code says a handshake failed, never why, so guessing one
    setting per run is slow. This opens a socket against each plausible
    combination and reports the first that connects.

    ignorelocaltime matters more than it looks: the modem powers up with no
    idea of the date, and a certificate whose validity window has not started
    according to a 1980 clock is rejected before authmode is consulted. The
    network's own time (AT+CLTS) fixes it properly, so that is tried first.
    """
    print("network time, so certificate dates make sense:")
    at("AT+CLTS=1", 5000, quiet=True)
    print("   modem clock:", value(at("AT+CCLK?", 5000, quiet=True), "+CCLK:"))

    combos = (
        # (sslversion, ignorelocaltime, sni)  - 3 is TLS 1.2, 4 is "any"
        #
        # SNI first, because Supabase is behind Cloudflare: one IP serves
        # thousands of certificates, and without the hostname sent during the
        # handshake the server cannot know which one to present. SIMCom ships
        # it off, which fails against any shared-IP host and works fine
        # against the single-certificate servers their examples use.
        (3, 1, 1),
        (4, 1, 1),
        (3, 1, 0),
        (4, 1, 0),
    )
    for ver, ignore, sni in combos:
        print("\n-- sslversion %d, ignorelocaltime %d, SNI %d"
              % (ver, ignore, sni))
        at("AT+CCHCLOSE=0", 3000, quiet=True)
        at("AT+CCHSTOP", 3000, quiet=True)
        at("AT+CCHSTART", 10000, quiet=True)
        at('AT+CSSLCFG="sslversion",0,%d' % ver, 3000, quiet=True)
        at('AT+CSSLCFG="authmode",0,0', 3000, quiet=True)
        at('AT+CSSLCFG="ignorelocaltime",0,%d' % ignore, 3000, quiet=True)
        at('AT+CSSLCFG="enableSNI",0,%d' % sni, 3000, quiet=True)
        at("AT+CCHSSLCFG=0,0", 3000, quiet=True)
        at('AT+CCHOPEN=0,"%s",443,2' % host(), 5000, quiet=True)
        urc = wait_urc("+CCHOPEN:", 45000, quiet=True)
        print("   %s" % (urc or "no +CCHOPEN"))
        if urc and urc.rstrip().endswith(",0"):
            print("\n   ^ this one connects. Put it in post_socket().")
            at("AT+CCHCLOSE=0", 3000, quiet=True)
            at("AT+CCHSTOP", 3000, quiet=True)
            return (ver, ignore, sni)
    at("AT+CCHSTOP", 3000, quiet=True)
    print("\n   None connected. Next thing to suspect is the supply: a TLS")
    print("   handshake is the first sustained transmit the modem does, and")
    print("   a brown-out there looks exactly like a handshake failure.")
    return None


def run():
    print("\nNOVA FITNESS 4G modem test - %s\n" % cfg.DEVICE_CODE)
    print("UART%d  tx=GPIO%d  rx=GPIO%d  @%d baud"
          % (getattr(cfg, "MODEM_UART", 1), cfg.PIN_MODEM_TX, cfg.PIN_MODEM_RX,
             getattr(cfg, "MODEM_BAUD", 115200)))

    if not line("Modem responds", wake()):
        print("\n   Is the PWR LED lit?  no -> VIN/GND, not the data lines")
        print("   Then, in order:")
        print("     test_modem.listen()     power-cycle and watch for RDY")
        print("     test_modem.scan_baud()  in case it is fixed to another rate")
        print("   Silence in listen() is TX/RX swapped, no common ground, or")
        print("   a VDD/VREF pad left unconnected - the level shifter is dead")
        print("   without it and nothing crosses in either direction.\n")
        return
    model = at("AT+CGMM", 3000, quiet=True)
    print("   model:", model[0] if model else "?")

    if not _sim():
        return
    if not _signal():
        return
    if not _registered():
        return
    if not _context():
        return
    reply = post_socket(show=False) or ""
    if not line("HTTPS heartbeat", "HTTP/1.1 200" in reply,
                reply.split("\r\n")[0] if reply else "no reply"):
        print("\n   The connection failed before HTTP, or the server refused.")
        print("   post_socket() prints the whole exchange; tls_probe() walks")
        print("   the SSL settings if +CCHOPEN is the step that fails.\n")
        return

    print("\nGreen to the bottom - the modem can carry the door's traffic.")
    print("Leave it running and pull the antenna to watch it drop.\n")


run()
