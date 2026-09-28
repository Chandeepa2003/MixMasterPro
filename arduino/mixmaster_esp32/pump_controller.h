#pragma once
#include <Arduino.h>
#include "machine_config.h"

// =============================================================
//  Pump Controller — non-blocking timed pump control
//  Uses millis() so it never blocks the main loop
// =============================================================

struct PumpJob {
  bool     active;
  float    targetMl;
  float    dispensedMl;
  uint32_t startMs;
  uint32_t durationMs;  // total ON time in ms
};

PumpJob pumpJobs[NUM_PUMPS];

const uint8_t PUMP_IN1_PINS[NUM_PUMPS] = {
  PUMP_1_IN1, PUMP_2_IN1, PUMP_3_IN1,
  PUMP_4_IN1, PUMP_5_IN1, PUMP_6_IN1
};

const uint8_t PUMP_IN2_PINS[NUM_PUMPS] = {
  PUMP_1_IN2, PUMP_2_IN2, PUMP_3_IN2,
  PUMP_4_IN2, PUMP_5_IN2, PUMP_6_IN2
};

// Call once in setup()
void pumpController_init() {
  for (int i = 0; i < NUM_PUMPS; i++) {
    pinMode(PUMP_IN1_PINS[i], OUTPUT);
    pinMode(PUMP_IN2_PINS[i], OUTPUT);
    digitalWrite(PUMP_IN1_PINS[i], LOW);
    digitalWrite(PUMP_IN2_PINS[i], LOW);
    pumpJobs[i] = { false, 0, 0, 0, 0 };
  }
}

// Queue a pump to dispense targetMl — returns immediately
void pump_dispense(uint8_t pumpIdx, float targetMl) {
  if (pumpIdx >= NUM_PUMPS) return;
  uint32_t dur = (uint32_t)(targetMl * PUMP_MS_PER_ML[pumpIdx]);
  pumpJobs[pumpIdx] = { true, targetMl, 0, millis(), dur };
  digitalWrite(PUMP_IN1_PINS[pumpIdx], HIGH);
  digitalWrite(PUMP_IN2_PINS[pumpIdx], LOW);
}

// Run a pump for raw milliseconds (used for priming/testing)
void pump_run_ms(uint8_t pumpIdx, uint32_t ms) {
  if (pumpIdx >= NUM_PUMPS) return;
  float ml = ms / PUMP_MS_PER_ML[pumpIdx];
  pumpJobs[pumpIdx] = { true, ml, 0, millis(), ms };
  digitalWrite(PUMP_IN1_PINS[pumpIdx], HIGH);
  digitalWrite(PUMP_IN2_PINS[pumpIdx], LOW);
}

// Stop a specific pump immediately
void pump_stop(uint8_t pumpIdx) {
  if (pumpIdx >= NUM_PUMPS) return;
  digitalWrite(PUMP_IN1_PINS[pumpIdx], LOW);
  digitalWrite(PUMP_IN2_PINS[pumpIdx], LOW);
  if (pumpJobs[pumpIdx].active) {
    uint32_t elapsed = millis() - pumpJobs[pumpIdx].startMs;
    pumpJobs[pumpIdx].dispensedMl = elapsed / PUMP_MS_PER_ML[pumpIdx];
  }
  pumpJobs[pumpIdx].active = false;
}

void pump_stop_all() {
  for (int i = 0; i < NUM_PUMPS; i++) pump_stop(i);
}

// Update all pumps — call every loop iteration
// Returns true if ANY pump is still running
bool pumpController_update() {
  bool anyActive = false;
  uint32_t now = millis();
  for (int i = 0; i < NUM_PUMPS; i++) {
    if (!pumpJobs[i].active) continue;
    uint32_t elapsed = now - pumpJobs[i].startMs;
    pumpJobs[i].dispensedMl = elapsed / PUMP_MS_PER_ML[i];
    if (elapsed >= pumpJobs[i].durationMs) {
      pump_stop(i);
    } else {
      anyActive = true;
    }
  }
  return anyActive;
}

bool pump_isActive(uint8_t idx) { return idx < NUM_PUMPS && pumpJobs[idx].active; }
float pump_getProgress(uint8_t idx) {
  if (idx >= NUM_PUMPS || !pumpJobs[idx].active || pumpJobs[idx].durationMs == 0) return 0;
  return (float)(millis() - pumpJobs[idx].startMs) / pumpJobs[idx].durationMs;
}
float pump_getDispensedMl(uint8_t idx) { return idx < NUM_PUMPS ? pumpJobs[idx].dispensedMl : 0; }

// Update calibration constant at runtime (from Developer Panel command)
void pump_setCalibration(uint8_t idx, float msPerMl) {
  if (idx < NUM_PUMPS && msPerMl > 0) PUMP_MS_PER_ML[idx] = msPerMl;
}
