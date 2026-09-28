// ============================================================
//  MixMaster Pro — Admin Panel JS
// ============================================================

let adminToken = sessionStorage.getItem('mm_admin_token');
let allOrders  = [];
let allRecipes = [];
let editingRecipeId = null;
let currentFilter   = 'all';
let pollInterval    = null;
let machineInterval = null;
let lastMachineStatus = null;

// ---- Particles ----
(function(){
  const c = document.getElementById('loginParticles');
  if (!c) return;
  const ctx = c.getContext('2d');
  let p = [];
  function r() { c.width = window.innerWidth; c.height = window.innerHeight; }
  r(); window.addEventListener('resize', r);
  for (let i = 0; i < 40; i++) p.push({ x: Math.random()*c.width, y: Math.random()*c.height, r: Math.random()*1.5+.5, dx: (Math.random()-.5)*.2, dy: (Math.random()-.5)*.2, col: Math.random()>.5?'#f59e0b':'#06b6d4', a: Math.random()*.3+.1 });
  function draw() { ctx.clearRect(0,0,c.width,c.height); p.forEach(pt=>{ ctx.beginPath(); ctx.arc(pt.x,pt.y,pt.r,0,Math.PI*2); ctx.fillStyle=pt.col; ctx.globalAlpha=pt.a; ctx.fill(); pt.x+=pt.dx; pt.y+=pt.dy; if(pt.x<0||pt.x>c.width)pt.dx*=-1; if(pt.y<0||pt.y>c.height)pt.dy*=-1; }); ctx.globalAlpha=1; requestAnimationFrame(draw); }
  draw();
})();

// ---- Init ----
if (adminToken) {
  showAdminApp();
} else {
  document.getElementById('loginScreen').style.display = 'flex';
}

// ---- Login ----
async function doLogin() {
  const pass = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    adminToken = data.token;
    sessionStorage.setItem('mm_admin_token', adminToken);
    document.getElementById('loginScreen').style.display = 'none';
    showAdminApp();
  } catch(e) {
    errEl.textContent = '⚠️ ' + e.message;
  }
}

function doLogout() {
  sessionStorage.removeItem('mm_admin_token');
  clearInterval(pollInterval);
  location.reload();
}

// ---- Admin App ----
function showAdminApp() {
  document.getElementById('adminApp').style.display = 'flex';
  loadOrders(); loadAutoCleanStatus();
  pollMachineStatus();
  pollInterval    = setInterval(loadOrders,        5000);
  machineInterval = setInterval(pollMachineStatus, 3000);
}

// ── Machine Status Polling ────────────────────────────────────
async function pollMachineStatus() {
  try {
    const res = await fetch('/api/machine/status', { headers: authHeaders() });
    if (!res.ok) return;
    const s = await res.json();
    lastMachineStatus = s;
    renderMachineWidget(s);
  } catch {}
}

function renderMachineWidget(s) {
  const el = document.getElementById('machineWidget');
  if (!el) return;

  const stateColors = {
    IDLE:'#4a6080', FILLING:'#fbbf24', MIXING:'#10b981',
    SERVING:'#00d4ff', CLEAN_FILL:'#3b82f6',
    CLEAN_MIX:'#8b5cf6', CLEAN_DRAIN:'#8b5cf6', ERROR:'#ef4444'
  };
  const sc = stateColors[s.state] || '#4a6080';

  const nowMs = Date.now();
  const lastMs = s.lastSeen ? new Date(s.lastSeen).getTime() : 0;
  const ageSec = Math.round((nowMs - lastMs) / 1000);
  const online = ageSec < 10;

  const onlineLabel = online
    ? `<span style="color:#10b981">● ESP32 Online</span> <span style="color:#4a6080;font-size:11px">${ageSec}s ago</span>`
    : (s.state === 'IDLE' && !s.lastSeen
      ? `<span style="color:#4a6080">○ ESP32 not connected</span>`
      : `<span style="color:#fbbf24">⚠ Last seen ${ageSec}s ago</span>`);

  el.innerHTML = `
    <div class="mw-row">
      <div class="mw-state" style="border-color:${sc};color:${sc}">${s.state || 'IDLE'}</div>
      <div class="mw-readings">
        <span>💧 ${s.bowl_level_ml != null ? s.bowl_level_ml.toFixed(0) : '--'} ml</span>
        <span>${s.order_id ? '📋 ' + s.order_id.slice(-8) : 'No active order'}</span>
      </div>
      <div class="mw-online">${onlineLabel}</div>
    </div>`;
}

function authHeaders() {
  return { 'Content-Type': 'application/json', 'x-admin-token': adminToken };
}

// ---- Navigation ----
function showSection(name) {
  ['orders','recipes','analytics'].forEach(s => {
    document.getElementById('section-' + s).style.display = s === name ? 'block' : 'none';
    document.getElementById('nav-' + s).classList.toggle('active', s === name);
  });
  const titles = { orders: 'Orders Queue', recipes: 'Recipes Manager', analytics: 'Analytics' };
  document.getElementById('adminPageTitle').textContent = titles[name];
  document.getElementById('topbarAddBtn').style.display = name === 'recipes' ? 'block' : 'none';

  if (name === 'recipes') loadRecipes();
  if (name === 'analytics') loadAnalytics();
}

// ============================================================
//  ORDERS
// ============================================================
async function loadOrders() {
  try {
    const res = await fetch('/api/admin/orders', { headers: authHeaders() });
    if (!res.ok) { doLogout(); return; }
    allOrders = await res.json();
    const active = allOrders.filter(o => ['queued','mixing'].includes(o.status)).length;
    document.getElementById('queueBadge').textContent = active;
    renderOrders();
  } catch(e) {}
}

function filterOrders(status, btn) {
  currentFilter = status;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderOrders();
}

function renderOrders() {
  const grid = document.getElementById('ordersGrid');
  const orders = currentFilter === 'all' ? allOrders : allOrders.filter(o => o.status === currentFilter);

  if (!orders.length) {
    grid.innerHTML = '<div class="empty-orders">📭 No orders found</div>';
    return;
  }

  const pillClass   = { queued:'pill-queued', mixing:'pill-mixing', ready:'pill-ready', collected:'pill-collected' };
  const statusLabel = { queued:'⏳ Queued', mixing:'🔄 Mixing', ready:'✅ Ready', collected:'🎊 Collected' };

  // Is this order currently being mixed by the machine?
  const activeMachineOrderId = lastMachineStatus?.order_id;
  const machineState = lastMachineStatus?.state || 'IDLE';

  grid.innerHTML = orders.map(o => {
    const itemsList = o.items.map(i => `${i.name}${i.qty > 1 ? ' ×'+i.qty : ''}`).join(', ');
    const date = new Date(o.createdAt).toLocaleTimeString();
    const isMachineActive = o.id === activeMachineOrderId && o.status === 'mixing';
    const activeBadge = isMachineActive
      ? `<div class="machine-active-badge">🤖 ${machineState}</div>` : '';

    return `
    <div class="order-card${isMachineActive ? ' order-card-active' : ''}" id="ocard-${o.id}">
      <div class="order-card-top">
        <div class="order-id">#${o.id.slice(-8).toUpperCase()}</div>
        <div class="order-status-pill ${pillClass[o.status] || 'pill-queued'}">${statusLabel[o.status] || o.status}</div>
      </div>
      ${activeBadge}
      <div class="order-customer">👤 ${o.customerName}</div>
      <div class="order-table">📍 ${o.tableNumber}</div>
      <div class="order-items-list">🍹 ${itemsList}</div>
      <div class="order-footer">
        <span class="order-total">$${parseFloat(o.totalAmount).toFixed(2)}</span>
        <span class="order-time">🕐 ${date}</span>
      </div>
      <div class="order-actions">
        ${o.status === 'queued'    ? `<button class="action-btn btn-mix"     onclick="updateOrder('${o.id}','mixing')">🔄 Start Mixing</button>` : ''}
        ${o.status === 'mixing'    ? `<button class="action-btn btn-ready"   onclick="updateOrder('${o.id}','ready')">✅ Mark Ready</button>` : ''}
        ${o.status === 'ready'     ? `<button class="action-btn btn-collect" onclick="updateOrder('${o.id}','collected')">🎊 Collected</button>` : ''}
        <button class="action-btn btn-delete" onclick="deleteOrder('${o.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

async function updateOrder(id, status) {
  try {
    await fetch(`/api/admin/orders/${id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status })
    });
    showToast(`Order updated → ${status}`);
    await loadOrders(); loadAutoCleanStatus();
  } catch(e) { showToast('⚠️ Failed to update order'); }
}

async function deleteOrder(id) {
  if (!confirm('Delete this order?')) return;
  try {
    await fetch(`/api/admin/orders/${id}`, { method: 'DELETE', headers: authHeaders() });
    showToast('Order deleted');
    await loadOrders(); loadAutoCleanStatus();
  } catch(e) { showToast('⚠️ Failed to delete'); }
}

// ============================================================
//  RECIPES
// ============================================================
async function loadRecipes() {
  try {
    const res = await fetch('/api/admin/recipes', { headers: authHeaders() });
    allRecipes = await res.json();
    renderRecipes();
  } catch(e) {}
}

function renderRecipes() {
  const grid = document.getElementById('recipesGrid');
  if (!allRecipes.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-muted)">No recipes yet. Add your first one!</div>';
    return;
  }
  grid.innerHTML = allRecipes.map(r => `
    <div class="recipe-card">
      <img src="${r.image || '/images/cocktails_bg.png'}" alt="${r.name}" class="recipe-img"
           onerror="this.src='/images/cocktails_bg.png'"/>
      <div class="recipe-body">
        <div class="recipe-name">${r.name}</div>
        <div class="recipe-category">${r.category === 'cocktail' ? '🥂 Cocktail' : '🧃 Mocktail'}</div>
        <div class="recipe-price">$${parseFloat(r.price).toFixed(2)}</div>
        <div class="recipe-avail">
          <div class="avail-dot ${r.available ? 'yes' : 'no'}"></div>
          <span style="color:var(--text-secondary)">${r.available ? 'Available' : 'Unavailable'}</span>
        </div>
        <div class="recipe-actions">
          <button class="recipe-btn recipe-btn-edit" onclick="openRecipeModal('${r.id}')">✏️ Edit</button>
          <button class="recipe-btn recipe-btn-toggle" onclick="toggleRecipe('${r.id}', ${!r.available})">
            ${r.available ? '🔒 Hide' : '✅ Show'}
          </button>
          <button class="recipe-btn recipe-btn-del" onclick="deleteRecipe('${r.id}')">🗑️</button>
        </div>
      </div>
    </div>`).join('');
}

async function toggleRecipe(id, available) {
  await fetch(`/api/admin/recipes/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ available }) });
  showToast(available ? 'Recipe now available ✅' : 'Recipe hidden 🔒');
  await loadRecipes();
}

async function deleteRecipe(id) {
  if (!confirm('Delete this recipe permanently?')) return;
  await fetch(`/api/admin/recipes/${id}`, { method: 'DELETE', headers: authHeaders() });
  showToast('Recipe deleted');
  await loadRecipes();
}

// ---- Recipe Modal ----
function openRecipeModal(id = null) {
  editingRecipeId = id;
  const recipe = id ? allRecipes.find(r => r.id === id) : null;
  document.getElementById('modalTitle').textContent = id ? '✏️ Edit Recipe' : '➕ Add New Recipe';
  document.getElementById('modalBody').innerHTML = buildRecipeForm(recipe);
  document.getElementById('recipeModal').style.display = 'flex';
}

function buildRecipeForm(r) {
  const ings = r ? r.ingredients : [{ name:'', amount:'', unit:'ml' }];
  return `
    <div class="form-group"><label class="form-label">Drink Name</label>
      <input id="rf-name" class="form-input" value="${r ? r.name : ''}"/></div>
    <div class="form-group"><label class="form-label">Description</label>
      <input id="rf-desc" class="form-input" value="${r ? r.description : ''}"/></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Category</label>
        <select id="rf-cat" class="form-select">
          <option value="cocktail" ${r && r.category==='cocktail' ? 'selected':''}>🥂 Cocktail</option>
          <option value="mocktail" ${r && r.category==='mocktail' ? 'selected':''}>🧃 Mocktail</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Price ($)</label>
        <input id="rf-price" class="form-input" type="number" step="0.01" value="${r ? r.price : ''}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Alcohol %</label>
        <input id="rf-alc" class="form-input" type="number" value="${r ? r.alcoholLevel : 0}"/></div>
      <div class="form-group"><label class="form-label">Prep Time (min)</label>
        <input id="rf-prep" class="form-input" type="number" value="${r ? r.prepTime : 3}"/></div>
    </div>
    <div class="form-group"><label class="form-label">Image URL</label>
      <input id="rf-img" class="form-input" placeholder="/images/mojito.png" value="${r ? (r.image||'') : ''}"/></div>
    <div class="form-group"><label class="form-label">Tags (comma separated)</label>
      <input id="rf-tags" class="form-input" placeholder="refreshing, citrus, popular" value="${r ? (r.tags||[]).join(', ') : ''}"/></div>
    <div class="form-group">
      <label class="form-label">Ingredients</label>
      <div class="ingredients-list" id="ingsList">
        ${ings.map((ing, i) => buildIngRow(ing, i)).join('')}
      </div>
      <button class="add-ing-btn" onclick="addIngredient()">+ Add Ingredient</button>
    </div>
    <label class="form-check-label form-group">
      <input type="checkbox" class="form-check" id="rf-avail" ${r ? (r.available ? 'checked':'') : 'checked'}/> Available on menu
    </label>
    <button class="modal-submit" onclick="submitRecipe()">
      ${editingRecipeId ? '💾 Save Changes' : '✨ Add Recipe'}
    </button>`;
}

function buildIngRow(ing, i) {
  return `<div class="ingredient-row" id="ing-${i}">
    <input class="form-input ing-name" placeholder="Ingredient" value="${ing.name||''}"/>
    <input class="form-input ing-amount" placeholder="Amt" type="number" value="${ing.amount||''}"/>
    <select class="form-select ing-unit">
      ${['ml','cl','oz','dash','drop','tsp'].map(u => `<option ${ing.unit===u?'selected':''}>${u}</option>`).join('')}
    </select>
    <button class="remove-ing-btn" onclick="removeIng(this)">✕</button>
  </div>`;
}

let ingCount = 1;
function addIngredient() {
  const list = document.getElementById('ingsList');
  const div = document.createElement('div');
  div.innerHTML = buildIngRow({}, ingCount++);
  list.appendChild(div.firstElementChild);
}

function removeIng(btn) {
  btn.closest('.ingredient-row').remove();
}

async function submitRecipe() {
  const name = document.getElementById('rf-name').value.trim();
  if (!name) { showToast('⚠️ Please enter a name'); return; }

  const ingredients = Array.from(document.querySelectorAll('.ingredient-row')).map(row => ({
    name: row.querySelector('.ing-name').value.trim(),
    amount: parseFloat(row.querySelector('.ing-amount').value) || 0,
    unit: row.querySelector('.ing-unit').value
  })).filter(i => i.name);

  const payload = {
    name,
    description: document.getElementById('rf-desc').value,
    category: document.getElementById('rf-cat').value,
    price: parseFloat(document.getElementById('rf-price').value) || 0,
    alcoholLevel: parseInt(document.getElementById('rf-alc').value) || 0,
    prepTime: parseInt(document.getElementById('rf-prep').value) || 3,
    image: document.getElementById('rf-img').value.trim() || '/images/cocktails_bg.png',
    tags: document.getElementById('rf-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    ingredients,
    available: document.getElementById('rf-avail').checked
  };

  try {
    if (editingRecipeId) {
      await fetch(`/api/admin/recipes/${editingRecipeId}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
      showToast('✅ Recipe updated!');
    } else {
      await fetch('/api/admin/recipes', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
      showToast('✨ Recipe added!');
    }
    closeRecipeModal();
    await loadRecipes();
  } catch(e) { showToast('⚠️ Save failed'); }
}

function closeRecipeModal() {
  document.getElementById('recipeModal').style.display = 'none';
  editingRecipeId = null;
}

function closeModalOutside(e) {
  if (e.target === document.getElementById('recipeModal')) closeRecipeModal();
}

// ============================================================
//  ANALYTICS
// ============================================================
function loadAnalytics() {
  const orders = allOrders.length ? allOrders : [];
  const totalRevenue = orders.reduce((s, o) => s + parseFloat(o.totalAmount || 0), 0);
  const totalDrinks = orders.reduce((s, o) => s + (o.items || []).reduce((ss, i) => ss + i.qty, 0), 0);
  const completed = orders.filter(o => o.status === 'collected').length;
  const active = orders.filter(o => ['queued','mixing'].includes(o.status)).length;

  document.getElementById('analyticsGrid').innerHTML = `
    <div class="stat-card"><div class="stat-card-icon">💰</div>
      <div class="stat-card-value">$${totalRevenue.toFixed(2)}</div>
      <div class="stat-card-label">Total Revenue</div></div>
    <div class="stat-card"><div class="stat-card-icon">📋</div>
      <div class="stat-card-value">${orders.length}</div>
      <div class="stat-card-label">Total Orders</div></div>
    <div class="stat-card"><div class="stat-card-icon">🍹</div>
      <div class="stat-card-value">${totalDrinks}</div>
      <div class="stat-card-label">Drinks Mixed</div></div>
    <div class="stat-card"><div class="stat-card-icon">✅</div>
      <div class="stat-card-value">${completed}</div>
      <div class="stat-card-label">Completed</div></div>
    <div class="stat-card"><div class="stat-card-icon">⏳</div>
      <div class="stat-card-value">${active}</div>
      <div class="stat-card-label">Active Orders</div></div>
    <div class="stat-card"><div class="stat-card-icon">🍸</div>
      <div class="stat-card-value">${allRecipes.length}</div>
      <div class="stat-card-label">Recipes on Menu</div></div>`;
}

// ---- Toast ----
function showToast(msg) {
  const t = document.getElementById('adminToast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

async function triggerCleanSystem() {
  if(!confirm('Start cleaning cycle? Ensure water is hooked up to the clean pump!')) return;
  try {
    const res = await fetch('/api/machine/clean', { 
      method: 'POST', 
      headers: authHeaders() 
    });
    if (!res.ok) throw new Error(await res.text());
    showToast('Cleaning cycle started!');
  } catch(e) {
    showToast('Error: ' + e.message);
  }
}
window.triggerCleanSystem = triggerCleanSystem;


async function toggleAutoClean(enabled) { try { await fetch('/api/machine/autoclean', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ enabled }) }); showToast(enabled ? 'Auto-Clean Enabled' : 'Auto-Clean Disabled'); } catch(e){} }
async function loadAutoCleanStatus() { try { const res = await fetch('/api/machine/autoclean', { headers: authHeaders() }); const data = await res.json(); document.getElementById('autoCleanToggle').checked = data.enabled; } catch(e){} }

