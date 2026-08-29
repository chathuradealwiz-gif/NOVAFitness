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

# --- Hardware ---------------------------------------------------------------
# Kept exactly as the tested arrangement in ESP32_S3_R503_TFT_Pin_Arrangement.md.
PIN_FP_TX = 17          # ESP32 TX -> R503 RX
PIN_FP_RX = 16          # ESP32 RX <- R503 TX
PIN_BUZZER = 4

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
DOOR_UNLOCK_MS = 4000
RELAY_ACTIVE_HIGH = True

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
