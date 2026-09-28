// ============================================================
//  MixMaster Pro — Menu Page Logic  (v2 — with Custom Builder)
// ============================================================

// ── Pump / ingredient config (mirrors hardware_config.json) ──
const PUMPS = [
  { slot: 0, name: 'White Rum',       color: '#ff6b6b', emoji: '🥃', isAlcohol: true  },
  { slot: 1, name: 'Lemon Juice',     color: '#ffd93d', emoji: '🍋', isAlcohol: false },
  { slot: 2, name: 'Mint Syrup',      color: '#6bcb77', emoji: '🌿', isAlcohol: false },
  { slot: 3, name: 'Blue Curaçao',    color: '#4d96ff', emoji: '💙', isAlcohol: false },
  { slot: 4, name: 'Orange Juice',    color: '#ff922b', emoji: '🍊', isAlcohol: false },
  { slot: 5, name: 'Grenadine Syrup', color: '#cc5de8', emoji: '🌺', isAlcohol: false }
];
const CUP_MAX_ML = 250;
const CUSTOM_PRICE_BASE = 8.99;
const CUSTOM_PRICE_PER_ML = 0.03;

let allDrinks = [];
let cart = JSON.parse(localStorage.getItem('mm_cart') || '[]');
let currentTab = 'all';
let customMls = [0, 0, 0, 0, 0, 0];

// ── Particle Background ──────────────────────────────────────
(function initParticles() {
  const canvas = document.getElementById('particles');
  const ctx = canvas.getContext('2d');
  let particles = [];
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);
  for (let i = 0; i < 60; i++) {
    particles.push({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      r: Math.random() * 2 + 0.5,
      dx: (Math.random() - 0.5) * 0.3, dy: (Math.random() - 0.5) * 0.3,
      color: ['#f59e0b','#06b6d4','#cc5de8','#6bcb77'][Math.floor(Math.random()*4)],
      alpha: Math.random() * 0.4 + 0.1
    });
  }
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color; ctx.globalAlpha = p.alpha; ctx.fill();
      p.x += p.dx; p.y += p.dy;
      if (p.x < 0 || p.x > canvas.width)  p.dx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.dy *= -1;
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  draw();
})();

// ── Load Drinks ──────────────────────────────────────────────
async function loadDrinks() {
  try {
    const res = await fetch('/api/drinks');
    allDrinks = await res.json();
    document.getElementById('loadingState').style.display = 'none';
    renderDrinks(allDrinks);
  } catch (e) {
    document.getElementById('loadingState').innerHTML =
      '<p style="color:var(--text-secondary)">⚠️ Could not load menu. Please check server.</p>';
  }
}

// ── Render Drinks Grid ───────────────────────────────────────
function renderDrinks(drinks) {
  const grid   = document.getElementById('drinksGrid');
  const empty  = document.getElementById('emptyState');
  const custom = document.getElementById('customBuilderSection');

  // Toggle custom builder visibility
  custom.style.display = currentTab === 'custom' ? 'block' : 'none';
  grid.style.display   = currentTab === 'custom' ? 'none'  : '';

  if (currentTab === 'custom') { empty.style.display = 'none'; return; }

  if (!drinks.length) {
    grid.innerHTML = ''; empty.style.display = 'block'; return;
  }
  empty.style.display = 'none';

  grid.innerHTML = drinks.map((d, i) => {
    const inCart  = cart.find(c => c.id === d.id);
    const alcoholPct = d.alcoholLevel;
    const delay   = (i % 6) * 70;
    const ingBadges = (d.ingredients || []).map(ing => {
      const p = PUMPS.find(p => p.name.toLowerCase() === ing.name.toLowerCase());
      const col = p ? p.color : '#4a6080';
      const em  = p ? p.emoji : '•';
      return `<span class="ing-badge" style="border-color:${col};color:${col}">${em} ${ing.name} <strong>${ing.amount}ml</strong></span>`;
    }).join('');

    return `
    <div class="drink-card" style="animation-delay:${delay}ms" id="card-${d.id}">
      <div class="drink-card-img-wrap">
        <img src="${d.image}" alt="${d.name}" class="drink-card-img"
             onerror="this.src='/images/cocktails_bg.png'"/>
        <div class="drink-badge ${d.category}">${d.category === 'cocktail' ? '🥂 Cocktail' : '🧃 Mocktail'}</div>
        ${alcoholPct === 0 ? '<div class="af-badge">Alcohol Free</div>' : ''}
      </div>
      <div class="drink-card-body">
        <h3 class="drink-name">${d.name}</h3>
        <p class="drink-desc">${d.description}</p>
        <div class="ing-badges">${ingBadges}</div>
        <div class="drink-footer">
          <div class="drink-meta">
            <span class="drink-price">$${parseFloat(d.price).toFixed(2)}</span>
            <span class="drink-time">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
              ~${d.prepTime} min · ${d.totalMl || '?'}ml
            </span>
          </div>
          <button class="add-btn ${inCart ? 'added' : ''}" id="btn-${d.id}"
                  onclick="addToCart('${d.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              ${inCart ? '<path d="M20 6L9 17l-5-5"/>' : '<path d="M12 5v14M5 12h14"/>'}
            </svg>
            <span>${inCart ? 'In Cart' : 'Add to Cart'}</span>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Filter / Tabs ────────────────────────────────────────────
function filterDrinks(cat, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentTab = cat;
  if (cat === 'custom') {
    renderDrinks([]);
    renderCustomBuilder();
    return;
  }
  const filtered = cat === 'all' ? allDrinks : allDrinks.filter(d => d.category === cat);
  renderDrinks(filtered);
}

// ── Custom Builder ───────────────────────────────────────────
function renderCustomBuilder() {
  // Already rendered via HTML — just update sliders
  updateCustomTotals();
}

function updateCustomTotals() {
  const total = customMls.reduce((s, v) => s + v, 0);
  const totalEl = document.getElementById('customTotalMl');
  const fillEl  = document.getElementById('customCupFill');
  const pct     = Math.min(total / CUP_MAX_ML, 1);
  const price   = (CUSTOM_PRICE_BASE + total * CUSTOM_PRICE_PER_ML).toFixed(2);

  totalEl.textContent = `${total}ml / ${CUP_MAX_ML}ml`;
  totalEl.style.color = total > CUP_MAX_ML ? '#ef4444' : total > CUP_MAX_ML * 0.9 ? '#fbbf24' : '#10b981';
  fillEl.style.height = `${pct * 100}%`;
  fillEl.style.background = buildCupGradient();

  document.getElementById('customPriceEl').textContent = `$${price}`;
  document.getElementById('addCustomBtn').disabled = total === 0 || total > CUP_MAX_ML;

  // Update per-slider remaining
  PUMPS.forEach((pump, i) => {
    const remaining = CUP_MAX_ML - total + customMls[i];
    const slider = document.getElementById(`slider_${i}`);
    if (slider) slider.max = Math.max(customMls[i], remaining);
    const valEl = document.getElementById(`sliderVal_${i}`);
    if (valEl) valEl.textContent = customMls[i] + 'ml';
  });
}

function buildCupGradient() {
  const active = PUMPS.filter((_, i) => customMls[i] > 0);
  if (!active.length) return 'rgba(100,160,255,0.3)';
  if (active.length === 1) return active[0].color + 'aa';
  const stops = active.map((p, i) => `${p.color}aa ${Math.round(i/(active.length-1)*100)}%`).join(', ');
  return `linear-gradient(to top, ${stops})`;
}

function onSliderChange(idx, value) {
  customMls[idx] = parseInt(value);
  updateCustomTotals();
}

function resetCustom() {
  customMls = [0, 0, 0, 0, 0, 0];
  PUMPS.forEach((_, i) => {
    const sl = document.getElementById(`slider_${i}`);
    if (sl) sl.value = 0;
  });
  updateCustomTotals();
}

function addCustomToCart() {
  const total = customMls.reduce((s, v) => s + v, 0);
  if (total === 0 || total > CUP_MAX_ML) return;

  const nameInput = document.getElementById('customDrinkName');
  const drinkName = (nameInput && nameInput.value.trim()) || 'My Custom Mix';
  const price     = parseFloat((CUSTOM_PRICE_BASE + total * CUSTOM_PRICE_PER_ML).toFixed(2));

  const components = PUMPS
    .map((p, i) => ({ pump: i, liquid: p.name, ml: customMls[i] }))
    .filter(c => c.ml > 0);

  const customItem = {
    id: 'custom_' + Date.now(),
    name: drinkName,
    isCustom: true,
    components,
    price,
    qty: 1,
    totalMl: total,
    image: '/images/cocktails_bg.png',
    category: customMls[0] > 0 ? 'cocktail' : 'mocktail'
  };

  cart.push(customItem);
  saveCart();
  updateCartUI();
  showToast(`🍹 "${drinkName}" added to cart!`);
  resetCustom();
  if (nameInput) nameInput.value = '';
}

// ── Cart Logic ───────────────────────────────────────────────
function addToCart(id) {
  const drink = allDrinks.find(d => d.id === id);
  if (!drink) return;
  const existing = cart.find(c => c.id === id);
  if (existing) { existing.qty += 1; }
  else { cart.push({ ...drink, qty: 1 }); }
  saveCart(); updateCartUI();
  showToast(`🍹 ${drink.name} added!`);
  const btn = document.getElementById(`btn-${id}`);
  if (btn) {
    btn.classList.add('added');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg><span>In Cart</span>`;
  }
}

function removeFromCart(id) {
  const idx = cart.findIndex(c => c.id === id);
  if (idx === -1) return;
  if (cart[idx].qty > 1) { cart[idx].qty -= 1; }
  else {
    cart.splice(idx, 1);
    const btn = document.getElementById(`btn-${id}`);
    if (btn) {
      btn.classList.remove('added');
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg><span>Add to Cart</span>`;
    }
  }
  saveCart(); updateCartUI();
}

function saveCart() { localStorage.setItem('mm_cart', JSON.stringify(cart)); }

function updateCartUI() {
  const total = cart.reduce((s, c) => s + c.qty, 0);
  const countEl = document.getElementById('cartCount');
  countEl.textContent = total;
  countEl.classList.toggle('visible', total > 0);

  const itemsEl  = document.getElementById('cartItems');
  const footerEl = document.getElementById('cartFooter');

  if (!cart.length) {
    itemsEl.innerHTML = `<div class="cart-empty"><div class="cart-empty-icon">🛒</div><p>Your cart is empty</p><span>Add some drinks to get started!</span></div>`;
    footerEl.style.display = 'none';
    return;
  }
  footerEl.style.display = 'block';
  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const totalAmt = subtotal + 0.99;
  document.getElementById('cartSubtotal').textContent = `$${subtotal.toFixed(2)}`;
  document.getElementById('cartTotal').textContent    = `$${totalAmt.toFixed(2)}`;

  itemsEl.innerHTML = cart.map(item => {
    const customTag = item.isCustom ? `<div class="cart-custom-tag">✨ Custom Mix · ${item.totalMl}ml</div>` : '';
    return `
    <div class="cart-item">
      <img src="${item.image}" alt="${item.name}" class="cart-item-img"
           onerror="this.src='/images/cocktails_bg.png'"/>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        ${customTag}
        <div class="cart-item-price">$${(item.price * item.qty).toFixed(2)}</div>
      </div>
      <div class="cart-item-controls">
        <button class="qty-btn" onclick="removeFromCart('${item.id}')">−</button>
        <span class="qty-display">${item.qty}</span>
        <button class="qty-btn" onclick="addToCart('${item.id}')">+</button>
      </div>
    </div>`;
  }).join('');
}

// ── Helpers ──────────────────────────────────────────────────
function toggleCart() {
  document.getElementById('cartSidebar').classList.toggle('open');
  document.getElementById('cartOverlay').classList.toggle('open');
}

function scrollToMenu() {
  document.getElementById('menu').scrollIntoView({ behavior: 'smooth' });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function proceedToCheckout() {
  if (!cart.length) return;
  sessionStorage.setItem('mm_checkout', JSON.stringify(cart));
  window.location.href = '/payment.html';
}

// ── Init ─────────────────────────────────────────────────────
updateCartUI();
loadDrinks();
