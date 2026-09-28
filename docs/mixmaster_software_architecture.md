# MixMaster Pro - Software Architecture Deep Dive

This document provides a highly detailed breakdown of the software stack powering the MixMaster Pro automated cocktail machine. The system utilizes a distributed client-server architecture where a Node.js web server acts as the primary brain, communicating via HTTP REST APIs with a fleet of vanilla JavaScript web clients and a single ESP32 microcontroller.

---

## 1. Directory Structure & File Roles
```text
/software/v0.0/
??? server.js                   # Main Node.js Express server
??? package.json                # Node dependencies (express, cors, dotenv)
??? data/
?   ??? orders.json             # Active and historical drink orders
?   ??? recipes.json            # Menu of available drinks
?   ??? hardware.json           # Pump calibrations and physical mapping
??? public/                     # Customer-facing Web UI
?   ??? index.html              # Customer ordering screen
?   ??? css/style.css           # Customer UI styling
?   ??? js/app.js               # Logic for cart, menu fetching, and checkout
??? admin/                      # Management & Developer UIs
?   ??? index.html              # Admin Dashboard (Orders, Recipes)
?   ??? developer.html          # Hardware diagnostic & calibration tool
?   ??? css/admin.css           # Styling for internal tools
?   ??? js/
?       ??? admin.js            # Admin dashboard logic (polling, status updates)
?       ??? developer.js        # Direct ESP32 hardware toggling & cal saving
??? arduino/mixmaster_esp32/
    ??? mixmaster_esp32.ino     # Main ESP32 C++ execution file
    ??? machine_config.h        # GPIO pin definitions & constant variables
    ??? sensor_manager.h        # HC-SR04 ultrasonic logic & volume math
    ??? pump_controller.h       # Non-blocking timing for peristaltic pumps
```

---

## 2. Node.js Backend (`server.js`)

The Node.js server uses the **Express.js** framework. It has three primary responsibilities: serving static files, providing a REST API for the frontend, and translating database actions into direct HTTP commands for the ESP32.

### 2.1 Flat-File Database
To eliminate the overhead of running a full database engine (like MySQL or MongoDB) on lightweight hardware (like a Raspberry Pi), the server uses synchronous file I/O to read and write to flat `.json` files in the `/data` directory. 
*   **`readData(file)` / `writeData(file, data)`**: Utility functions that parse and stringify JSON on the fly.

### 2.2 API Route Categories
*   **Customer Routes (`/api/recipes`, `/api/orders`)**: Open routes allowing the frontend to fetch the menu, submit a customized drink order, and check queue status.
*   **Admin Routes (`/api/admin/...`)**: Protected by a lightweight token middleware (`adminAuth`). Allows bartenders to edit the recipe book, delete bad orders, and force orders into the "Mixing" status.
*   **Machine/Hardware Routes (`/api/machine/...`, `/api/hardware/...`)**: The interface for the Developer Panel and the ESP32 itself.

### 2.3 ESP32 Synchronization
The Node server maintains a variable `ESP32_IP`. 
*   When the server boots up, it executes `syncCalibrationsToESP()`. It reads `hardware.json` and attempts to push the `ms/ml` calibration rates to the ESP32 to ensure the microcontroller always has the correct math for physical flow rates.
*   When a bartender marks an order as "Mixing", the server parses the recipe into physical pump instructions and triggers `callESP32('/start-recipe')`.

---

## 3. Frontend Web Applications

All frontends are built using HTML5, CSS3, and Vanilla JavaScript (ES6) with the native `fetch()` API. No heavy frameworks (React/Vue) were used, ensuring fast load times.

*   **Customer Frontend (`app.js`)**: Fetches `/api/recipes`, renders them into a grid, manages a local "Cart", and submits to `/api/orders`.
*   **Admin Dashboard (`admin.js`)**: Uses periodic polling (`setInterval`) to fetch the latest order queue every 2 seconds. When the ESP32 finishes a drink, the Node server automatically transitions the order status from `mixing` to `ready`, which is instantly reflected on the dashboard without manual page reloads.
*   **Developer UI (`developer.js`)**: A critical diagnostic tool. It renders interactive grids for the 6 ingredient pumps, 2 out-pumps, the mixer, and the clean pump. It sends POST requests to `/api/hardware/test-component`, allowing engineers to fire individual relays indefinitely to prime hoses or debug clogs.

---

## 4. ESP32 Firmware (C++)

The ESP32 firmware is written in C++ using the Arduino Core. It heavily utilizes `WebServer.h` for handling HTTP traffic and `ArduinoJson.h` for parsing payloads. 

### 4.1 Non-Blocking Architecture
The `loop()` function contains absolutely zero `delay()` statements. It relies entirely on `millis()` tracking to ensure the HTTP server can respond to requests *while* motors are actively spinning.
```cpp
void loop() {
  httpServer.handleClient();   // 1. Process incoming web requests
  ultrasonic_update();         // 2. Read distance sensor
  pumpController_update();     // 3. Check if any pumps need turning off
  stateMachine_update();       // 4. Advance sequence logic
  postStatusToServer();        // 5. Fire telemetry to Node.js
}
```

### 4.2 State Machine Execution
The core logic resides in `stateMachine_update()`. 
*   **STATE_FILLING**: The ESP32 iterates over a `recipeQueue`. It turns on a pump, records the `millis()`, and waits until `millis() - start >= calculated_duration`. It then increments to the next ingredient. The Mixer relay is pulled HIGH at the very beginning of this state.
*   **STATE_MIXING**: After all pumps finish, a new timer starts to keep the Mixer running for a trailing 5-second period.
*   **STATE_SERVING**: The Out-Pump relay is pulled LOW (active-low). It runs based on a timer calculated from the total volume of the ingredients added multiplied by the centrifugal pump's `outPumpMsPerMl` setting.

### 4.3 Telemetry & Transition Safety
The ESP32 tracks the `activeOrderId` currently being mixed. Every 2 seconds, it sends its status to the Node.js server. 
**Crucial Software Design:** The `activeOrderId` is intentionally preserved in the ESP32's memory even *after* it returns to `STATE_IDLE`. This ensures that its telemetry payload reads `{ "state": "IDLE", "order_id": "12345" }`, allowing the Node server to understand exactly *which* order just completed, so it can mark it as "Ready" in the database.

### 4.4 Hardware Calibration Logic
Instead of hardcoding delays, the ESP32 receives dynamic calibration values. 
```cpp
// Example of dynamic volume math
uint32_t ms_needed = (uint32_t)(ingredientVolumeMl * msPerMl_for_this_pump);
```
If a peristaltic pump ages and slows down, the developer simply updates the `ms/ml` value in the web UI, and the ESP32 adjusts its timers instantly without needing to recompile the C++ firmware.
