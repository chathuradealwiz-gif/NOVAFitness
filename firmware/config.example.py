# NOVA FITNESS — device configuration.
#
# Copy to config.py on the ESP32 (Thonny: right-click > Rename after upload).
# config.py holds the device key and MUST NOT be committed. See .gitignore.

WIFI = [
    ("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD"),
    # Add a phone hotspot as a fallback; the first one that connects wins.
]

# Supabase project. Both of these are safe to ship to the device:
# the anon key alone can read nothing (RLS), and the Edge Functions require
# the separate x-device-key header on top of it.
SUPABASE_URL = "https://YOUR_PROJECT.supabase.co"
SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"

# From: node scripts/provision-device.mjs GYM-001 "Main Entrance"
DEVICE_CODE = "GYM-001"
DEVICE_KEY = "PASTE_THE_KEY_PRINTED_BY_PROVISION_DEVICE"

FIRMWARE_VERSION = "1.0.0"

# Minutes ahead of UTC, for the clock on the home screen. The RTC is set from
# the server in UTC (there is no RTC battery), so the offset is applied when the
# time is displayed. Sri Lanka is UTC+5:30.
TZ_OFFSET_MINUTES = 330

# --- Hardware ---------------------------------------------------------------
# GPIO assignments are unchanged from the tested R503 arrangement; the R307 swap
# is a power change, not a pin change.
PIN_FP_TX = 17          # ESP32 TX -> sensor RX (green)
PIN_FP_RX = 16          # ESP32 RX <- sensor TX (yellow)
PIN_BUZZER = 4
# Finger-present pin (R307 blue WAKEUP), or None to poll the sensor instead.
#
# Without it the idle loop calls get_image() over and over, and the sensor is
# blind between calls - a finger arriving in that gap is simply not seen. The
# blue capture light strobing is that polling made visible, and the gap grows
# with anything slow in the loop, which on 4G means every enrollment poll.
#
# With it the loop reads a pin, images only when a finger is actually there,
# and the light stops strobing.
#
# The white VT wire must go to 3.3 V: WAKEUP is the output of a touch circuit
# that VT powers, and an unpowered one never asserts - indistinguishable from
# a broken connection.
PIN_FP_WAKEUP = None    # e.g. 41

# Measure before trusting: idle low, rising on touch, is the common wiring -
# but modules vary, and a backwards reading means the door images constantly
# and never when asked.
FP_WAKEUP_ACTIVE_HIGH = True


# --- Fingerprint sensor -----------------------------------------------------
# The R307 needs 4.2-6 V, so its VCC goes to the HW-688 buck's 5 V terminal -
# NOT the 3.3 V rail the R503 used, and not the ESP32's 5V header pin (star
# point at the buck, same rule the modem follows). Its data lines stay 3.3 V
# TTL, so GPIO16/17 connect directly with no level shifter.
SENSOR_MODEL = "R307"

# Declared capacity, used only when the sensor will not answer ReadSysPara.
# The driver always prefers the chip's own figure: sellers label 200-template
# modules as 1000, and the difference must not be discovered at member 201.
# Run selftest.py on a new sensor and confirm it prints 1000 before enrolling.
SENSOR_CAPACITY = 1000

# The RGB aura ring is an R503 part. The R307 has none, so leave this False and
# the driver skips the 0x35 calls entirely rather than timing out on each one.
SENSOR_HAS_AURA = False

PIN_TFT_SCK = 12
PIN_TFT_MOSI = 11
PIN_TFT_MISO = 13
PIN_TFT_CS = 10
PIN_TFT_DC = 9
PIN_TFT_RST = 8

# Pins for the XPT2046 touch controller. It runs on SoftSPI (see xpt2046.py):
# the panel owns hardware SPI(2) at 40 MHz, and opening that same peripheral for
# touch re-points it at these pins, which silently freezes the display.
PIN_TCH_CLK = 14
PIN_TCH_MOSI = 21
PIN_TCH_MISO = 47
PIN_TCH_CS = 15
PIN_TCH_IRQ = 38

# Optional door hardware (parts list has a relay + reed switch). Set to None to
# run display-only on the bench.
PIN_DOOR_RELAY = None   # e.g. 5
PIN_REED = None         # e.g. 6
DOOR_UNLOCK_MS = 1000
RELAY_ACTIVE_HIGH = True

# --- 4G modem (SIMCom A7670C, FS-MCore V1.2) --------------------------------
# Secondary link, tried only when no Wi-Fi network answers. Set PIN_MODEM_TX to
# None to leave the modem out entirely (bench boards without a SIM).
#
# The board is 5-16 V on VIN and draws 2.3 A peaks on transmit, so VIN goes to
# the HW-688 5 V terminal at the same star point as the sensor - never the
# ESP32's 5V pin, which browns the board out mid-registration. 470 uF + 100 nF
# at the connector; the peak is short but it is the whole supply for 1-2 ms.
#
# UART on the FS-MCore has onboard level conversion referenced to VDD, so tie
# the board's VDD/VREF pin to 3.3 V and the data lines connect direct.
PIN_MODEM_TX = 18       # ESP32 TX -> modem RX
PIN_MODEM_RX = 7        # ESP32 RX <- modem TX
PIN_MODEM_PWRKEY = 40   # PWK: pulse low to toggle power. None if strapped on.
PIN_MODEM_NET = None    # NET status LED pin, optional (e.g. 41)
MODEM_UART = 1          # UART0 is the Thonny REPL, UART2 is the sensor
MODEM_BAUD = 115200     # A7670C autobauds, but this is what it settles on

# APN for your SIM. Sri Lanka: Dialog "dialogbb", Mobitel "mobitel3g",
# Hutch "hutch3g", Airtel "airtelgprs.com". Most are open - leave user/pass
# empty unless the operator says otherwise.
MODEM_APN = "dialogbb"
MODEM_APN_USER = ""
MODEM_APN_PASS = ""

# Registration is slow on a cold SIM: first attach after power-up can take a
# minute in poor coverage, and failing early just makes the door look broken.
MODEM_REGISTER_TIMEOUT = 90

# Which uplink carries device traffic.
#
#   "wifi"  Wi-Fi only. Fails when the router is down; what the terminal did
#           before the modem was fitted.
#   "4g"    Modem only. Use this to test the 4G path with certainty - with
#           "auto" a working router means you never learn whether the modem
#           would have coped.
#   "auto"  Wi-Fi first, modem when no configured SSID answers. What a
#           deployed door should run.
LINK = "auto"

# --- Behaviour --------------------------------------------------------------
HEARTBEAT_SECONDS = 60
ENROLL_POLL_SECONDS = 5
HTTP_TIMEOUT = 12

# Touch calibration — replace with the numbers printed by calibrate.py.
TOUCH_CAL = (520, 3549, 575, 3720)   # x_min, x_max, y_min, y_max (calibrate.py)
TOUCH_SWAP_XY = False
TOUCH_INVERT_X = False
TOUCH_INVERT_Y = True

# TLS: leave False only on a trusted bench network. See firmware/README.md.
VERIFY_TLS = False
