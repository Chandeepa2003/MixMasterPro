#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "machine_config.h"
#include "pump_controller.h"
#include "sensor_manager.h"

// ── Global machine state ──────────────────────────────────────
String   machineState    = STATE_IDLE;
bool     mixerOn         = false;
bool     outPump1On      = false;
bool     outPump2On      = false;
bool     cleanPumpOn     = false;
String   activeOrderId   = "";

// ── Recipe queue ───────────────────────────────────────────────
struct IngredientJob { uint8_t pumpIdx; float amountMl; };
const int MAX_ING = 6;
IngredientJob recipeQueue[MAX_ING];
int   recipeJobCount   = 0;
int   recipeJobCurrent = 0;

// ── HTTP Server (port 80) ─────────────────────────────────────
WebServer httpServer(MACHINE_HTTP_PORT);

// ── Timing ────────────────────────────────────────────────────
uint32_t lastStatusPostMs   = 0;
uint32_t cleanMixStartMs    = 0;
uint32_t mixingStartMs      = 0;
uint32_t drainStartMs       = 0;
float    expectedDrinkVolume= 0;
float    outPumpMsPerMl     = 150.0f; // Increased to ensure full drain


// =============================================================
//  OUTPUT HELPERS
// =============================================================
void setMixer(bool on)       { mixerOn = on;        digitalWrite(MIXER_PIN, on ? HIGH : LOW); }
void setOutPump(bool on)     { outPump1On = on;     digitalWrite(OUT_PUMP_1_RELAY_PIN, on ? LOW : HIGH); }
void setDrainPump(bool on)   { outPump2On = on;     digitalWrite(OUT_PUMP_2_RELAY_PIN, on ? LOW : HIGH); }
void setWaterPump(bool on)   { cleanPumpOn = on;    digitalWrite(CLEAN_PUMP_RELAY_PIN, on ? HIGH : LOW); }

void allOff() {
  pump_stop_all();
  setMixer(false);
  setOutPump(false);
  setDrainPump(false);
  setWaterPump(false);
  machineState = STATE_IDLE;
}

// =============================================================
//  HTTP → MAIN SERVER (status callback every 2s)
// =============================================================
void postStatusToServer() {
  uint32_t now = millis();
  if (now - lastStatusPostMs < STATUS_POST_INTERVAL_MS) return;
  if (WiFi.status() != WL_CONNECTED) return;
  lastStatusPostMs = now;

  HTTPClient http;
  String url = String("http://") + SERVER_IP + ":" + SERVER_PORT + "/api/machine/status";
  http.begin(url);
  http.addHeader("Content-Type","application/json");

  StaticJsonDocument<256> doc;
  doc["state"]         = machineState;
  doc["bowl_level_ml"] = (int)bowl_getMl();
  doc["bowl_level_mm"] = (int)ultrasonic_getMm();
  doc["order_id"]      = activeOrderId;
  doc["ip"]            = WiFi.localIP().toString();
  String body; serializeJson(doc, body);
  http.POST(body);
  http.end();
}

// =============================================================
//  HTTP SERVER HANDLERS (main server → ESP32)
// =============================================================
void handleStartRecipe() {
  if (!httpServer.hasArg("plain")) {
    httpServer.send(400, "application/json", "{\"error\":\"No body\"}");
    return;
  }
  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, httpServer.arg("plain"))) {
    httpServer.send(400, "application/json", "{\"error\":\"JSON parse error\"}");
    return;
  }

  allOff();
  activeOrderId = doc["order_id"] | "";
  recipeJobCount = 0;

  JsonArray ingredients = doc["ingredients"];
  for (JsonObject ing : ingredients) {
    if (recipeJobCount >= MAX_ING) break;
    recipeQueue[recipeJobCount++] = {
      (uint8_t)(int)ing["pump"],
      (float)ing["ml"]
    };
  }

  // Fallback if no ingredients sent: demo 40ml per pump
  if (recipeJobCount == 0) {
    for (int i = 0; i < NUM_PUMPS; i++)
      recipeQueue[recipeJobCount++] = { (uint8_t)i, 40.0f };
  }

  recipeJobCurrent = 0;
  expectedDrinkVolume = 0;
  for (int i=0; i<recipeJobCount; i++) {
    expectedDrinkVolume += recipeQueue[i].amountMl;
  }
  
  machineState = STATE_FILLING;
  pump_dispense(recipeQueue[0].pumpIdx, recipeQueue[0].amountMl);

  httpServer.send(200, "application/json", "{\"ok\":true,\"state\":\"FILLING\"}");
}

void handleStop() {
  allOff();
  activeOrderId = "";
  httpServer.send(200, "application/json", "{\"ok\":true}");
}

void handleStartClean() {
  allOff();
  machineState = STATE_CLEAN_FILL;
  setWaterPump(true);
  httpServer.send(200, "application/json", "{\"ok\":true,\"state\":\"CLEAN_FILL\"}");
}

void handleSetCal() {
  if (!httpServer.hasArg("plain")) { httpServer.send(400); return; }
  StaticJsonDocument<64> doc;
  deserializeJson(doc, httpServer.arg("plain"));
  int   idx   = doc["pump"]      | -1;
  float ms_ml = doc["ms_per_ml"] | 0.0f;
  
  if (idx == 99 && ms_ml > 0) {
    outPumpMsPerMl = ms_ml;
    httpServer.send(200, "application/json", "{\"ok\":true}");
  } else if (idx >= 0 && idx < NUM_PUMPS && ms_ml > 0) {
    pump_setCalibration(idx, ms_ml);
    httpServer.send(200, "application/json", "{\"ok\":true}");
  } else { 
    httpServer.send(400, "application/json", "{\"error\":\"bad params\"}"); 
  }
}

void handleTestComponent() {
  if (!httpServer.hasArg("plain")) { httpServer.send(400); return; }
  StaticJsonDocument<128> doc;
  deserializeJson(doc, httpServer.arg("plain"));
  
  String comp = doc["component"] | "";
  bool state = doc["state"] | false;
  
  if (comp == "mixer") setMixer(state);
  else if (comp == "outPump1") setOutPump(state);
  else if (comp == "outPump2") setDrainPump(state);
  else if (comp == "cleanPump") setWaterPump(state);
  else if (comp.startsWith("pump")) {
    int idx = comp.substring(4).toInt() - 1;
    if (idx >= 0 && idx < NUM_PUMPS) {
      digitalWrite(PUMP_IN1_PINS[idx], state ? HIGH : LOW);
      digitalWrite(PUMP_IN2_PINS[idx], LOW);
    }
  }
  
  httpServer.send(200, "application/json", "{\"ok\":true}");
}

void handleStatus() {
  StaticJsonDocument<256> doc;
  doc["state"]         = machineState;
  doc["bowl_level_ml"] = (int)bowl_getMl();
  doc["bowl_level_mm"] = (int)ultrasonic_getMm();
  doc["order_id"]      = activeOrderId;
  doc["ip"]            = WiFi.localIP().toString();
  for (int i = 0; i < NUM_PUMPS; i++) {
    String k = "pump" + String(i+1);
    doc[k] = pump_isActive(i);
  }
  String out; serializeJson(doc, out);
  httpServer.send(200, "application/json", out);
}

// =============================================================
//  STATE MACHINE
// =============================================================
void stateMachine_update() {
  if (machineState == STATE_FILLING) {
    if (!pump_isActive(recipeQueue[recipeJobCurrent].pumpIdx)) {
      recipeJobCurrent++;
      if (recipeJobCurrent >= recipeJobCount) {
        machineState = STATE_MIXING;
        setMixer(true);
        mixingStartMs = millis();
      } else {
        pump_dispense(recipeQueue[recipeJobCurrent].pumpIdx,
                      recipeQueue[recipeJobCurrent].amountMl);
      }
    }
  } else if (machineState == STATE_MIXING) {
    if (millis() - mixingStartMs >= (uint32_t)MIX_TIME_S * 1000UL) {
      machineState = STATE_SERVING;
      setMixer(false);
      setOutPump(true);
      drainStartMs = millis();
    }
  } else if (machineState == STATE_SERVING) {
    // Timer-based drain: outPumpMsPerMl + 3 seconds buffer (or min 5 seconds)
    uint32_t drainTimeMs = (uint32_t)(expectedDrinkVolume * outPumpMsPerMl) + 3000;
    if (drainTimeMs < 5000) drainTimeMs = 5000;
    
    if (millis() - drainStartMs >= drainTimeMs) {
      setOutPump(false);
      machineState = STATE_IDLE;
    }
  } else if (machineState == STATE_CLEAN_FILL) {
    if (bowl_getMl() >= CLEAN_FILL_ML) {
      setWaterPump(false);
      machineState = STATE_CLEAN_MIX;
      setMixer(true);
      cleanMixStartMs = millis();
    }
  } else if (machineState == STATE_CLEAN_MIX) {
    if (millis() - cleanMixStartMs >= (uint32_t)CLEAN_MIX_TIME_S * 1000UL) {
      setMixer(false);
      machineState = STATE_CLEAN_DRAIN;
      setDrainPump(true);
      drainStartMs = millis(); // Reuse this variable
    }
  } else if (machineState == STATE_CLEAN_DRAIN) {
    // Timer-based drain for cleaning
    uint32_t drainTimeMs = (uint32_t)(CLEAN_FILL_ML * outPumpMsPerMl) + 3000;
    if (millis() - drainStartMs >= drainTimeMs) {
      setDrainPump(false);
      machineState = STATE_IDLE;
    }
  }
}

// =============================================================
//  SETUP & LOOP
// =============================================================
void setup() {
  Serial.begin(SERIAL_BAUD);

  // Output pins
  pinMode(MIXER_PIN, OUTPUT);
  pinMode(OUT_PUMP_1_RELAY_PIN, OUTPUT);
  pinMode(OUT_PUMP_2_RELAY_PIN, OUTPUT);
  pinMode(CLEAN_PUMP_RELAY_PIN, OUTPUT);
  
  // Relays are active LOW, so start them HIGH (OFF)
  digitalWrite(OUT_PUMP_1_RELAY_PIN, HIGH);
  digitalWrite(OUT_PUMP_2_RELAY_PIN, HIGH);
  digitalWrite(CLEAN_PUMP_RELAY_PIN, HIGH); // Water pump OFF on boot

  ultrasonic_init();
  pumpController_init();
  allOff();

  // WiFi
  Serial.print("Connecting WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t wStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wStart < WIFI_TIMEOUT_MS) {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED) {
    String ip = WiFi.localIP().toString();
    Serial.println();
    Serial.println("WiFi OK, IP: " + ip);

    // HTTP server routes
    httpServer.on("/start-recipe", HTTP_POST, handleStartRecipe);
    httpServer.on("/stop",         HTTP_POST, handleStop);
    httpServer.on("/start-clean",  HTTP_POST, handleStartClean);
    httpServer.on("/set-cal",      HTTP_POST, handleSetCal);
    httpServer.on("/test-component",HTTP_POST, handleTestComponent);
    httpServer.on("/status",       HTTP_GET,  handleStatus);
    httpServer.begin();
  } else {
    Serial.println("WiFi FAILED");
  }
}

void loop() {
  httpServer.handleClient();   // serve HTTP requests
  ultrasonic_update();         // update distance sensor
  pumpController_update();     // check pump timers
  stateMachine_update();       // advance state machine
  postStatusToServer();        // send status to main server via WiFi
}

