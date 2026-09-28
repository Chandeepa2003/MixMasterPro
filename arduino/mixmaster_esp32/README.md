# MixMaster — ESP32-S3 Firmware

## What This Does

The ESP32-S3 is the **machine controller**. It:
- Runs a WiFi HTTP server on port 80 (receives recipe commands from PC1)
- Drives 6 ingredient pumps, mixer motor, cooler, solenoids via GPIO
- Sends actuator state JSON to PC2 Simulator via USB Serial every 200ms
- Reads fake sensor data back from PC2 Simulator via USB Serial
- Posts its status to the PC1 server every 2 seconds

---

## Quick Setup

### 1. Edit `machine_config.h`
```c
#define WIFI_SSID     "YourSSID"        // ← your WiFi network
#define WIFI_PASSWORD "YourPassword"    // ← your WiFi password
#define SERVER_IP     "192.168.x.x"    // ← PC1's IP address on the LAN
#define SERVER_PORT   3000
```

### 2. Install Arduino Libraries
- **ArduinoJson** 6.x (by Benoit Blanchon) — via Library Manager
- **WiFi**, **WebServer**, **HTTPClient** — built-in to ESP32 Arduino core

### 3. Flash
- Board: **ESP32S3 Dev Module**
- Baud: **115200**
- Upload Mode: **UART0**

---

## Serial Protocol (USB to PC2 Simulator)

**ESP32 → PC2** (every 200ms, newline-terminated):
```json
{"type":"actuator","pumps":[true,false,false,false,false,false],"pump_progress":[45,0,0,0,0,0],"mixer_on":false,"cooler_on":false,"out_solenoid":false,"drain_solenoid":false,"water_pump":false,"state":"FILLING"}
```

**PC2 → ESP32** (every 300ms, newline-terminated):
```json
{"type":"sensor","bowl_level_mm":220,"temp_c":18.5}
```

Baud rate: **115200**

---

## WiFi HTTP API (Port 80)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/start-recipe` | POST | Start mixing. Body: `{"order_id":"...","ingredients":[{"pump":0,"ml":60},...]}` |
| `/stop` | POST | Emergency stop. All actuators off. |
| `/start-clean` | POST | Start cleaning cycle. |
| `/set-cal` | POST | Update pump calibration. Body: `{"pump":0,"ms_per_ml":320}` |
| `/status` | GET | Returns current machine telemetry JSON. |

---

## State Machine

```
IDLE → FILLING (pumps one-by-one) → MIXING (mixer+cooler until target temp)
     → SERVING (out solenoid open until bowl empty) → IDLE
```

Cleaning: `IDLE → CLEAN_FILL → CLEAN_MIX → CLEAN_DRAIN → IDLE`

---

## GPIO Pin Map

| Pin | Function |
|-----|----------|
| 1–6 | Pump 1–6 (active HIGH) |
| 7 | Ultrasonic TRIG |
| 8 | Ultrasonic ECHO |
| 9 | DS18B20 Temp sensor |
| 10 | Mixer (PWM) |
| 11 | Cooler relay |
| 12 | Output solenoid |
| 13 | Water pump |
| 14 | Drain solenoid |
