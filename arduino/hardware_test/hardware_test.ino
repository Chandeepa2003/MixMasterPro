// Standalone Hardware Test for MixMaster ESP32-S3 (Interactive Serial Mode)
// Type commands into the Serial Monitor (115200 baud) to control hardware directly.
// Ensure "Newline" or "Both NL & CR" is selected in the Serial Monitor line ending dropdown.

#include <Arduino.h>

// Note: Pumps 1, 3, 5, 6 have IN1/IN2 swapped to reverse direction
const int PUMP_IN1[6] = {5, 6, 9, 10, 16, 18};
const int PUMP_IN2[6] = {4, 7, 8, 11, 15, 17};

#define ULTRASONIC_TRIG_PIN 13
#define ULTRASONIC_ECHO_PIN 12

#define MIXER_PIN 14
#define CLEAN_PUMP_RELAY_PIN 1    // Active LOW
#define OUT_PUMP_1_RELAY_PIN 21   // Active LOW
#define OUT_PUMP_2_RELAY_PIN 47   // Active LOW

void printMenu() {
  Serial.println("\n=== MANUAL HARDWARE TEST MENU ===");
  Serial.println("Type a command and press Enter:");
  Serial.println("  p1 on   / p1 off   -> Ingredient Pump 1 (L298N)");
  Serial.println("  p2 on   / p2 off   -> Ingredient Pump 2");
  Serial.println("  p3 on   / p3 off   -> Ingredient Pump 3");
  Serial.println("  p4 on   / p4 off   -> Ingredient Pump 4");
  Serial.println("  p5 on   / p5 off   -> Ingredient Pump 5");
  Serial.println("  p6 on   / p6 off   -> Ingredient Pump 6");
  Serial.println("  m on    / m off    -> Mixer Motor");
  Serial.println("  c on    / c off    -> Cleaning Pump Relay (Water)");
  Serial.println("  o1 on   / o1 off   -> Out Pump 1 Relay (Cup)");
  Serial.println("  o2 on   / o2 off   -> Out Pump 2 Relay (Drain)");
  Serial.println("  u                  -> Read Ultrasonic Sensor");
  Serial.println("  all off            -> Turn everything OFF");
  Serial.println("=================================");
}

void turnAllOff() {
  digitalWrite(MIXER_PIN, LOW);
  digitalWrite(CLEAN_PUMP_RELAY_PIN, LOW);
  digitalWrite(OUT_PUMP_1_RELAY_PIN, HIGH);
  digitalWrite(OUT_PUMP_2_RELAY_PIN, HIGH);
  for (int i = 0; i < 6; i++) {
    digitalWrite(PUMP_IN1[i], LOW);
    digitalWrite(PUMP_IN2[i], LOW);
  }
  Serial.println("-> EVERYTHING TURNED OFF");
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  // Initialize Ultrasonic
  pinMode(ULTRASONIC_TRIG_PIN, OUTPUT);
  pinMode(ULTRASONIC_ECHO_PIN, INPUT);
  digitalWrite(ULTRASONIC_TRIG_PIN, LOW);

  // Initialize Mixer
  pinMode(MIXER_PIN, OUTPUT);

  // Initialize Relays (Active LOW, so start HIGH)
  pinMode(CLEAN_PUMP_RELAY_PIN, OUTPUT);
  pinMode(OUT_PUMP_1_RELAY_PIN, OUTPUT);
  pinMode(OUT_PUMP_2_RELAY_PIN, OUTPUT);

  // Initialize L298N Pumps
  for (int i = 0; i < 6; i++) {
    pinMode(PUMP_IN1[i], OUTPUT);
    pinMode(PUMP_IN2[i], OUTPUT);
  }

  turnAllOff();
  printMenu();
}

void loop() {
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toLowerCase();
    
    if (cmd.length() == 0) return;

    if (cmd == "u") {
      Serial.println("\n-> Reading Ultrasonic...");
      digitalWrite(ULTRASONIC_TRIG_PIN, LOW);
      delayMicroseconds(2);
      digitalWrite(ULTRASONIC_TRIG_PIN, HIGH);
      delayMicroseconds(10);
      digitalWrite(ULTRASONIC_TRIG_PIN, LOW);
      long duration = pulseIn(ULTRASONIC_ECHO_PIN, HIGH, 30000UL);
      if (duration == 0) Serial.println("   TIMEOUT");
      else Serial.printf("   %.1f mm\n", (duration * 0.343f) / 2.0f);
    } 
    else if (cmd == "all off") {
      turnAllOff();
    }
    else if (cmd.startsWith("p") && cmd.length() >= 5) {
      int pNum = cmd.charAt(1) - '0';
      if (pNum >= 1 && pNum <= 6) {
        int idx = pNum - 1;
        if (cmd.endsWith("on")) {
          digitalWrite(PUMP_IN1[idx], HIGH);
          digitalWrite(PUMP_IN2[idx], LOW);
          Serial.printf("-> Pump %d ON (IN1=HIGH, IN2=LOW)\n", pNum);
        } else if (cmd.endsWith("off")) {
          digitalWrite(PUMP_IN1[idx], LOW);
          digitalWrite(PUMP_IN2[idx], LOW);
          Serial.printf("-> Pump %d OFF\n", pNum);
        }
      } else {
        Serial.println("Invalid pump number! Use p1 to p6.");
      }
    }
    else if (cmd == "m on") {
      digitalWrite(MIXER_PIN, HIGH);
      Serial.println("-> Mixer ON");
    }
    else if (cmd == "m off") {
      digitalWrite(MIXER_PIN, LOW);
      Serial.println("-> Mixer OFF");
    }
    else if (cmd == "c on") {
      digitalWrite(CLEAN_PUMP_RELAY_PIN, HIGH);
      Serial.println("-> Clean Pump Relay ON");
    }
    else if (cmd == "c off") {
      digitalWrite(CLEAN_PUMP_RELAY_PIN, LOW);
      Serial.println("-> Clean Pump Relay OFF");
    }
    else if (cmd == "o1 on") {
      digitalWrite(OUT_PUMP_1_RELAY_PIN, LOW);
      Serial.println("-> Out Pump 1 Relay ON");
    }
    else if (cmd == "o1 off") {
      digitalWrite(OUT_PUMP_1_RELAY_PIN, HIGH);
      Serial.println("-> Out Pump 1 Relay OFF");
    }
    else if (cmd == "o2 on") {
      digitalWrite(OUT_PUMP_2_RELAY_PIN, LOW);
      Serial.println("-> Out Pump 2 Relay ON");
    }
    else if (cmd == "o2 off") {
      digitalWrite(OUT_PUMP_2_RELAY_PIN, HIGH);
      Serial.println("-> Out Pump 2 Relay OFF");
    }
    else {
      Serial.println("-> Unknown command. Please refer to the menu.");
      printMenu();
    }
  }
}
