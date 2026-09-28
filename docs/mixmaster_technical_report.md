# MixMaster Pro - Technical Architecture Report

## 1. System Overview
MixMaster Pro is a fully automated, IoT-connected beverage mixing machine. It is designed to automatically dispense precise amounts of liquid ingredients based on predefined recipes, mix them thoroughly, and dispense the final product into a serving cup. It also features a fully automated self-cleaning cycle and a web-based management interface.

The system relies on a decentralized architecture consisting of a **Node.js Central Server** handling the user interface and database, and an **ESP32 Microcontroller** handling real-time hardware actuation, sensor reading, and state-machine execution.

---

## 2. Hardware Components & Wiring
The physical machine is controlled by an ESP32 microcontroller, interacting with the following hardware peripherals:

### 2.1 Pumping System
*   **Ingredient Pumps (x6):** 12V Peristaltic pumps. Peristaltic pumps provide high precision at low flow rates (~42ml/min or ~1.4 seconds per ml). During assembly, motor polarity was inverted so the pumps push liquid into the chamber rather than sucking it out.
*   **Out Pump 1 (Cup/Serving):** A high-flow centrifugal/diaphragm pump used to drain the mixed beverage into the customer's cup. Controlled via an Active-LOW relay module.
*   **Out Pump 2 (Waste/Drain):** A high-flow centrifugal/diaphragm pump used to drain dirty water into a waste tank during the cleaning cycle. Controlled via an Active-LOW relay module.
*   **Cleaning Water Pump:** A pump connected to a clean water reservoir for the self-cleaning cycle. Controlled via an **Active-HIGH** relay module.

### 2.2 Mixing & Sensing
*   **Mixer Motor:** A standard DC motor with an impeller/stirrer placed inside the mixing bowl. Controlled via a relay.
*   **Ultrasonic Distance Sensor (HC-SR04):** Mounted pointing down into the mixing bowl. 
    *   `TRIG` Pin: GPIO 13
    *   `ECHO` Pin: GPIO 12
    *   **Purpose:** Because ultrasonic sensors can suffer from reflection interference at the very bottom of uneven mixing bowls, it is strictly used as a **safety high-water mark** (to prevent overflow) and to measure the specific target volume during the `CLEAN_FILL` cycle.

---

## 3. Software Architecture

### 3.1 Node.js Central Server
The Node.js server (`server.js`) runs locally (e.g., on a Raspberry Pi or PC) and acts as the brain of the operation. 
*   **Database:** Uses flat JSON files (`orders.json`, `recipes.json`, `hardware.json`) for persistence.
*   **Customer Frontend:** A web interface (`index.html`) where users can browse the menu, customize drinks, and place orders. Orders are placed into a queue.
*   **Admin Dashboard:** A protected route (`/admin`) for bartenders/managers to create recipes, manage the queue, delete orders, and trigger the manual `Clean System` command.
*   **Developer Panel:** A protected route (`/admin/developer`) used for hardware diagnostics. It allows direct toggling of individual relays, reading raw ultrasonic sensor data, mapping physical pump slots to ingredients, and calibrating the exact `ms/ml` flow rates for all pumps.

### 3.2 ESP32 Firmware (C++)
The ESP32 runs a custom Arduino sketch (`mixmaster_esp32.ino`) utilizing asynchronous web servers (`WebServer.h`) and JSON serialization (`ArduinoJson`). 
It strictly acts as a "dumb" actuator that executes commands given by the Node server while running a strict State Machine to ensure safe physical operations.

---

## 4. Communication Protocol & API
The ESP32 and Node Server communicate over local Wi-Fi via HTTP REST requests.

*   **Telemetry Heartbeat:** Every 2 seconds, the ESP32 sends a `POST` request to the Node Server (`/api/machine/status`) containing its current state, ultrasonic distance, calculated volume, and the ID of the order it is currently processing.
*   **Node -> ESP32 Commands:** The Node server issues HTTP `POST` commands to the ESP32:
    *   `/start-recipe`: Contains an array of ingredients (Pump ID + Milliliters).
    *   `/start-clean`: Triggers the cleaning cycle.
    *   `/stop`: Instantly halts all pumps and motors.
    *   `/test-component`: Used by the Dev Panel to manually toggle a specific relay.
    *   `/set-cal`: Pushes flow-rate calibration (`ms_per_ml`) into the ESP32's RAM. (The Node server pushes this to the ESP32 on boot and whenever settings are saved).

---

## 5. The State Machine & Actuation Sequence
The ESP32 operates on a strict, non-blocking State Machine. 

### 5.1 Drink Mixing Sequence
1.  **`STATE_IDLE` -> `STATE_FILLING`**: 
    *   The Node server sends `/start-recipe`. 
    *   The ESP32 immediately turns **ON** the Mixer motor (for maximum efficiency, mixing occurs *while* dispensing).
    *   It turns **ON** Pump 1. It calculates a timeout: `Milliliters * pump_ms_per_ml`. 
    *   When Pump 1's timer expires, it turns OFF, and Pump 2 turns ON. This sequential dispensing continues until all ingredients are added.
2.  **`STATE_MIXING`**:
    *   Once dispensing is done, the Mixer motor remains **ON** for an additional trailing 5 seconds (`MIX_TIME_S`) for a final stir.
    *   The Mixer motor turns **OFF**.
3.  **`STATE_SERVING`**:
    *   Out Pump 1 (Cup) turns **ON**.
    *   Instead of relying on the ultrasonic sensor (which struggles at the bottom of the bowl), the ESP32 uses a timer. It calculates: `(Total Drink Volume * outPumpMsPerMl) + 3 seconds buffer`.
    *   When the timer expires, Out Pump 1 turns **OFF**.
    *   The machine returns to `STATE_IDLE`. The Node server notices the ESP32 is IDLE, and automatically updates the web UI to mark the order as "Ready".

### 5.2 Cleaning Sequence (Triggered Manually)
1.  **`STATE_CLEAN_FILL`**:
    *   Cleaning Pump turns **ON**.
    *   The ESP32 monitors the Ultrasonic Sensor until the water level reaches `CLEAN_FILL_ML` (default 400ml).
    *   Cleaning Pump turns **OFF**.
2.  **`STATE_CLEAN_MIX`**:
    *   Mixer motor turns **ON** for 5 seconds to scrub the bowl.
    *   Mixer motor turns **OFF**.
3.  **`STATE_CLEAN_DRAIN`**:
    *   Out Pump 2 (Drain) turns **ON**.
    *   It runs on a calculated timer: `(CLEAN_FILL_ML * outPumpMsPerMl) + 3 seconds buffer`.
    *   Out Pump 2 turns **OFF**, and the machine returns to `STATE_IDLE`.

---

## 6. Calibration System
Because physical pumps vary in speed depending on manufacturing tolerances and fluid viscosity, the system relies on dynamic calibration rather than hardcoded timers.

*   **Peristaltic Pumps (Ingredients):** The system tracks exactly how many milliseconds it takes to dispense 1 milliliter of fluid. During testing, the average peristaltic pump yielded a flow rate of **42.5 ml/min**, which translates to exactly **1411 ms/ml**.
*   **Centrifugal Pumps (Out Pumps):** These pumps flow significantly faster. The ESP32 is programmed to accept a separate calibration value specifically for the Out Pumps (represented internally as "Pump 99"). 
*   **Syncing:** The Node server stores these values in `hardware.json` and pushes them to the ESP32 upon boot-up, ensuring the microcontroller always uses the most up-to-date physical flow rates without needing to be re-flashed.
