// =============================================================
//  developer.js — Developer Panel logic
// =============================================================

const TOKEN = localStorage.getItem('adminToken') || '';
const api = (path, opts = {}) =>
  fetch(path, { headers: { 'x-admin-token': TOKEN, 'Content-Type': 'application/json' }, cache: 'no-store', ...opts });

let hwConfig = null;
let calData  = null;

// ── Pump colors ───────────────────────────────────────────────
const DEFAULT_COLORS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff922b','#cc5de8'];

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => el.classList.remove('show'), 3200);
}

// ── Load data ─────────────────────────────────────────────────
async function loadAll() {
  try {
    const [cfgRes, calRes] = await Promise.all([
      api('/api/hardware/config'),
      api('/api/hardware/calibration')
    ]);
    hwConfig = await cfgRes.json();
    calData  = await calRes.json();
    renderPumpCards();
    renderParams();
    renderMapping();
  } catch (e) {
    toast('Failed to load config: ' + e.message, true);
  }
}

// ── Pump calibration cards ────────────────────────────────────
function renderPumpCards() {
  const grid = document.getElementById('pumpGrid');
  grid.innerHTML = '';
  hwConfig.pumps.forEach((pump, i) => {
    const cal = calData.find(c => c.pumpSlot === pump.slot) || { msPerMl: pump.msPerMl, history:[] };
    const color = pump.color || DEFAULT_COLORS[i];

    const card = document.createElement('div');
    card.className = 'pump-card';
    card.innerHTML = `
      <div class="pump-header">
        <div class="pump-slot-badge" style="border-color:${color};color:${color};background:${color}18">P${pump.slot}</div>
        <div class="pump-slot-info">
          <div class="pump-slot-name" style="color:${color}">${pump.liquid}</div>
          <div class="pump-slot-sub">${pump.label}</div>
        </div>
      </div>

      <div class="pump-cal-display">
        <div class="pump-cal-val" id="calVal_${i}">${cal.msPerMl.toFixed(1)}</div>
        <div class="pump-cal-unit">ms/ml</div>
        <div class="pump-cal-label">calibration</div>
      </div>

      <div class="cal-form">
        <div class="cal-row">
          <label>Manual ms/ml:</label>
          <input type="number" id="manualMsPerMl_${i}" value="${cal.msPerMl.toFixed(1)}" step="0.1" min="10" max="5000">
          <button class="btn btn-cyan" onclick="setManual(${i})">Set</button>
        </div>
        <hr style="border-color:#1a2540;margin:4px 0">
        <div class="card-label" style="margin-top:4px">RUN TEST PRIME</div>
        <div class="cal-row">
          <label>Run pump for:</label>
          <input type="number" id="testMl_${i}" value="10" min="1" max="100" step="1">
          <span style="font-size:11px;color:var(--muted)">ml</span>
          <button class="btn btn-yellow" onclick="runPrime(${i})">▶ Prime</button>
        </div>
        <div class="cal-row">
          <label>Actually measured:</label>
          <input type="number" id="measuredMl_${i}" placeholder="e.g. 9.5" step="0.1" min="0.1">
          <span style="font-size:11px;color:var(--muted)">ml</span>
          <button class="btn btn-green" onclick="calibrate(${i})">Calibrate</button>
        </div>
        <div class="cal-result" id="calResult_${i}">
          ${cal.history.length ? `Last cal: ${new Date(cal.history.at(-1).date).toLocaleDateString()} — ${cal.history.at(-1).msPerMl.toFixed(1)} ms/ml` : 'No calibration history yet'}
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

// ── Manual set ────────────────────────────────────────────────
async function setManual(i) {
  const msPerMl = parseFloat(document.getElementById(`manualMsPerMl_${i}`).value);
  if (!msPerMl || msPerMl <= 0) return toast('Invalid value', true);
  await saveCalibration(i, msPerMl, null, null, 'manual');
}

// ── Run prime (calls server to send PRIME_PUMP to ESP32) ──────
async function runPrime(i) {
  const ml = parseFloat(document.getElementById(`testMl_${i}`).value);
  const durMs = ml * (hwConfig.pumps[i]?.msPerMl || 320);
  try {
    await api('/api/hardware/send-command', {
      method: 'POST',
      body: JSON.stringify({ cmd: 'PRIME_PUMP', pump: i, duration_ms: durMs })
    });
    toast(`Pump ${i+1}: running for ${durMs.toFixed(0)}ms (~${ml}ml)`);
  } catch(e) {
    toast(`Prime failed (no serial bridge?): ${e.message}`, true);
  }
}

// ── Calibrate using measured amount ──────────────────────────
async function calibrate(i) {
  const targetMl   = parseFloat(document.getElementById(`testMl_${i}`).value);
  const measuredMl = parseFloat(document.getElementById(`measuredMl_${i}`).value);
  if (!measuredMl || measuredMl <= 0) return toast('Enter measured amount first', true);

  const oldMsPerMl = calData.find(c=>c.pumpSlot === hwConfig.pumps[i].slot)?.msPerMl || 320;
  const newMsPerMl = oldMsPerMl * (measuredMl / targetMl);
  const correction = measuredMl / targetMl;

  const res = document.getElementById(`calResult_${i}`);
  res.className = 'cal-result ' + (Math.abs(correction-1) < 0.03 ? 'ok' : 'warn');
  res.textContent = `Correction: ×${correction.toFixed(3)} → new ms/ml: ${newMsPerMl.toFixed(1)}`;

  await saveCalibration(i, newMsPerMl, targetMl, measuredMl, 'prime');
}

async function saveCalibration(i, msPerMl, testedMl, measuredMl, method) {
  try {
    const slot = hwConfig.pumps[i].slot;
    const body = { pumpSlot: slot, msPerMl, testedMl, measuredMl, method };
    await api('/api/hardware/calibration', { method:'POST', body: JSON.stringify(body) });

    // Refresh display
    document.getElementById(`calVal_${i}`).textContent = msPerMl.toFixed(1);
    document.getElementById(`manualMsPerMl_${i}`).value = msPerMl.toFixed(1);

    // Push to ESP32 if connected
    await api('/api/hardware/send-command', {
      method:'POST',
      body: JSON.stringify({ cmd:'SET_PUMP_CAL', pump:i, ms_per_ml: msPerMl })
    }).catch(()=>{});

    await loadAll(); // refresh calData
    toast(`Pump ${i+1} calibrated: ${msPerMl.toFixed(1)} ms/ml`);
  } catch(e) { toast('Save failed: ' + e.message, true); }
}

// ── Machine parameters ────────────────────────────────────────
const PARAM_DEFS = [
  { key:'bowlCapacityMl',  label:'Bowl Capacity',       unit:'ml',  desc:'Maximum mixing bowl volume' },
  { key:'bowlFullMm',      label:'Bowl Full Distance',  unit:'mm',  desc:'HC-SR04 reading when bowl is full' },
  { key:'bowlEmptyMm',     label:'Bowl Empty Distance', unit:'mm',  desc:'HC-SR04 reading when bowl is empty' },
  { key:'cleanFillMl',     label:'Clean Fill Volume',   unit:'ml',  desc:'Water volume for cleaning cycle' },
  { key:'cleanMixTimeS',   label:'Clean Mix Duration',  unit:'s',   desc:'Seconds to run mixer during clean' },
  { key:'outPumpMsPerMl',  label:'Out Pump Speed',      unit:'ms/ml',desc:'Draining flow rate (centrifugal pump)' },
];

function renderParams() {
  const grid = document.getElementById('paramsGrid');
  grid.innerHTML = '';
  const m = hwConfig.machine;
  PARAM_DEFS.forEach(def => {
    const div = document.createElement('div');
    div.className = 'param-item';
    div.innerHTML = `
      <div class="param-label">${def.label}</div>
      <div class="param-desc">${def.desc}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="param-input" id="param_${def.key}" type="number" value="${m[def.key] ?? ''}" step="${def.unit==='°C'||def.unit==='s'||def.unit==='mm'?'0.5':'1'}">
        <span class="param-unit">${def.unit}</span>
      </div>
    `;
    grid.appendChild(div);
  });
}

async function saveParams() {
  const m = { ...hwConfig.machine };
  PARAM_DEFS.forEach(def => {
    const el = document.getElementById(`param_${def.key}`);
    if (el) m[def.key] = parseFloat(el.value);
  });
  try {
    await api('/api/hardware/config', { method:'POST', body: JSON.stringify({ machine: m }) });
    hwConfig.machine = m;
    toast('Machine parameters saved ✓');
  } catch(e) { toast('Save failed: ' + e.message, true); }
}

// ── Pump mapping ──────────────────────────────────────────────
function renderMapping() {
  const body = document.getElementById('mappingBody');
  body.innerHTML = '';
  hwConfig.pumps.forEach((pump, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong style="color:${pump.color||DEFAULT_COLORS[i]};font-family:var(--mono)">P${pump.slot}</strong></td>
      <td><input id="mapLabel_${i}" value="${pump.label}" style="width:100px"></td>
      <td><input id="mapLiquid_${i}" value="${pump.liquid}"></td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="color-dot" id="colorDot_${i}" style="background:${pump.color||DEFAULT_COLORS[i]}"></span>
          <input type="color" id="mapColor_${i}" value="${pump.color||DEFAULT_COLORS[i]}" style="width:40px;height:28px;border:none;background:none;cursor:pointer"
            onchange="document.getElementById('colorDot_${i}').style.background=this.value">
        </div>
      </td>
      <td style="font-family:var(--mono);color:var(--cyan)">
        ${(calData.find(c=>c.pumpSlot===pump.slot)?.msPerMl||pump.msPerMl).toFixed(1)} ms/ml
      </td>
    `;
    body.appendChild(tr);
  });
}

async function saveMapping() {
  const pumps = hwConfig.pumps.map((pump, i) => ({
    ...pump,
    label:  document.getElementById(`mapLabel_${i}`)?.value  || pump.label,
    liquid: document.getElementById(`mapLiquid_${i}`)?.value || pump.liquid,
    color:  document.getElementById(`mapColor_${i}`)?.value  || pump.color,
  }));
  try {
    await api('/api/hardware/config', { method:'POST', body: JSON.stringify({ pumps }) });
    hwConfig.pumps = pumps;
    renderPumpCards();
    toast('Pump mapping saved ✓');
  } catch(e) { toast('Save failed: ' + e.message, true); }
}

// ── Event bindings ────────────────────────────────────────────
document.getElementById('btnSaveAll').addEventListener('click', async () => {
  await saveParams(); await saveMapping(); toast('All changes saved ✓');
});
document.getElementById('btnSaveParams').addEventListener('click', saveParams);
document.getElementById('btnSaveMapping').addEventListener('click', saveMapping);

// Expose functions to inline onclick handlers
window.setManual   = setManual;
window.runPrime    = runPrime;
window.calibrate   = calibrate;

// ── Init ──────────────────────────────────────────────────────
loadAll();
// -- Hardware Diagnostics Testing -----------------------------
async function testComponent(comp, state) {
  try {
    const res = await api('/api/hardware/test-component', {
      method: 'POST',
      body: JSON.stringify({ component: comp, state })
    });
    toast(`Component ${comp} turned ${state ? 'ON' : 'OFF'}`);
  } catch (e) {
    toast(`Test failed: ${e.message}`, true);
  }
}
window.testComponent = testComponent;

async function manualReadDistance() {
  try {
    const res = await api('/api/machine/status');
    const data = await res.json();
    if (data && data.bowl_level_mm !== undefined) {
      alert(`Current Ultrasonic Distance: ${data.bowl_level_mm} mm\nRaw Volume (Ignored): ${data.bowl_level_ml} ml`);
    } else {
      alert("No distance data received from ESP32! RAW: " + JSON.stringify(data));
    }
  } catch(e) {
    alert("Error reading distance: " + e.message);
  }
}
window.manualReadDistance = manualReadDistance;

// Poll sensor status every 1 second
setInterval(async () => {
  try {
    const res = await api('/api/machine/status');
    const data = await res.json();
    const el = document.getElementById('ultrasonicReading');
    if (el) {
      if (data && data.bowl_level_mm !== undefined) {
         el.textContent = `Ultrasonic: ${data.bowl_level_mm} mm`;
      }
    }
  } catch(e) {}
}, 1000);
