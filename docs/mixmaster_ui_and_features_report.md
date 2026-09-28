# MixMaster Pro - Comprehensive UI & Feature Deep Dive

This document details every feature, user interface, and backend function that makes up the user experience of the MixMaster Pro system. It covers the three distinct interfaces: The Customer Frontend, the Admin Dashboard, and the Developer Calibration Panel.

---

## 1. Customer User Interface (The Ordering App)
The customer interface is designed to be deployed on a tablet mounted to the machine or accessed via QR code on a customer's smartphone. It is a single-page application built with responsive HTML/CSS and Vanilla JavaScript.

### 1.1 Menu Browsing & Drink Selection
*   **Dynamic Menu Rendering:** The app fetches the current available drinks from the backend (`GET /api/recipes`). It renders beautiful, color-coded drink cards containing the drink's name, description, ingredients, and price.
*   **Availability Filtering:** Drinks marked as "unavailable" by the admin are automatically hidden from the customer view.

### 1.2 Custom Drink Builder
*   **Custom Mixology:** Customers can bypass the predefined menu and click "Create Custom Drink". 
*   **Hardware-Aware Choices:** The backend checks the physical `hardware.json` file to see exactly which liquids are currently hooked up to the physical pumps. It dynamically populates the Custom Drink menu with only those available ingredients.
*   **Proportion Sliders:** Customers can select multiple ingredients and adjust their exact milliliter (ml) proportions using range sliders. The total volume is capped by the system's safe mixing capacity.

### 1.3 Cart & Checkout System
*   **State Management:** Orders are temporarily held in an array (the Cart). The UI calculates total costs in real-time.
*   **Order Submission:** Upon clicking "Order Now", the frontend asks for a Customer Name and Table Number. It then compiles the cart data and sends a `POST /api/orders` request to the backend.

### 1.4 Real-time Order Tracking
*   **Status Screen:** After ordering, the customer is shown an Order Confirmation screen.
*   **Queue Calculation:** The Node.js backend looks at all currently active orders and calculates the customer's exact queue position. It multiplies this by an estimated mix time (e.g., 3 minutes per drink) to provide an "Estimated Wait Time".
*   **Live Polling:** The customer's screen polls the backend every few seconds to update their queue position as drinks ahead of them are completed.

---

## 2. Admin Dashboard (Bartender / Manager UI)
The Admin Dashboard (`/admin`) is a secure, PIN-protected interface designed for the staff operating the venue.

### 2.1 Live Order Queue Management
*   **Kanban-style Tracking:** The dashboard displays all active orders in real-time, categorized by their current status: `Queued`, `Mixing`, `Ready`, or `Collected`.
*   **Filter Tabs:** Staff can quickly filter the view to see only drinks that need attention.
*   **Lifecycle Controls:** Staff can click buttons on an order card to advance its state. Clicking "Start Mixing" triggers the Node.js server to parse the drink's ingredients and fire the `/start-recipe` command to the ESP32.
*   **Auto-Advancement:** When the ESP32 physically finishes pouring a drink into a cup, it notifies the Node.js server, which automatically updates the Admin Dashboard to move the order from `Mixing` to `Ready` without the bartender needing to touch the screen.

### 2.2 Menu & Recipe Management (CRUD)
*   **Add / Edit Recipes:** Staff can open a modal to create new drinks. They specify the Drink Name, Description, Price, and Hex Color (for UI aesthetics).
*   **Ingredient Mapping:** Staff add ingredients to the recipe by selecting a liquid name and the required volume in milliliters.
*   **One-Click Availability:** If a specific liquor runs out, the bartender can toggle a recipe's "Available" switch, instantly removing it from the customer-facing iPads.

### 2.3 System Controls
*   **Clean System Trigger:** A globally accessible "Clean System" button allows the bartender to run a high-pressure water wash cycle between sticky drinks.
*   **Emergency Stop:** A global stop command that instantly halts all pumps and motors on the ESP32 in case of a spill or cup failure.

### 2.4 Analytics & Reporting
*   **Data Aggregation:** The backend parses the historical `orders.json` file to generate business intelligence.
*   **Metrics Displayed:** Total revenue generated, total number of drinks served, and most popular drinks.

---

## 3. Developer / Hardware Panel (Engineering UI)
The Developer Panel (`/admin/developer`) is a specialized engineering interface used during machine assembly, maintenance, and calibration. It directly interfaces with the ESP32 microcontroller.

### 3.1 Live Hardware Telemetry
*   **Real-time Dashboard:** Displays the raw data streaming from the ESP32 every 2 seconds.
*   **Metrics:** Shows the exact C++ State Machine status (e.g., `STATE_SERVING`), the raw distance measured by the ultrasonic sensor in millimeters, and the calculated liquid volume currently in the mixing bowl.

### 3.2 Individual Component Diagnostics (Relay Testing)
*   **Manual Overrides:** The UI features individual ON/OFF toggle switches for every single physical component (Pump 1 through 6, Out Pump 1, Drain Pump, Water Pump, and the Mixer Motor).
*   **Priming:** This allows engineers to manually run a pump to "prime" the silicone tubing (sucking liquid from the bottle to the nozzle) before the machine is put into active service.

### 3.3 Hardware-to-Software Mapping
*   **Slot Assignment:** The machine has 6 physical tubes. The Developer panel allows the engineer to define *what* liquid is currently connected to *which* tube (e.g., Slot 1 = Vodka, Slot 2 = Cranberry Juice). This mapping is saved to `hardware.json` and is what dynamically powers the Customer's "Custom Drink Builder".

### 3.4 Precision Flow-Rate Calibration
Because peristaltic pumps and centrifugal pumps output liquid at vastly different speeds depending on manufacturing tolerances and liquid viscosity, the system relies on dynamic math rather than hardcoded timers.
*   **Calibration Inputs:** Engineers can run a physical pump, measure the output in a graduated cylinder, and calculate how many milliseconds it takes to pump exactly 1 milliliter of fluid.
*   **Dynamic Syncing:** The engineer inputs this `ms/ml` value into the Developer UI. The Node.js server saves it to the database and instantly pushes it over Wi-Fi into the ESP32's RAM. The ESP32 immediately uses this new mathematical constant to perfectly time all future drinks, ensuring down-to-the-milliliter accuracy.
