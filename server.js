const express = require('express');
const fs      = require('fs');
const path    = require('path');
const http    = require('http');  // for calling ESP32 over WiFi

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Serve admin static assets (css/js) under /admin path
app.use('/admin/css', express.static(path.join(__dirname, 'admin', 'css')));
app.use('/admin/js', express.static(path.join(__dirname, 'admin', 'js')));
// NOTE: Simulator is NOT served by this server.
// It runs as a standalone file on PC2 (open simulator.html directly in Chrome).

// Data file paths
const RECIPES_FILE       = path.join(__dirname, 'data', 'recipes.json');
const ORDERS_FILE        = path.join(__dirname, 'data', 'orders.json');
const HW_CONFIG_FILE     = path.join(__dirname, 'data', 'hardware_config.json');
const CAL_FILE           = path.join(__dirname, 'data', 'pump_calibration.json');
const MACHINE_STATE_FILE = path.join(__dirname, 'data', 'machine_state.json');

// ── ESP32 connection config (edit to match your ESP32 IP) ─────
let ESP32_IP   = '192.168.1.200';   // change to actual ESP32 IP after it connects
const ESP32_PORT = 80;

// In-memory machine state (also written to machine_state.json)
let machineStatus = { state: 'IDLE', bowl_level_ml: 0, bowl_level_mm: 0, order_id: null, ip: null, lastSeen: null };
  let autoCleanEnabled = false;

// ── Call ESP32 HTTP endpoint ──────────────────────────────────
function callESP32(path, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj || {});
    const req  = http.request({
      host: ESP32_IP, port: ESP32_PORT, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 4000
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ESP32 timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Build ingredient list from order for ESP32 ────────────────
function buildIngredients(order) {
  // Custom drink: components already have pump index + ml
  if (order.isCustom && order.customComponents && order.customComponents.length) {
    return order.customComponents
      .filter(c => c.ml > 0)
      .map(c => ({ pump: c.pump, ml: c.ml }));
  }

  // Recipe-based drink: map ingredient names to pump slots
  const hwCfg = readData(HW_CONFIG_FILE);
  const pumps = hwCfg.pumps || [];
  const ingredients = [];
  const recipes = readData(RECIPES_FILE);

  for (const item of (order.items || [])) {
    const recipe = recipes.find(r => r.id === item.recipeId || r.name === item.name);
    if (!recipe) continue;
    for (const ing of (recipe.ingredients || [])) {
      const pump = pumps.find(p => p.liquid.toLowerCase() === ing.name.toLowerCase());
      if (pump) ingredients.push({ pump: pump.slot - 1, ml: ing.amount });
    }
  }
  return ingredients;
}

// Helper functions
function readData(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// ============================================================
//  CUSTOMER ROUTES
// ============================================================

// GET all available drinks (customer)
app.get('/api/drinks', (req, res) => {
  const recipes = readData(RECIPES_FILE);
  const available = recipes.filter(r => r.available);
  res.json(available);
});

// POST new order (after payment)
app.post('/api/orders', (req, res) => {
  const { customerName, tableNumber, items, paymentMethod, totalAmount } = req.body;
  
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'No items in order' });
  }

  const orders = readData(ORDERS_FILE);
  const queuePosition = orders.filter(o => ['queued', 'mixing'].includes(o.status)).length + 1;
  
  const newOrder = {
    id: generateId(),
    customerName: customerName || 'Guest',
    tableNumber: tableNumber || 'Bar',
    items,
    paymentMethod,
    totalAmount,
    status: 'queued',          // queued | mixing | ready | collected
    queuePosition,
    estimatedWait: queuePosition * 3,  // ~3 minutes per drink
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  orders.push(newOrder);
  writeData(ORDERS_FILE, orders);
        if (autoCleanEnabled) { setTimeout(() => { callESP32('/start-clean', {}) }, 3000); }

  res.status(201).json(newOrder);
});

// POST custom drink order (from Build Your Own builder)
app.post('/api/orders/custom', (req, res) => {
  const { customerName, tableNumber, drinkName, components, paymentMethod, totalAmount } = req.body;
  // components = [{ pump: 0, liquid: "White Rum", ml: 60 }, ...]

  if (!components || components.length === 0) {
    return res.status(400).json({ error: 'No components in custom drink' });
  }

  const totalMl = components.reduce((s, c) => s + (c.ml || 0), 0);
  if (totalMl > 260) {
    return res.status(400).json({ error: `Total liquid ${totalMl}ml exceeds cup size (250ml)` });
  }

  const hwCfg = readData(HW_CONFIG_FILE);
  const pumps = hwCfg.pumps || [];

  // Build items array compatible with the orders system
  const items = [{
    recipeId: 'custom',
    name: drinkName || 'My Custom Drink',
    isCustom: true,
    components: components.map(c => ({
      pump: c.pump,
      liquid: c.liquid,
      ml: c.ml
    }))
  }];

  const orders = readData(ORDERS_FILE);
  const queuePosition = orders.filter(o => ['queued', 'mixing'].includes(o.status)).length + 1;

  const newOrder = {
    id: generateId(),
    customerName: customerName || 'Guest',
    tableNumber: tableNumber || 'Bar',
    items,
    isCustom: true,
    customComponents: components,
    paymentMethod,
    totalAmount,
    status: 'queued',
    queuePosition,
    estimatedWait: queuePosition * 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  orders.push(newOrder);
  writeData(ORDERS_FILE, orders);
        if (autoCleanEnabled) { setTimeout(() => { callESP32('/start-clean', {}) }, 3000); }
  res.status(201).json(newOrder);
});

// GET specific order status (polling from queue page)
app.get('/api/orders/:id', (req, res) => {
  const orders = readData(ORDERS_FILE);
  const order = orders.find(o => o.id === req.params.id);
  
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  // Recalculate queue position
  const activeOrders = orders.filter(o => ['queued', 'mixing'].includes(o.status));
  const pos = activeOrders.findIndex(o => o.id === order.id);
  if (pos !== -1) order.queuePosition = pos + 1;
  
  res.json(order);
});

// ============================================================
//  ADMIN ROUTES  (protected with simple token)
// ============================================================

const ADMIN_PASSWORD = 'mixmaster2025';

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: Buffer.from(ADMIN_PASSWORD).toString('base64') });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Middleware: check admin token
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token === Buffer.from(ADMIN_PASSWORD).toString('base64')) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// GET all recipes (admin)
app.get('/api/admin/recipes', adminAuth, (req, res) => {
  res.json(readData(RECIPES_FILE));
});

// POST add new recipe
app.post('/api/admin/recipes', adminAuth, (req, res) => {
  const recipes = readData(RECIPES_FILE);
  const newRecipe = {
    id: generateId(),
    ...req.body,
    available: req.body.available !== false,
    createdAt: new Date().toISOString()
  };
  recipes.push(newRecipe);
  writeData(RECIPES_FILE, recipes);
  res.status(201).json(newRecipe);
});

// PUT update recipe
app.put('/api/admin/recipes/:id', adminAuth, (req, res) => {
  const recipes = readData(RECIPES_FILE);
  const idx = recipes.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Recipe not found' });
  
  recipes[idx] = { ...recipes[idx], ...req.body, id: req.params.id, updatedAt: new Date().toISOString() };
  writeData(RECIPES_FILE, recipes);
  res.json(recipes[idx]);
});

// DELETE recipe
app.delete('/api/admin/recipes/:id', adminAuth, (req, res) => {
  const recipes = readData(RECIPES_FILE);
  const filtered = recipes.filter(r => r.id !== req.params.id);
  if (filtered.length === recipes.length) return res.status(404).json({ error: 'Recipe not found' });
  writeData(RECIPES_FILE, filtered);
  res.json({ success: true });
});

// GET all orders (admin)
app.get('/api/admin/orders', adminAuth, (req, res) => {
  const orders = readData(ORDERS_FILE);
  res.json(orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// PATCH update order status (admin marks as mixing / ready / collected)
app.patch('/api/admin/orders/:id', adminAuth, async (req, res) => {
  const orders = readData(ORDERS_FILE);
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Order not found' });

  const prevStatus = orders[idx].status;
  orders[idx] = { ...orders[idx], ...req.body, updatedAt: new Date().toISOString() };
  writeData(ORDERS_FILE, orders);
        if (autoCleanEnabled) { setTimeout(() => { callESP32('/start-clean', {}) }, 3000); }

  const order = orders[idx];

  // ── Auto-trigger ESP32 when status moves to 'mixing' ─────────
  if (req.body.status === 'mixing' && prevStatus !== 'mixing') {
    const ingredients = buildIngredients(order);
    try {
      const espRes = await callESP32('/start-recipe', {
        order_id: order.id,
        ingredients: ingredients.length ? ingredients : undefined
      });
      console.log(`[ESP32] start-recipe → ${JSON.stringify(espRes)}`);
      order.machineTriggered = true;
      orders[idx] = { ...order, updatedAt: new Date().toISOString() };
      writeData(ORDERS_FILE, orders);
        if (autoCleanEnabled) { setTimeout(() => { callESP32('/start-clean', {}) }, 3000); }
    } catch (e) {
      console.warn(`[ESP32] Could not reach ESP32 at ${ESP32_IP}: ${e.message}`);
      // Don't fail the request — order status still updated
    }
  }

  // Stop machine if order is cancelled
  if (['collected', 'cancelled'].includes(req.body.status) && prevStatus === 'mixing') {
    callESP32('/stop', {}).catch(() => {});
  }

  res.json(orders[idx]);
});

// DELETE order (admin cleanup)
app.delete('/api/admin/orders/:id', adminAuth, (req, res) => {
  const orders = readData(ORDERS_FILE);
  const filtered = orders.filter(o => o.id !== req.params.id);
  writeData(ORDERS_FILE, filtered);
  res.json({ success: true });
});

// ============================================================
//  ADMIN PANEL STATIC ROUTES
// ============================================================
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});
app.get('/admin/developer', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'developer.html'));
});

// ============================================================
//  HARDWARE API  (no auth — dev tool, local network only)
// ============================================================

// GET hardware config (machine params + pump slot mapping)
app.get('/api/hardware/config', (req, res) => {
  res.json(readData(HW_CONFIG_FILE));
});

// POST update hardware config (partial merge)
app.post('/api/hardware/config', (req, res) => {
  const existing = readData(HW_CONFIG_FILE);
  const updated  = {
    ...existing,
    machine: req.body.machine ? { ...existing.machine, ...req.body.machine } : existing.machine,
    pumps:   req.body.pumps   || existing.pumps,
    updatedAt: new Date().toISOString()
  };
  writeData(HW_CONFIG_FILE, updated);
  
  // Sync new calibration values to ESP32 immediately
  if (updated.pumps) {
    updated.pumps.forEach(async (p, idx) => {
      try {
        await callESP32('/set-cal', { pump: idx, ms_per_ml: p.msPerMl });
      } catch (e) {
        console.error(`Failed to sync cal for pump ${idx}:`, e.message);
      }
    });
  }
  if (updated.machine && updated.machine.outPumpMsPerMl) {
    callESP32('/set-cal', { pump: 99, ms_per_ml: updated.machine.outPumpMsPerMl }).catch(()=>{});
  }
  
  res.json(updated);
});

// GET all pump calibration records
app.get('/api/hardware/calibration', (req, res) => {
  res.json(readData(CAL_FILE));
});

// POST test a hardware component manually
app.post('/api/hardware/test-component', async (req, res) => {
  try {
    const espRes = await callESP32('/test-component', req.body);
    res.json({ ok: true, esp: espRes });
  } catch (e) {
    res.status(502).json({ error: `Cannot reach ESP32: ${e.message}` });
  }
});

// POST new calibration measurement for a pump slot
app.post('/api/hardware/calibration', (req, res) => {
  const { pumpSlot, msPerMl, testedMl, measuredMl, method } = req.body;
  if (!pumpSlot || !msPerMl) return res.status(400).json({ error: 'pumpSlot and msPerMl required' });

  const cals = readData(CAL_FILE);
  const idx  = cals.findIndex(c => c.pumpSlot === pumpSlot);
  const entry = { date: new Date().toISOString(), msPerMl, testedMl, measuredMl, method };

  if (idx !== -1) {
    cals[idx].msPerMl = msPerMl;
    cals[idx].history = [...(cals[idx].history || []), entry].slice(-20); // keep last 20
  } else {
    cals.push({ pumpSlot, msPerMl, history: [entry] });
  }

  // Also update msPerMl in hardware_config.json pump slot
  const cfg = readData(HW_CONFIG_FILE);
  const pi  = cfg.pumps.findIndex(p => p.slot === pumpSlot);
  if (pi !== -1) cfg.pumps[pi].msPerMl = msPerMl;
  writeData(HW_CONFIG_FILE, cfg);
  writeData(CAL_FILE, cals);
  res.json({ success: true, pumpSlot, msPerMl });
});

// ============================================================
//  MACHINE BRIDGE API
//  ESP32 → POST /api/machine/status  (ESP32 calls this every 2s)
//  Admin  → POST /api/machine/trigger (manual trigger)
//  Admin  → GET  /api/machine/status  (read current machine state)
//  Admin  → POST /api/machine/set-esp-ip (update ESP32 IP)
// ============================================================

// ESP32 posts its status here every 2 seconds
app.post('/api/machine/status', (req, res) => {
  const { state, bowl_level_ml, bowl_level_mm, order_id, ip } = req.body;
  machineStatus = { state, bowl_level_ml, bowl_level_mm, order_id, ip, lastSeen: new Date().toISOString() };

  // If ESP32 reports the machine is now idle and we have a 'mixing' order, mark it ready
  if (state === 'IDLE' && order_id) {
    const orders = readData(ORDERS_FILE);
    const idx = orders.findIndex(o => o.id === order_id && o.status === 'mixing');
    if (idx !== -1) {
      orders[idx].status    = 'ready';
      orders[idx].updatedAt = new Date().toISOString();
      writeData(ORDERS_FILE, orders);
        if (autoCleanEnabled) { setTimeout(() => { callESP32('/start-clean', {}) }, 3000); }
      console.log(`[ESP32] Order ${order_id} finished mixing → marked ready`);
    }
  }

  // Update known ESP32 IP dynamically
  if (ip) ESP32_IP = ip;

  res.json({ ok: true });
});

// Admin reads current machine state
app.get('/api/machine/autoclean', (req, res) => res.json({ enabled: autoCleanEnabled }));
  app.post('/api/machine/autoclean', adminAuth, (req, res) => { autoCleanEnabled = !!req.body.enabled; res.json({ enabled: autoCleanEnabled }); });

  app.get('/api/machine/status', (req, res) => {
  console.log("GET /api/machine/status ->", machineStatus);
  res.json(machineStatus);
});

// Admin manually sets ESP32 IP
app.post('/api/machine/set-esp-ip', adminAuth, (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip required' });
  ESP32_IP = ip;
  console.log(`[CONFIG] ESP32 IP set to ${ESP32_IP}`);
  res.json({ ok: true, ip: ESP32_IP });
});

// Admin manually triggers mixing for an order (without changing status)
app.post('/api/machine/trigger', adminAuth, async (req, res) => {
  const { order_id } = req.body;
  const orders = readData(ORDERS_FILE);
  const order  = orders.find(o => o.id === order_id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const ingredients = buildIngredients(order);
  try {
    const espRes = await callESP32('/start-recipe', { order_id, ingredients });
    res.json({ ok: true, esp: espRes });
  } catch (e) {
    res.status(502).json({ error: `Cannot reach ESP32 at ${ESP32_IP}: ${e.message}` });
  }
});

// Admin sends clean cycle
app.post('/api/machine/clean', adminAuth, async (req, res) => {
  try {
    const r = await callESP32('/start-clean', {});
    res.json({ ok: true, esp: r });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Admin sends stop
app.post('/api/machine/stop', adminAuth, async (req, res) => {
  try {
    const r = await callESP32('/stop', {});
    res.json({ ok: true, esp: r });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ============================================================
//  START SERVER
// ============================================================
// Sync all calibrations to ESP32 on boot
function syncCalibrationsToESP() {
  const hwCfg = readData(HW_CONFIG_FILE);
  if (hwCfg) {
    console.log("[Boot] Syncing pump calibrations to ESP32...");
    if (hwCfg.pumps) {
      hwCfg.pumps.forEach(async (p, idx) => {
        try { await callESP32('/set-cal', { pump: idx, ms_per_ml: p.msPerMl }); } 
        catch (e) {}
      });
    }
    if (hwCfg.machine && hwCfg.machine.outPumpMsPerMl) {
      callESP32('/set-cal', { pump: 99, ms_per_ml: hwCfg.machine.outPumpMsPerMl }).catch(()=>{});
    }
  }
}

app.listen(PORT, '0.0.0.0', () => {
  syncCalibrationsToESP();
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   🍹  MixMaster Pro Server                       ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║   Customer  : http://localhost:${PORT}               ║`);
  console.log(`║   Admin     : http://localhost:${PORT}/admin         ║`);
  console.log(`║   Dev Panel : http://localhost:${PORT}/admin/developer ║`);
  console.log('╚══════════════════════════════════════════════════╝\n');
});

