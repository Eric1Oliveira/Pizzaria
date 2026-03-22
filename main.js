// ============================================================
//  CASA JOSÉ SILVA — Main Application Logic
// ============================================================

const SUPABASE_URL = 'https://uufzqceljdkrnpgjotxw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1ZnpxY2VsamRrcm5wZ2pvdHh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MzIzMjUsImV4cCI6MjA4OTAwODMyNX0.lDBwSOYlF3SlMKblt2WsHo7rdVcZ-wXgjJolD41cNfk';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Timeout wrapper for Supabase queries
function withTimeout(promise, ms = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Tempo limite excedido. Verifique sua conexão ou se o projeto Supabase está ativo.')), ms))
  ]);
}

const INFINITEPAY_HANDLE = 'eric-eduardo-p78';
const INFINITEPAY_PROXY_URL = `${SUPABASE_URL}/functions/v1/create-infinitepay-link`;

// ---------- State ----------
let products = [];
let cart = JSON.parse(localStorage.getItem('cjs_cart') || '[]');
let currentUser = null;
let isAdmin = false;
let activeCategory = 'todos';
let searchQuery = '';
let deliveryType = 'delivery';
let paymentType = 'online';
let paymentOnDeliveryMethod = 'dinheiro';
const DELIVERY_FEE = 5;
let activePromotion = null;
let firstOrderCache = { userId: null, isFirstOrder: false };
let appliedCoupon = null;
let runtimeConfig = {};
const PROMO_SESSION_KEY = 'cjs_promo_session_id';
const promoSessionId = (() => {
  const existing = localStorage.getItem(PROMO_SESSION_KEY);
  if (existing) return existing;
  const generated = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(PROMO_SESSION_KEY, generated);
  return generated;
})();

// ---------- DOM cache ----------
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// Pages
const splashScreen = $('splashScreen');
const menuPage = $('menuPage');
const ordersPage = $('ordersPage');

const DEFAULT_SCHEDULE = {
  sales_open_days: '0,2,3,4,5,6',
  lunch_open_days: '0,2,3,4,5,6',
  lunch_start: '11:00',
  lunch_end: '15:00',
  lunch_categories: 'menu',
  dinner_open_days: '0,2,3,4,5,6',
  dinner_start: '18:00',
  dinner_end: '22:00',
  dinner_categories: 'pizzas-tradicionais,pizzas-especiais,pizzas-doces',
  closed_between_start: '15:00',
  closed_between_end: '18:00',
  schedule_message_closed: 'Fechado no momento'
};

function cfg(key) {
  return runtimeConfig[key] ?? DEFAULT_SCHEDULE[key] ?? '';
}

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

async function loadRuntimeConfig() {
  try {
    const { data, error } = await withTimeout(
      supabaseClient
        .from('site_config')
        .select('key,value')
        .in('key', [
          'sales_open_days',
          'lunch_open_days',
          'lunch_start',
          'lunch_end',
          'lunch_categories',
          'dinner_open_days',
          'dinner_start',
          'dinner_end',
          'dinner_categories',
          'closed_between_start',
          'closed_between_end',
          'schedule_message_closed'
        ]),
      12000
    );
    if (error) throw error;
    runtimeConfig = {};
    (data || []).forEach(row => {
      runtimeConfig[row.key] = row.value;
    });
  } catch (err) {
    console.error('Erro ao carregar configuração de horários:', err.message || err);
    runtimeConfig = {};
  }
}

function isBetweenMinutes(currentMinutes, startMinutes, endMinutes) {
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function getScheduleContext() {
  const now = new Date();
  const day = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const openDays = parseCsvList(cfg('sales_open_days')).map(v => Number(v)).filter(v => Number.isInteger(v));

  const lunchStart = parseTimeToMinutes(cfg('lunch_start'), '11:00');
  const lunchEnd = parseTimeToMinutes(cfg('lunch_end'), '15:00');
  const dinnerStart = parseTimeToMinutes(cfg('dinner_start'), '18:00');
  const dinnerEnd = parseTimeToMinutes(cfg('dinner_end'), '22:00');
  const breakStart = parseTimeToMinutes(cfg('closed_between_start'), '15:00');
  const breakEnd = parseTimeToMinutes(cfg('closed_between_end'), '18:00');

  const lunchCategories = new Set(parseCsvList(cfg('lunch_categories')));
  const dinnerCategories = new Set(parseCsvList(cfg('dinner_categories')));
  const fallbackOpenDays = parseCsvList(cfg('sales_open_days')).map(v => Number(v)).filter(v => Number.isInteger(v));
  const lunchDaysRaw = parseCsvList(cfg('lunch_open_days')).map(v => Number(v)).filter(v => Number.isInteger(v));
  const dinnerDaysRaw = parseCsvList(cfg('dinner_open_days')).map(v => Number(v)).filter(v => Number.isInteger(v));
  const lunchDays = lunchDaysRaw.length ? lunchDaysRaw : fallbackOpenDays;
  const dinnerDays = dinnerDaysRaw.length ? dinnerDaysRaw : fallbackOpenDays;

  const dayOpen = openDays.includes(day);
  const inBreak = isBetweenMinutes(currentMinutes, breakStart, breakEnd);
  const inLunch = lunchDays.includes(day) && isBetweenMinutes(currentMinutes, lunchStart, lunchEnd);
  const inDinner = dinnerDays.includes(day) && isBetweenMinutes(currentMinutes, dinnerStart, dinnerEnd);

  let activePeriod = null;
  if (dayOpen && !inBreak) {
    if (inLunch) activePeriod = { key: 'lunch', title: 'Almoço', categories: lunchCategories, start: lunchStart, end: lunchEnd };
    if (inDinner) activePeriod = { key: 'dinner', title: 'Jantar', categories: dinnerCategories, start: dinnerStart, end: dinnerEnd };
  }

  return {
    now,
    day,
    currentMinutes,
    dayOpen,
    inBreak,
    activePeriod,
    lunch: { start: lunchStart, end: lunchEnd, categories: lunchCategories, days: lunchDays },
    dinner: { start: dinnerStart, end: dinnerEnd, categories: dinnerCategories, days: dinnerDays }
  };
}

function getProductAvailability(product) {
  if (!product?.disponivel) {
    return { canBuy: false, reason: 'Indisponível no cardápio' };
  }

  const schedule = getScheduleContext();
  const category = String(product.categoria || '').toLowerCase();
  const inLunchCatalog = schedule.lunch.categories.has(category);
  const inDinnerCatalog = schedule.dinner.categories.has(category);

  if (!schedule.dayOpen) {
    return { canBuy: false, reason: 'Fechado hoje' };
  }

  if (schedule.inBreak) {
    return { canBuy: false, reason: 'Fechado entre 15h e 18h' };
  }

  if (!schedule.activePeriod) {
    if (inLunchCatalog) return { canBuy: false, reason: `Disponível a partir de ${cfg('lunch_start')}` };
    if (inDinnerCatalog) return { canBuy: false, reason: `Disponível a partir de ${cfg('dinner_start')}` };
    return { canBuy: false, reason: cfg('schedule_message_closed') || 'Fora do horário de atendimento' };
  }

  if (!schedule.activePeriod.categories.has(category)) {
    if (inDinnerCatalog) return { canBuy: false, reason: `Disponível no jantar (${cfg('dinner_start')} às ${cfg('dinner_end')})` };
    if (inLunchCatalog) return { canBuy: false, reason: `Disponível no almoço (${cfg('lunch_start')} às ${cfg('lunch_end')})` };
    return { canBuy: false, reason: 'Indisponível neste período' };
  }

  return { canBuy: true, reason: '' };
}

// ============================================================
//  NAVIGATION
// ============================================================
function showPage(page) {
  [splashScreen, menuPage, ordersPage].forEach(p => p.classList.add('hidden'));
  page.classList.remove('hidden');
  window.scrollTo(0, 0);
}

function isMenuPageVisible() {
  return !menuPage.classList.contains('hidden');
}

$('btnFazerPedido').addEventListener('click', async () => {
  if (!currentUser) {
    openModal('loginModal');
    showToast('Cadastre-se ou faça login para acessar o cardápio', 'info');
    return;
  }
  showPage(menuPage);
  await loadProducts();
  await loadPromotionPopup();
});
$('btnMeusPedidos').addEventListener('click', () => {
  if (!currentUser) { openModal('loginModal'); return; }
  showPage(ordersPage); loadOrders();
});
$('btnMinhaConta').addEventListener('click', () => {
  if (currentUser) { handleLogout(); } else { openModal('loginModal'); }
});
$('btnBackToHome').addEventListener('click', () => showPage(splashScreen));
$('btnBackToHome2').addEventListener('click', () => showPage(splashScreen));
$('btnAdminPanel').addEventListener('click', () => {
  if (!isAdmin) return;
  window.location.href = 'admin.html';
});

// ============================================================
//  MODALS
// ============================================================
function openModal(id) { $(id).classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { $(id).classList.add('hidden'); document.body.style.overflow = ''; }

function openPromoPopup() {
  if (!isMenuPageVisible()) return;
  $('promoPopup').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (activePromotion?.id) {
    trackPromotionEvent(activePromotion.id, 'view').catch(() => {});
  }
}

function closePromoPopup(trackClose = true) {
  $('promoPopup').classList.add('hidden');
  document.body.style.overflow = '';
  if (!activePromotion || !trackClose) return;

  const now = Date.now();
  localStorage.setItem(`cjs_promo_closed_${activePromotion.id}`, String(now));
  if (activePromotion.promo_type === 'first_login' && currentUser?.id) {
    localStorage.setItem(`cjs_first_login_seen_${currentUser.id}`, '1');
  }
}

// Close buttons
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
// Close on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
});

$('btnHoursFAB').addEventListener('click', () => {
  highlightToday(); openModal('hoursModal');
});
$('btnLocation').addEventListener('click', () => openModal('locationModal'));
$('btnContactChip').addEventListener('click', () => openModal('contactModal'));

$('promoPopupClose').addEventListener('click', () => closePromoPopup(true));
$('promoPopupBackdrop').addEventListener('click', () => closePromoPopup(true));
$('promoPopupDismiss').addEventListener('click', () => closePromoPopup(true));

$('promoPopupAction').addEventListener('click', async () => {
  if (!activePromotion) return;
  if (activePromotion.id) {
    sessionStorage.setItem('cjs_last_popup_promo_id', String(activePromotion.id));
    await trackPromotionEvent(activePromotion.id, 'click', {
      product_id: activePromotion.product_id || null,
      coupon_code: activePromotion.coupon_code || null
    }).catch(() => {});
  }

  if (activePromotion.coupon_code) {
    try {
      await navigator.clipboard.writeText(activePromotion.coupon_code);
      showToast(`Cupom ${activePromotion.coupon_code} copiado!`, 'success');
    } catch (_) {
      showToast(`Use o cupom: ${activePromotion.coupon_code}`, 'info');
    }
  }

  closePromoPopup(false);
  showPage(menuPage);
  if (!products.length) {
    await loadProducts();
  }
  const selectedIds = Array.isArray(activePromotion.product_ids)
    ? activePromotion.product_ids.map(v => Number(v)).filter(v => Number.isFinite(v))
    : [];

  if (selectedIds.length > 1) {
    selectedIds.forEach(id => addToCart(id, 1));
    openCart();
    showToast('Kit promocional adicionado ao carrinho!', 'success');
    return;
  }

  const singleId = selectedIds[0] || Number(activePromotion.product_id || 0);
  if (singleId) {
    openProductDetail(singleId);
  }
});

function highlightToday() {
  const day = new Date().getDay();
  document.querySelectorAll('.hours-row').forEach(row => {
    row.classList.toggle('today', parseInt(row.dataset.day) === day);
  });
}

// ============================================================
//  STATUS BAR (Open/Closed)
// ============================================================
function updateStatus() {
  const shop = getScheduleContext();
  const isOpen = Boolean(shop.dayOpen && shop.activePeriod);
  const dot = document.querySelector('.status-dot');
  const text = document.querySelector('.status-text');
  if (isOpen) {
    dot.className = 'status-dot open';
    text.textContent = `Aberto agora · ${shop.activePeriod.title}`;
  } else {
    dot.className = 'status-dot closed';
    text.textContent = cfg('schedule_message_closed') || 'Fechado agora';
  }
}
updateStatus();
setInterval(updateStatus, 60000);

// ============================================================
//  PRODUCTS
// ============================================================
async function loadProducts() {
  const grid = $('productsGrid');
  grid.innerHTML = '<div class="loader" id="productsLoader"><div class="loader__spinner"></div><p>Carregando cardápio...</p></div>';

  try {
    console.log('[Produtos] Carregando...');
    const { data, error } = await withTimeout(
      supabaseClient
        .from('produtos')
        .select('*')
        .order('ordem', { ascending: true })
        .order('nome', { ascending: true })
    );
    if (error) throw error;
    console.log('[Produtos] Carregados:', data?.length);
    products = data || [];
    buildCategoryTabs();
    renderProducts();
  } catch (err) {
    console.error('Erro ao carregar produtos:', err);
    grid.innerHTML = `<div class="loader"><p style="color:#D32F2F;">Erro ao carregar cardápio.</p><p style="font-size:.8rem;color:#999;margin-top:8px;">${err.message || 'Erro desconhecido'}</p><button class="btn btn--primary" style="margin-top:12px;" onclick="loadProducts()">Tentar novamente</button></div>`;
  }
}

// ---------- Category Tabs ----------
function buildCategoryTabs() {
  const scroll = $('catNavScroll');
  const categories = [...new Set(products.map(p => p.categoria))];
  scroll.innerHTML = '<button class="cat-tab active" data-category="todos">Todos</button>';
  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-tab';
    btn.dataset.category = cat;
    btn.textContent = formatCategory(cat);
    scroll.appendChild(btn);
  });
  scroll.querySelectorAll('.cat-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      scroll.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = btn.dataset.category;
      renderProducts();
    });
  });
}

function formatCategory(cat) {
  return cat.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// ---------- Render Products ----------
function renderProducts() {
  const grid = $('productsGrid');
  let filtered = products;

  if (activeCategory !== 'todos') {
    filtered = filtered.filter(p => p.categoria === activeCategory);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(p =>
      p.nome.toLowerCase().includes(q) ||
      (p.descricao || '').toLowerCase().includes(q) ||
      (p.categoria || '').toLowerCase().includes(q)
    );
  }

  if (!filtered.length) {
    grid.innerHTML = '<div class="loader"><p>Nenhum item encontrado.</p></div>';
    return;
  }

  const groups = {};
  filtered.forEach(p => {
    if (!groups[p.categoria]) groups[p.categoria] = [];
    groups[p.categoria].push(p);
  });

  let html = '<div class="products__grid">';
  for (const [cat, items] of Object.entries(groups)) {
    html += `<div class="category-header"><span class="category-header__title">${formatCategory(cat)}</span><span class="category-header__count">${items.length} itens</span></div>`;
    items.forEach(p => {
      const inCart = cart.find(c => c.id === p.id);
      const availability = getProductAvailability(p);
      html += `
      <div class="product-card" data-id="${p.id}">
        <div class="product-card__img-wrap">
          ${p.imagem_url ? `<img class="product-card__img" src="${escapeHtml(p.imagem_url)}" alt="${escapeHtml(p.nome)}" loading="lazy">` : ''}
          <span class="product-card__category">${escapeHtml(formatCategory(p.categoria))}</span>
          ${!availability.canBuy ? `<div class="product-card__unavailable">${escapeHtml(availability.reason || 'Indisponível')}</div>` : ''}
        </div>
        <div class="product-card__body">
          <div class="product-card__name">${escapeHtml(p.nome)}</div>
          <div class="product-card__desc">${escapeHtml(p.descricao || '')}</div>
          <div class="product-card__footer">
            <span class="product-card__price">${formatMoney(p.preco)}</span>
            <button class="product-card__add" data-id="${p.id}" ${!availability.canBuy ? 'disabled' : ''}>
              ${inCart ? inCart.qty : '<i class="fas fa-plus"></i>'}
            </button>
          </div>
        </div>
      </div>`;
    });
  }

  html += '</div>';
  grid.innerHTML = html;

  grid.querySelectorAll('.product-card__add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addToCart(parseInt(btn.dataset.id));
    });
  });

  grid.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', () => openProductDetail(parseInt(card.dataset.id)));
  });
}

// ---------- Product Detail ----------
function openProductDetail(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  const availability = getProductAvailability(p);
  const inCart = cart.find(c => c.id === id);
  const qty = inCart ? inCart.qty : 1;
  $('productModalTitle').textContent = p.nome;
  $('productModalBody').innerHTML = `
    <div class="product-detail">
      ${p.imagem_url ? `<img class="product-detail__img" src="${escapeHtml(p.imagem_url)}" alt="${escapeHtml(p.nome)}">` : ''}
      <div class="product-detail__name">${escapeHtml(p.nome)}</div>
      <div class="product-detail__desc">${escapeHtml(p.descricao || 'Sem descrição disponível.')}</div>
      <div class="product-detail__price">${formatMoney(p.preco)}</div>
      ${availability.canBuy ? `
      <div class="product-detail__actions">
        <div class="product-detail__qty">
          <button class="product-detail__qty-btn" id="detailMinus"><i class="fas fa-minus"></i></button>
          <span class="product-detail__qty-val" id="detailQty">${qty}</span>
          <button class="product-detail__qty-btn" id="detailPlus"><i class="fas fa-plus"></i></button>
        </div>
        <button class="btn btn--primary btn--lg" id="detailAdd" style="flex:1;">
          <i class="fas fa-cart-plus"></i> Adicionar ${formatMoney(p.preco * qty)}
        </button>
      </div>` : `<p style="color:var(--red);font-weight:600;">${escapeHtml(availability.reason || 'Produto indisponível')}</p>`}
    </div>
  `;
  if (availability.canBuy) {
    let q = qty;
    $('detailMinus').addEventListener('click', () => {
      if (q > 1) { q--; $('detailQty').textContent = q; $('detailAdd').innerHTML = `<i class="fas fa-cart-plus"></i> Adicionar ${formatMoney(p.preco * q)}`; }
    });
    $('detailPlus').addEventListener('click', () => {
      q++; $('detailQty').textContent = q; $('detailAdd').innerHTML = `<i class="fas fa-cart-plus"></i> Adicionar ${formatMoney(p.preco * q)}`;
    });
    $('detailAdd').addEventListener('click', () => {
      addToCart(id, q);
      closeModal('productModal');
    });
  }
  openModal('productModal');
}

// ============================================================
//  SEARCH
// ============================================================
$('btnSearch').addEventListener('click', () => {
  const bar = $('searchBar');
  bar.classList.toggle('hidden');
  if (!bar.classList.contains('hidden')) $('searchInput').focus();
});
$('btnCloseSearch').addEventListener('click', () => {
  $('searchBar').classList.add('hidden');
  $('searchInput').value = '';
  searchQuery = '';
  renderProducts();
});
$('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  renderProducts();
});

// ============================================================
//  CART
// ============================================================
function addToCart(id, qty = 1) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  const availability = getProductAvailability(p);
  if (!availability.canBuy) {
    showToast(availability.reason || 'Item indisponível agora', 'error');
    return;
  }
  const existing = cart.find(c => c.id === id);
  if (existing) { existing.qty = qty > 1 ? qty : existing.qty + 1; }
  else { cart.push({ id, nome: p.nome, preco: p.preco, imagem_url: p.imagem_url, qty }); }
  saveCart();
  showToast(`${p.nome} adicionado ao carrinho`, 'success');
  renderProducts(); // update button states
}

function removeFromCart(id) {
  cart = cart.filter(c => c.id !== id);
  saveCart();
}

function updateCartQty(id, delta) {
  const item = cart.find(c => c.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) { removeFromCart(id); }
  else { saveCart(); }
}

function saveCart() {
  localStorage.setItem('cjs_cart', JSON.stringify(cart));
  updateCartUI();
}

function normalizeCouponCode(code) {
  return (code || '').trim().toUpperCase();
}

function clearCouponState() {
  appliedCoupon = null;
  $('couponInput').value = '';
  $('btnApplyCoupon').classList.remove('hidden');
  $('btnRemoveCoupon').classList.add('hidden');
  $('cartCouponStatus').textContent = '';
  updateCartUI();
}

function getCartPricing() {
  const subtotal = cart.reduce((sum, item) => sum + (Number(item.preco || 0) * Number(item.qty || 0)), 0);
  const fee = deliveryType === 'delivery' ? DELIVERY_FEE : 0;
  let discount = 0;

  if (appliedCoupon) {
    if (appliedCoupon.discount_type === 'fixed') {
      discount = Math.min(subtotal, Number(appliedCoupon.discount_value || 0));
    } else {
      discount = subtotal * (Number(appliedCoupon.discount_value || 0) / 100);
      discount = Math.min(subtotal, discount);
    }
  }

  const total = Math.max(0, subtotal - discount + fee);
  return { subtotal, fee, discount, total };
}

async function validateCouponCode(rawCode, silent = false) {
  const code = normalizeCouponCode(rawCode);
  if (!code) return { valid: false, reason: 'Informe um cupom' };

  const subtotal = cart.reduce((sum, item) => sum + (Number(item.preco || 0) * Number(item.qty || 0)), 0);
  if (subtotal <= 0) return { valid: false, reason: 'Adicione itens no carrinho para usar cupom' };

  const { data: coupon, error } = await supabaseClient
    .from('discount_coupons')
    .select('*')
    .eq('code', code)
    .maybeSingle();
  if (error) return { valid: false, reason: 'Erro ao validar cupom' };
  if (!coupon) return { valid: false, reason: 'Cupom não encontrado' };
  if (!coupon.is_active) return { valid: false, reason: 'Cupom inativo' };

  const now = Date.now();
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) return { valid: false, reason: 'Cupom ainda não começou' };
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < now) return { valid: false, reason: 'Cupom expirado' };

  if (Number(coupon.min_order_value || 0) > subtotal) {
    return { valid: false, reason: `Pedido mínimo para esse cupom: ${formatMoney(coupon.min_order_value)}` };
  }

  if (Number(coupon.usage_limit || 0) > 0 && Number(coupon.usage_count || 0) >= Number(coupon.usage_limit || 0)) {
    return { valid: false, reason: 'Cupom já atingiu o limite de usos' };
  }

  if (currentUser?.id && Number(coupon.per_user_limit || 0) > 0) {
    const { count, error: usageErr } = await supabaseClient
      .from('pedidos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', currentUser.id)
      .eq('coupon_code', code);
    if (!usageErr && Number(count || 0) >= Number(coupon.per_user_limit || 0)) {
      return { valid: false, reason: 'Você já usou este cupom no limite permitido' };
    }
  }

  if (!silent) $('cartCouponStatus').textContent = `Cupom aplicado: ${code}`;
  return { valid: true, coupon };
}

async function applyCouponFromInput() {
  const code = normalizeCouponCode($('couponInput').value);
  const result = await validateCouponCode(code);
  if (!result.valid) {
    showToast(result.reason || 'Cupom inválido', 'error');
    $('cartCouponStatus').textContent = result.reason || 'Cupom inválido';
    return;
  }

  appliedCoupon = result.coupon;
  $('couponInput').value = appliedCoupon.code;
  $('btnApplyCoupon').classList.add('hidden');
  $('btnRemoveCoupon').classList.remove('hidden');
  $('cartCouponStatus').textContent = `Cupom ${appliedCoupon.code} ativo`;
  showToast('Cupom aplicado com sucesso!', 'success');
  updateCartUI();
}

function updateCartUI() {
  const count = cart.reduce((s, c) => s + c.qty, 0);
  const pricing = getCartPricing();
  const subtotal = pricing.subtotal;
  const fee = pricing.fee;
  const discount = pricing.discount;
  const total = pricing.total;

  // Badges
  $('cartBadgeMenu').textContent = count;
  $('fabCartBadge').textContent = count;
  $('fabCartTotal').textContent = formatMoney(total);
  const fab = $('fabCart');
  if (count > 0) fab.classList.remove('hidden'); else fab.classList.add('hidden');

  // Cart sidebar items
  const container = $('cartItems');
  if (!cart.length) {
    container.innerHTML = '<div class="cart__empty"><i class="fas fa-shopping-basket"></i><p>Seu carrinho está vazio</p></div>';
  } else {
    container.innerHTML = cart.map(item => `
      <div class="cart-item">
        ${item.imagem_url ? `<img class="cart-item__img" src="${escapeHtml(item.imagem_url)}" alt="">` : '<div class="cart-item__img" style="background:var(--cream);"></div>'}
        <div class="cart-item__info">
          <div class="cart-item__name">${escapeHtml(item.nome)}</div>
          <div class="cart-item__price">${formatMoney(item.preco)}</div>
          <div class="cart-item__controls">
            <button class="cart-item__qty-btn ${item.qty === 1 ? 'cart-item__qty-btn--remove' : ''}" data-id="${item.id}" data-action="minus">
              <i class="fas ${item.qty === 1 ? 'fa-trash-alt' : 'fa-minus'}"></i>
            </button>
            <span class="cart-item__qty">${item.qty}</span>
            <button class="cart-item__qty-btn" data-id="${item.id}" data-action="plus"><i class="fas fa-plus"></i></button>
          </div>
        </div>
        <span class="cart-item__total">${formatMoney(item.preco * item.qty)}</span>
      </div>
    `).join('');

    container.querySelectorAll('.cart-item__qty-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        updateCartQty(id, btn.dataset.action === 'plus' ? 1 : -1);
      });
    });
  }

  // Summary
  $('cartSubtotal').textContent = formatMoney(subtotal);
  $('cartDelivery').textContent = formatMoney(fee);
  $('cartDiscount').textContent = '- ' + formatMoney(discount);
  $('cartDiscountLine').classList.toggle('hidden', discount <= 0);
  $('cartTotal').textContent = formatMoney(total);

  const blockedItem = cart.find(item => {
    const product = products.find(p => p.id === item.id);
    if (!product) return false;
    return !getProductAvailability(product).canBuy;
  });

  if (blockedItem) {
    const product = products.find(p => p.id === blockedItem.id);
    const reason = getProductAvailability(product).reason || 'Indisponível agora';
    $('btnCheckout').disabled = true;
    $('cartCouponStatus').textContent = `Atenção: ${blockedItem.nome} está bloqueado (${reason})`;
  } else {
    $('btnCheckout').disabled = !cart.length;
  }
}

// Open/close cart
function openCart() {
  $('cartOverlay').classList.remove('hidden');
  $('cartSidebar').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  updateCartUI();
}
function closeCart() {
  $('cartOverlay').classList.add('hidden');
  $('cartSidebar').classList.add('hidden');
  document.body.style.overflow = '';
}
$('btnCartMenu').addEventListener('click', openCart);
$('btnCloseCart').addEventListener('click', closeCart);
$('cartOverlay').addEventListener('click', closeCart);
$('fabCart').addEventListener('click', openCart);
$('btnApplyCoupon')?.addEventListener('click', applyCouponFromInput);
$('btnRemoveCoupon')?.addEventListener('click', () => {
  clearCouponState();
  showToast('Cupom removido', 'info');
});

$('couponInput')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    applyCouponFromInput();
  }
});

// Delivery type toggle
document.querySelectorAll('.delivery-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.delivery-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    deliveryType = btn.dataset.tipo;
    $('addressSection').style.display = deliveryType === 'delivery' ? 'flex' : 'none';
    $('deliveryLine').style.display = deliveryType === 'delivery' ? 'flex' : 'none';
    updateCartUI();
  });
});

// Payment type toggle
document.querySelectorAll('.payment-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.payment-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    paymentType = btn.dataset.tipo;
    $('paymentDeliverySection').classList.toggle('hidden', paymentType !== 'na_entrega');
  });
});

// Payment on delivery method toggle
document.querySelectorAll('.payment-delivery-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.payment-delivery-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    paymentOnDeliveryMethod = btn.dataset.metodo;
  });
});

// ============================================================
//  CHECKOUT
// ============================================================
$('btnCheckout').addEventListener('click', handleCheckout);

function getFullAddress() {
  const rua = $('addrStreet').value.trim();
  const num = $('addrNumber').value.trim();
  const comp = $('addrComp').value.trim();
  const bairro = $('addrBairro').value.trim();
  if (!rua || !num || !bairro) return '';
  let addr = `${rua}, ${num}`;
  if (comp) addr += ` - ${comp}`;
  addr += ` - ${bairro}`;
  return addr;
}

function fillAddressFromUser() {
  if (!currentUser) return;
  const addr = currentUser.user_metadata?.address;
  if (!addr) return;
  if (addr.street) $('addrStreet').value = addr.street;
  if (addr.number) $('addrNumber').value = addr.number;
  if (addr.comp) $('addrComp').value = addr.comp;
  if (addr.bairro) $('addrBairro').value = addr.bairro;
}

async function saveAddressToUser() {
  if (!currentUser || !$('addrSave').checked) return;
  const addr = {
    street: $('addrStreet').value.trim(),
    number: $('addrNumber').value.trim(),
    comp: $('addrComp').value.trim(),
    bairro: $('addrBairro').value.trim()
  };
  if (!addr.street || !addr.number || !addr.bairro) return;
  try {
    await supabaseClient.auth.updateUser({ data: { address: addr } });
  } catch (e) { /* silently fail */ }
}

async function handleCheckout() {
  if (!cart.length) return;
  if (!currentUser) { openModal('loginModal'); showToast('Faça login para finalizar', 'error'); return; }
  if (deliveryType === 'delivery' && !getFullAddress()) {
    showToast('Preencha rua, número e bairro', 'error'); return;
  }

  const blockedCartItem = cart.find(item => {
    const product = products.find(p => p.id === item.id);
    if (!product) return false;
    return !getProductAvailability(product).canBuy;
  });
  if (blockedCartItem) {
    const product = products.find(p => p.id === blockedCartItem.id);
    const reason = getProductAvailability(product).reason || 'Indisponível agora';
    showToast(`${blockedCartItem.nome}: ${reason}`, 'error');
    return;
  }

  const btn = $('btnCheckout');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando...';

  try {
    if (appliedCoupon?.code) {
      const refreshed = await validateCouponCode(appliedCoupon.code, true);
      if (!refreshed.valid) {
        clearCouponState();
        showToast(refreshed.reason || 'Cupom inválido no momento do checkout', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-lock"></i> Finalizar Pedido';
        return;
      }
      appliedCoupon = refreshed.coupon;
    }

    const pricing = getCartPricing();
    const subtotal = pricing.subtotal;
    const fee = pricing.fee;
    const discount = pricing.discount;
    const total = pricing.total;
    const orderNSU = 'CJS' + Date.now();
    const obs = $('obsInput').value.trim();
    const enderecoEntrega = deliveryType === 'delivery' ? getFullAddress() : 'Retirada no local';

    const pagamentoEntregaMap = {
      dinheiro: 'na_entrega_dinheiro',
      cartao: 'na_entrega_cartao',
      pix: 'na_entrega_pix'
    };
    const formaPagamento = paymentType === 'na_entrega'
      ? pagamentoEntregaMap[paymentOnDeliveryMethod] || 'na_entrega_dinheiro'
      : 'infinitepay';

    const pedidoBase = {
      user_id: currentUser.id,
      itens: cart.map(c => ({ id: c.id, nome: c.nome, preco: c.preco, qty: c.qty })),
      total,
      status: 'pendente',
      nome_cliente: currentUser.user_metadata?.name || currentUser.email,
      telefone_cliente: currentUser.user_metadata?.phone || '',
      email_cliente: currentUser.email,
      endereco_entrega: enderecoEntrega,
      forma_pagamento: formaPagamento,
      observacoes: obs,
      forma_entrega: deliveryType,
      coupon_code: appliedCoupon?.code || null,
      coupon_discount: discount,
      coupon_meta: appliedCoupon ? {
        discount_type: appliedCoupon.discount_type,
        discount_value: appliedCoupon.discount_value,
        linked_promotion_id: appliedCoupon.linked_promotion_id || null
      } : {}
    };

    if (paymentType === 'na_entrega') {
      const { data: createdOrder, error: dbError } = await supabaseClient.from('pedidos').insert([pedidoBase]).select('id').single();
      if (dbError) throw dbError;

      if (deliveryType === 'delivery') await saveAddressToUser();

      cart = [];
      saveCart();
      closeCart();
      updateCartUI();
      $('successOverlay').classList.remove('hidden');
      await trackPromotionConversion(appliedCoupon, createdOrder?.id || null).catch(() => {});
      if (appliedCoupon?.id) await increaseCouponUsage(appliedCoupon.id);
      clearCouponState();
      btn.innerHTML = '<i class="fas fa-lock"></i> Finalizar Pedido';
      showToast('Pedido confirmado! Pagamento será feito na entrega.', 'success');
      return;
    }

    // Build InfinitePay items
    const items = buildInfinitePayItems(cart, fee, discount);

    // Create InfinitePay checkout link
    const response = await fetch(INFINITEPAY_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: {
          handle: INFINITEPAY_HANDLE,
          items,
          order_nsu: orderNSU,
          description: `Pedido Casa José Silva - ${orderNSU}`,
          customer: {
            name: currentUser.user_metadata?.name || currentUser.email,
            email: currentUser.email,
            phone: currentUser.user_metadata?.phone || '',
            address: deliveryType === 'delivery' ? enderecoEntrega : ''
          },
          redirect_url: window.location.href
        }
      })
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error('InfinitePay error:', errBody);
      throw new Error(errBody.error || 'Erro ao criar link de pagamento');
    }
    const result = await response.json();
    console.log('InfinitePay result:', result);
    const checkoutUrl = result.checkout_url || result.url || result.link;
    if (!checkoutUrl) throw new Error('Link de pagamento não retornado');

    // Save order to Supabase
    const pedidoData = {
      user_id: currentUser.id,
      itens: cart.map(c => ({ id: c.id, nome: c.nome, preco: c.preco, qty: c.qty })),
      total,
      status: 'pendente',
      nome_cliente: currentUser.user_metadata?.name || currentUser.email,
      telefone_cliente: currentUser.user_metadata?.phone || '',
      email_cliente: currentUser.email,
      endereco_entrega: enderecoEntrega,
      forma_pagamento: formaPagamento,
      infinitepay_ref: orderNSU,
      checkout_url: checkoutUrl,
      observacoes: obs,
      forma_entrega: deliveryType,
      coupon_code: appliedCoupon?.code || null,
      coupon_discount: discount,
      coupon_meta: appliedCoupon ? {
        discount_type: appliedCoupon.discount_type,
        discount_value: appliedCoupon.discount_value,
        linked_promotion_id: appliedCoupon.linked_promotion_id || null
      } : {}
    };
    const { data: createdOrder, error: dbError } = await supabaseClient.from('pedidos').insert([pedidoData]).select('id').single();
    if (dbError) console.error('Erro ao salvar pedido:', dbError);
    await trackPromotionConversion(appliedCoupon, createdOrder?.id || null).catch(() => {});
    if (appliedCoupon?.id) await increaseCouponUsage(appliedCoupon.id);

    // Save address for future orders
    if (deliveryType === 'delivery') await saveAddressToUser();

    // Clear cart & redirect
    cart = [];
    saveCart();
    closeCart();
    updateCartUI();
    clearCouponState();
    window.location.href = checkoutUrl;
  } catch (err) {
    console.error('Checkout error:', err);
    showToast('Erro no checkout. Tente novamente.', 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-lock"></i> Finalizar Pedido';
  }
}

// ============================================================
//  ORDERS
// ============================================================
async function loadOrders() {
  const container = $('ordersList');
  container.innerHTML = '<div class="loader"><div class="loader__spinner"></div><p>Carregando pedidos...</p></div>';

  try {
    const { data, error } = await withTimeout(
      supabaseClient
        .from('pedidos')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
    );
    if (error) throw error;

    if (!data || !data.length) {
      container.innerHTML = '<div class="orders__empty"><i class="fas fa-inbox"></i><p>Nenhum pedido encontrado.</p></div>';
      return;
    }

    container.innerHTML = data.map(order => {
      const items = Array.isArray(order.itens) ? order.itens : [];
      const itemsStr = items.map(i => `${i.qty}x ${i.nome}`).join(', ');
      const date = new Date(order.created_at).toLocaleString('pt-BR');
      return `
        <div class="order-card">
          <div class="order-card__header">
            <div>
              <div class="order-card__id">#${order.id}</div>
              <div class="order-card__date">${date}</div>
            </div>
          </div>
          ${buildOrderTimeline(order.status)}
          <div class="order-card__items">${escapeHtml(itemsStr)}</div>
          <div class="order-card__total">${formatMoney(order.total)}</div>
        </div>`;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar pedidos:', err);
    container.innerHTML = '<div class="orders__empty"><i class="fas fa-exclamation-circle"></i><p>Erro ao carregar pedidos.</p></div>';
  }
}

// ============================================================
//  ORDER TIMELINE
// ============================================================
function buildOrderTimeline(status) {
  const steps = [
    { key: 'pendente',      icon: 'fa-clock',         label: 'Pendente' },
    { key: 'confirmado',    icon: 'fa-check',          label: 'Confirmado' },
    { key: 'preparando',    icon: 'fa-fire',           label: 'Preparando' },
    { key: 'saiu_entrega',  icon: 'fa-motorcycle',     label: 'Em rota' },
    { key: 'entregue',      icon: 'fa-check-double',   label: 'Entregue' }
  ];

  if (status === 'cancelado') {
    const idx = 0;
    const barPct = 0;
    return `
      <div class="order-timeline order-timeline--cancelled">
        <div class="order-timeline__bar" style="width:0%"></div>
        <div class="order-step order-step--active">
          <div class="order-step__dot"><i class="fas fa-times"></i></div>
          <span class="order-step__label">Cancelado</span>
        </div>
        ${steps.slice(1).map(() => `
          <div class="order-step">
            <div class="order-step__dot"><i class="fas fa-minus"></i></div>
            <span class="order-step__label">—</span>
          </div>`).join('')}
      </div>`;
  }

  const currentIdx = steps.findIndex(s => s.key === status);
  const totalGaps = steps.length - 1;
  const barPct = currentIdx <= 0 ? 0 : (currentIdx / totalGaps) * 100;

  return `
    <div class="order-timeline">
      <div class="order-timeline__bar" style="width:${barPct}%"></div>
      ${steps.map((step, i) => {
        let cls = '';
        if (i < currentIdx) cls = 'order-step--done';
        else if (i === currentIdx) cls = 'order-step--active';
        return `
          <div class="order-step ${cls}">
            <div class="order-step__dot"><i class="fas ${step.icon}"></i></div>
            <span class="order-step__label">${step.label}</span>
          </div>`;
      }).join('')}
    </div>`;
}

// ============================================================
//  AUTHENTICATION
// ============================================================
// Auth tabs
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    if (tab.dataset.tab === 'login') {
      $('loginForm').classList.add('active');
      $('authModalTitle').textContent = 'Entrar';
    } else {
      $('cadastroForm').classList.add('active');
      $('authModalTitle').textContent = 'Criar Conta';
    }
  });
});

// Login
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  if (!email || !password) { showToast('Preencha todos os campos', 'error'); return; }

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;
    await checkAdminStatus(currentUser);
    closeModal('loginModal');
    updateAuthUI();
    fillAddressFromUser();
    showToast('Login realizado com sucesso!', 'success');
  } catch (err) {
    showToast(err.message || 'Erro ao fazer login', 'error');
  }
});

// Cadastro
$('cadastroForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('cadastroName').value.trim();
  const phone = $('cadastroPhone').value.trim();
  const email = $('cadastroEmail').value.trim();
  const password = $('cadastroPassword').value;
  const passwordConfirm = $('cadastroPasswordConfirm').value;

  if (!name || !phone || !email || !password) { showToast('Preencha todos os campos', 'error'); return; }
  if (password !== passwordConfirm) { showToast('As senhas não coincidem', 'error'); return; }
  if (password.length < 6) { showToast('Senha deve ter no mínimo 6 caracteres', 'error'); return; }

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email, password,
      options: { data: { name, phone } }
    });
    if (error) throw error;
    currentUser = data.user;
    await checkAdminStatus(currentUser);
    closeModal('loginModal');
    updateAuthUI();
    fillAddressFromUser();
    showToast('Conta criada com sucesso!', 'success');
  } catch (err) {
    showToast(err.message || 'Erro ao criar conta', 'error');
  }
});

// Google OAuth
$('btnGoogleLogin').addEventListener('click', async () => {
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) throw error;
  } catch (err) {
    showToast('Erro ao conectar com Google', 'error');
  }
});

// Logout
function handleLogout() {
  supabaseClient.auth.signOut();
  currentUser = null;
  isAdmin = false;
  clearCouponState();
  sessionStorage.removeItem('cjs_is_admin');
  updateAuthUI();
  showToast('Você saiu da sua conta', 'success');
  showPage(splashScreen);
}

function updateAuthUI() {
  const btn = $('btnMinhaConta');
  const adminBtn = $('btnAdminPanel');
  if (currentUser) {
    btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Sair';
  } else {
    btn.innerHTML = '<i class="fas fa-user"></i> Minha Conta';
  }
  if (isAdmin) {
    adminBtn.classList.remove('hidden');
  } else {
    adminBtn.classList.add('hidden');
  }
}

// Check session on load
async function checkAdminStatus(user) {
  if (!user) { isAdmin = false; sessionStorage.removeItem('cjs_is_admin'); return; }
  // Use cache to avoid flicker — only revalidate in background
  const cached = sessionStorage.getItem('cjs_is_admin');
  if (cached === user.email) {
    isAdmin = true;
    updateAuthUI();
  }
  try {
    console.log('[Admin Check] Verificando admin para:', user.email);
    const { data: adminRow, error: adminErr } = await withTimeout(
      supabaseClient
        .from('admin_users')
        .select('*')
        .eq('email', user.email)
        .maybeSingle(),
      10000
    );
    console.log('[Admin Check] Resultado:', { adminRow, adminErr });
    if (adminErr) {
      console.error('[Admin Check] Erro RLS:', adminErr.message);
      // Keep cached state if query fails — don't hide the button
      if (!cached) isAdmin = false;
      return;
    }
    if (adminRow) {
      isAdmin = true;
      sessionStorage.setItem('cjs_is_admin', user.email);
      console.log('[Admin Check] Admin confirmado!');
      if (!adminRow.auth_user_id) {
        const { error: linkErr } = await supabaseClient.from('admin_users')
          .update({ auth_user_id: user.id })
          .eq('email', user.email);
        if (linkErr) console.error('[Admin Check] Erro ao vincular auth_user_id:', linkErr.message);
        else console.log('[Admin Check] auth_user_id vinculado com sucesso');
      }
    } else {
      console.log('[Admin Check] Email não encontrado em admin_users');
      isAdmin = false;
      sessionStorage.removeItem('cjs_is_admin');
    }
  } catch (err) {
    console.error('[Admin Check] Erro inesperado:', err);
    // Keep cached state on timeout/error
    if (!cached) isAdmin = false;
  }
}

async function initAuth() {
  // Restore admin from cache immediately (avoids flicker)
  const cachedAdmin = sessionStorage.getItem('cjs_is_admin');
  try {
    console.log('[Auth] Verificando sessão...');
    const { data: { session } } = await withTimeout(supabaseClient.auth.getSession(), 10000);
    console.log('[Auth] Sessão:', session ? 'ativa' : 'nenhuma');
    if (session?.user) {
      currentUser = session.user;
      // Show admin button immediately from cache
      if (cachedAdmin === session.user.email) {
        isAdmin = true;
        updateAuthUI();
      }
      await checkAdminStatus(currentUser);
      updateAuthUI();
      fillAddressFromUser();
    } else {
      sessionStorage.removeItem('cjs_is_admin');
    }
  } catch (err) {
    console.error('[Auth] Erro ao verificar sessão:', err.message);
  }
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    const prevUser = currentUser?.id;
    currentUser = session?.user || null;
    // Only re-check admin if user actually changed
    if (currentUser?.id !== prevUser) {
      await checkAdminStatus(currentUser);
      updateAuthUI();
    }
  });
}

function parseTimeToMinutes(timeValue, fallback) {
  const raw = (timeValue || fallback || '').toString();
  const [h, m] = raw.split(':');
  const hh = Number(h);
  const mm = Number(m);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
  return hh * 60 + mm;
}

function isDateWithinPromotion(promo) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (promo.start_date) {
    const start = new Date(promo.start_date + 'T00:00:00');
    if (today < start) return false;
  }
  if (promo.end_date) {
    const end = new Date(promo.end_date + 'T00:00:00');
    if (today > end) return false;
  }
  return true;
}

function isTimeWithinPromotion(promo) {
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const start = parseTimeToMinutes(promo.start_time, '00:00');
  const end = parseTimeToMinutes(promo.end_time, '23:59');
  if (start <= end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function isDayWithinPromotion(promo) {
  const days = Array.isArray(promo.days_of_week) ? promo.days_of_week : [];
  if (!days.length) return true;
  return days.map(v => Number(v)).includes(new Date().getDay());
}

async function isFirstOrderUser(userId) {
  if (!userId) return false;
  if (firstOrderCache.userId === userId) return firstOrderCache.isFirstOrder;

  try {
    const { count, error } = await supabaseClient
      .from('pedidos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (error) throw error;
    const firstOrder = (count || 0) === 0;
    firstOrderCache = { userId, isFirstOrder: firstOrder };
    return firstOrder;
  } catch (_) {
    return false;
  }
}

async function matchesPromotionType(promo) {
  const type = promo.promo_type || 'general';
  if (type === 'general' || type === 'daily' || type === 'weekly') return true;

  if (type === 'first_login') {
    if (!currentUser?.id) return false;
    return localStorage.getItem(`cjs_first_login_seen_${currentUser.id}`) !== '1';
  }

  if (type === 'first_order') {
    if (!currentUser?.id) return false;
    return await isFirstOrderUser(currentUser.id);
  }

  return false;
}

function isPromotionCooldownOver(promo) {
  const lastClosed = Number(localStorage.getItem(`cjs_promo_closed_${promo.id}`) || '0');
  const cooldownMinutes = Number(promo.cooldown_minutes || 0);
  if (!cooldownMinutes || !lastClosed) return true;
  return (Date.now() - lastClosed) >= (cooldownMinutes * 60000);
}

function buildInfinitePayItems(cartItems, fee, discount) {
  const lines = cartItems.map(item => {
    const unit = Math.max(1, Math.round(Number(item.preco || 0) * 100));
    const qty = Math.max(1, Number(item.qty || 1));
    return {
      description: item.nome,
      quantity: qty,
      gross: unit * qty
    };
  });

  const grossSubtotal = lines.reduce((sum, line) => sum + line.gross, 0);
  let remainingDiscount = Math.min(grossSubtotal, Math.max(0, Math.round(discount * 100)));

  lines.forEach((line, idx) => {
    const proportional = idx === lines.length - 1
      ? remainingDiscount
      : Math.floor((remainingDiscount * line.gross) / Math.max(1, grossSubtotal));

    const maxLineDiscount = Math.max(0, line.gross - line.quantity);
    const lineDiscount = Math.min(proportional, maxLineDiscount, remainingDiscount);
    remainingDiscount -= lineDiscount;
    line.net = line.gross - lineDiscount;
  });

  const items = [];
  lines.forEach(line => {
    const basePrice = Math.floor(line.net / line.quantity);
    let remainder = line.net - (basePrice * line.quantity);
    for (let i = 0; i < line.quantity; i++) {
      const price = basePrice + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      items.push({ description: line.description, quantity: 1, price: Math.max(1, price) });
    }
  });

  if (fee > 0) {
    items.push({ description: 'Taxa de Entrega', quantity: 1, price: Math.round(fee * 100) });
  }
  return items;
}

async function increaseCouponUsage(couponId) {
  if (!couponId) return;
  try {
    const { data, error } = await supabaseClient.from('discount_coupons').select('usage_count').eq('id', couponId).single();
    if (error) return;
    const newCount = Number(data?.usage_count || 0) + 1;
    await supabaseClient.from('discount_coupons').update({ usage_count: newCount }).eq('id', couponId);
  } catch (_) {
    // no-op
  }
}

async function trackPromotionEvent(promotionId, eventType, metadata = {}) {
  if (!promotionId || !eventType) return;
  const payload = {
    promotion_id: promotionId,
    event_type: eventType,
    user_id: currentUser?.id || null,
    session_id: promoSessionId,
    coupon_code: metadata.coupon_code || null,
    product_id: metadata.product_id || null,
    order_id: metadata.order_id || null,
    metadata: metadata || {}
  };
  await supabaseClient.from('promotion_popup_events').insert([payload]);
}

async function trackPromotionConversion(coupon, orderId) {
  const promoIdFromCoupon = Number(coupon?.linked_promotion_id || 0) || null;
  const promoIdFromSession = Number(sessionStorage.getItem('cjs_last_popup_promo_id') || '0') || null;
  const promotionId = promoIdFromCoupon || promoIdFromSession;
  if (!promotionId) return;

  await trackPromotionEvent(promotionId, 'conversion', {
    coupon_code: coupon?.code || null,
    order_id: orderId || null
  });
}

function renderPromotionPopup(promo) {
  activePromotion = promo;
  $('promoPopupTitle').textContent = promo.title || promo.name || 'Promoção especial';
  $('promoPopupDescription').textContent = promo.description || 'Oferta por tempo limitado.';

  const oldPrice = Number(promo.original_price || 0);
  const newPrice = Number(promo.promo_price || 0);
  $('promoPopupOldPrice').textContent = oldPrice > 0 ? formatMoney(oldPrice) : '';
  $('promoPopupNewPrice').textContent = newPrice > 0 ? formatMoney(newPrice) : (promo.discount_percent ? `${promo.discount_percent}% OFF` : 'Oferta ativa');

  const coupon = (promo.coupon_code || '').trim().toUpperCase();
  $('promoPopupCoupon').textContent = coupon || '-';
  $('promoPopupCouponBox').classList.toggle('hidden', !coupon);

  $('promoPopupRules').textContent = promo.rules || 'Consulte as regras no checkout.';
  $('promoPopupAction').textContent = promo.button_text || 'Ver produto';

  const imageEl = $('promoPopupImage');
  if (promo.image_url) {
    imageEl.src = promo.image_url;
    imageEl.classList.remove('hidden');
  } else {
    imageEl.src = 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=1200&h=800&fit=crop';
    imageEl.classList.remove('hidden');
  }

  const delay = Math.max(0, Number(promo.delay_seconds || 0)) * 1000;
  setTimeout(() => {
    if (!isMenuPageVisible()) return;
    openPromoPopup();
  }, delay);
}

async function loadPromotionPopup() {
  if (!isMenuPageVisible()) return;
  try {
    const { data, error } = await supabaseClient
      .from('promotion_popups')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;

    const promos = data || [];
    for (const promo of promos) {
      if (!isDateWithinPromotion(promo)) continue;
      if (!isDayWithinPromotion(promo)) continue;
      if (!isTimeWithinPromotion(promo)) continue;
      if (!isPromotionCooldownOver(promo)) continue;
      if (!(await matchesPromotionType(promo))) continue;
      renderPromotionPopup(promo);
      return;
    }
  } catch (err) {
    console.error('Erro ao carregar popup promocional:', err.message || err);
  }
}

// ============================================================
//  SUCCESS OVERLAY (from redirect)
// ============================================================
$('btnSuccessClose').addEventListener('click', () => {
  $('successOverlay').classList.add('hidden');
  showPage(splashScreen);
});

function checkPaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('payment_status') || params.has('approved')) {
    $('successOverlay').classList.remove('hidden');
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// ============================================================
//  UTILITY
// ============================================================
function formatMoney(val) {
  return 'R$ ' + Number(val).toFixed(2).replace('.', ',');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg, type = '') {
  const toast = $('toast');
  toast.textContent = msg;
  toast.className = 'toast' + (type ? ` toast--${type}` : '');
  setTimeout(() => { toast.classList.add('hidden'); }, 3000);
}

// ============================================================
//  INIT
// ============================================================
(async function init() {
  await loadRuntimeConfig();
  updateStatus();
  await initAuth();
  updateCartUI();
  checkPaymentReturn();
})();

