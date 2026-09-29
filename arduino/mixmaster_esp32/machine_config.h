#pragma once

// =============================================================
//  MixMaster Pro — Machine Configuration  (ESP32-S3)
// =============================================================

// ── Serial (to PC) ───────────────────────────────────────────────
#define SERIAL_BAUD            115200

// ── WiFi (edit before flashing) ───────────────────────────────
#define WIFI_SSID     "Redmi Note 13"
#define WIFI_PASSWORD "vish1234"
#define WIFI_TIMEOUT_MS  15000   // max time to connect

// ── Main Server callback ───────────────────────────────────────
// The ESP32 POSTs its status back to this address every 2 seconds
#define SERVER_IP    "10.228.55.107"   // <- Change to your PC 1 IP
#define SERVER_PORT   3000
#define STATUS_POST_INTERVAL_MS  2000

// ── ESP32 HTTP server port ────────────────────────────────────
#define MACHINE_HTTP_PORT  80

// ── Pump GPIO Pins (L298N drivers) ────────
#define PUMP_1_IN1    5 // Swapped to reverse peristaltic direction
#define PUMP_1_IN2    4
#define PUMP_2_IN1    6
#define PUMP_2_IN2    7
#define PUMP_3_IN1    9 // Swapped
#define PUMP_3_IN2    8
#define PUMP_4_IN1    10
#define PUMP_4_IN2    11
#define PUMP_5_IN1    16 // Swapped
#define PUMP_5_IN2    15
#define PUMP_6_IN1    18 // Swapped
#define PUMP_6_IN2    17
#define NUM_PUMPS     6

// Pump calibration: milliseconds per 1 ml
float PUMP_MS_PER_ML[NUM_PUMPS] = {
  1411.0f, 1411.0f, 1411.0f, 1411.0f, 1411.0f, 1411.0f
};

// ── Ultrasonic Sensor (HC-SR04) ───────────────────────────────
#define ULTRASONIC_TRIG_PIN   13
#define ULTRASONIC_ECHO_PIN   12
#define ULTRASONIC_MAX_MM     1000
#define BOWL_EMPTY_MM        280
#define BOWL_FULL_MM          30
#define BOWL_CAPACITY_ML     500
#define CUP_EMPTY_MM         180
#define CUP_OVERFLOW_MM       20

// ── Mixer Motor (On/Off control) ──────────────────────────────
#define MIXER_PIN          14
#define MIX_TIME_S         10

// ── Relays (Active LOW) ───────────────────────────────────────
#define CLEAN_PUMP_RELAY_PIN 1  // Water pump
#define OUT_PUMP_1_RELAY_PIN 21   // Mixed drink to cup
#define OUT_PUMP_2_RELAY_PIN 47   // Drainage water to waste

// ── Cleaning ──────────────────────────────────────────────────
#define CLEAN_FILL_ML      400
#define CLEAN_MIX_TIME_S    30

// ── State strings ─────────────────────────────────────────────
#define STATE_IDLE        "IDLE"
#define STATE_FILLING     "FILLING"
#define STATE_MIXING      "MIXING"
#define STATE_SERVING     "SERVING"
#define STATE_CLEAN_FILL  "CLEAN_FILL"
#define STATE_CLEAN_MIX   "CLEAN_MIX"
#define STATE_CLEAN_DRAIN "CLEAN_DRAIN"
#define STATE_ERROR       "ERROR"


