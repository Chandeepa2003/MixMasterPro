#pragma once
#include <Arduino.h>
#include "machine_config.h"

// =============================================================
//  Sensor Manager — HC-SR04 Ultrasonic
//  Non-blocking reads using micros() and millis()
// =============================================================

// ── Ultrasonic ────────────────────────────────────────────────
static float   _ultrasonicMm    = BOWL_EMPTY_MM;
static uint32_t _ultrasonicLastMs = 0;

void ultrasonic_init() {
  pinMode(ULTRASONIC_TRIG_PIN, OUTPUT);
  pinMode(ULTRASONIC_ECHO_PIN, INPUT);
  digitalWrite(ULTRASONIC_TRIG_PIN, LOW);
}

// Trigger one measurement — call infrequently (every 100ms+)
// Returns distance in mm, or -1 on timeout
float ultrasonic_read() {
  // Trigger pulse
  digitalWrite(ULTRASONIC_TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(ULTRASONIC_TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(ULTRASONIC_TRIG_PIN, LOW);

  long duration = pulseIn(ULTRASONIC_ECHO_PIN, HIGH, 30000UL); // 30ms timeout
  if (duration == 0) return -1.0f;
  float mm = (duration * 0.343f) / 2.0f;
  return constrain(mm, 0, ULTRASONIC_MAX_MM);
}

// Call every loop — updates _ultrasonicMm every 150ms
void ultrasonic_update() {
  uint32_t now = millis();
  if (now - _ultrasonicLastMs < 150) return;
  _ultrasonicLastMs = now;
  float reading = ultrasonic_read();
  if (reading > 0) {
    // Low-pass filter: alpha=0.3 to smooth out noise
    _ultrasonicMm = 0.7f * _ultrasonicMm + 0.3f * reading;
  }
}

float ultrasonic_getMm()  { return _ultrasonicMm; }

// Convert bowl distance → millilitres (linear interpolation)
float bowl_getMl() {
  float pct = (float)(BOWL_EMPTY_MM - _ultrasonicMm) /
              (float)(BOWL_EMPTY_MM - BOWL_FULL_MM);
  pct = constrain(pct, 0.0f, 1.0f);
  return pct * BOWL_CAPACITY_ML;
}

// True if bowl is above safe level
bool bowl_isFull()  { return _ultrasonicMm <= BOWL_FULL_MM; }
bool bowl_isEmpty() { return _ultrasonicMm >= (BOWL_EMPTY_MM - 10); }
