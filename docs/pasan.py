from machine import UART
import time

uart = UART(
    2,
    baudrate=57600,
    bits=8,
    parity=None,
    stop=1,
    tx=17,
    rx=16,
    timeout=1000
)

def send_command(command):
    uart.write(bytes(command))
    time.sleep(0.2)

    if uart.any():
        response = uart.read()
        print("Response:", response)
        print("HEX:", "".join("{:02X} ".format(b) for b in response))
    else:
        print("No response from R503")

print("R503 Communication Test")
print("------------------------")

# R503 GetImage command
command = [
    0xEF, 0x01,              # Header
    0xFF, 0xFF, 0xFF, 0xFF, # Device address
    0x01,                    # Packet type
    0x00, 0x03,              # Length
    0x01,                    # Command: GetImage
    0x00, 0x05               # Checksum
]

print("Place your finger on the sensor...")
time.sleep(2)

send_command(command)

print("Test finished")