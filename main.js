// === ADMIN_MODE_BOOTSTRAP ===
(function() {
    const urlParams = new URLSearchParams(window.location.search);
    const isAdmin = urlParams.get('admin') === '1';
    if (isAdmin) {
        document.body.classList.add('admin-mode');
        document.getElementById('storeRoot')?.classList.add('hidden');
        document.getElementById('adminRoot')?.classList.remove('hidden');
    } else {
        document.getElementById('storeRoot')?.classList.remove('hidden');
        document.getElementById('adminRoot')?.classList.add('hidden');
    }
})();
// ============================================================
//  CASA JOSÉ SILVA — Main Application Logic
// ============================================================

const SUPABASE_URL = 'https://uufzqceljdkrnpgjotxw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1ZnpxY2VsamRrcm5wZ2pvdHh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MzIzMjUsImV4cCI6MjA4OTAwODMyNX0.lDBwSOYlF3SlMKblt2WsHo7rdVcZ-wXgjJolD41cNfk';
const SUPABASE_PROJECT_REF = (() => {
  try {
    return new URL(SUPABASE_URL).hostname.split('.')[0] || '';
  } catch (_) {
    return '';
  }
})();
const SUPABASE_AUTH_STORAGE_KEY = SUPABASE_PROJECT_REF ? `sb-${SUPABASE_PROJECT_REF}-auth-token` : '';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function isSupabaseNetworkError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('err_name_not_resolved');
}

function clearSupabaseAuthCache(reason) {
  if (!SUPABASE_AUTH_STORAGE_KEY) return;
  localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
  sessionStorage.removeItem('cjs_is_admin');
  console.warn(`[Supabase] Sessao local removida: ${reason}`);
}

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
let cart = (() => {
  try {
    const raw = localStorage.getItem('cjs_cart');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item =>
      item && typeof item.id !== 'undefined' &&
      typeof item.nome === 'string' &&
      typeof item.preco === 'number' && item.preco >= 0 &&
      Number.isInteger(item.qty) && item.qty > 0
    );
  } catch (_) { return []; }
})();
let currentUser = null;
let isAdmin = false;
let activeCategory = 'todos';
let searchQuery = '';
let deliveryType = 'delivery';
let paymentType = 'online';
let paymentOnDeliveryMethod = 'dinheiro';
const DEFAULT_DELIVERY_FEE_OUTSIDE_AREA = 20;
let deliveryZones = [];
let activePromotion = null;
let firstOrderCache = { userId: null, isFirstOrder: false };
let appliedCoupon = null;
let runtimeConfig = {};
let consumedPromotionUserId = null;
let consumedPromotionIds = new Set();
let usedCouponCodesUserId = null;
let usedCouponCodes = new Set();
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

function normalizeTextKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadDeliveryZones() {
  try {
    const { data, error } = await withTimeout(
      supabaseClient
        .from('delivery_zones')
        .select('id,nome,taxa_entrega,raio_km')
        .order('raio_km', { ascending: true }),
      12000
    );
    if (error) throw error;
    deliveryZones = Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Erro ao carregar regiões de entrega:', err.message || err);
    deliveryZones = [];
  }
}

function findDeliveryZoneForAddress(bairroValue) {
  const bairroKey = normalizeTextKey(bairroValue);
  if (!bairroKey || !deliveryZones.length) return null;

  let best = null;
  let score = -1;

  deliveryZones.forEach(zone => {
    const zoneKey = normalizeTextKey(zone?.nome);
    if (!zoneKey) return;
    const matched = bairroKey.includes(zoneKey) || zoneKey.includes(bairroKey);
    if (!matched) return;
    const zoneScore = zoneKey.length;
    if (zoneScore > score) {
      score = zoneScore;
      best = zone;
    }
  });

  return best;
}

function getCurrentDeliveryFee() {
  if (deliveryType !== 'delivery') return 0;
  const bairro = $('addrBairro')?.value?.trim() || '';
  if (!bairro) return null; // no address yet
  const matchedZone = findDeliveryZoneForAddress(bairro);
  if (matchedZone) {
    const zoneFee = Number(matchedZone.taxa_entrega || 0);
    if (Number.isFinite(zoneFee) && zoneFee >= 0) return zoneFee;
  }
  return DEFAULT_DELIVERY_FEE_OUTSIDE_AREA;
}

function updateDeliveryFeePreview() {
  const fee = getCurrentDeliveryFee();
  if ($('taxaEntrega')) {
    $('taxaEntrega').textContent = fee.toFixed(2).replace('.', ',');
  }
}

function normalizeCategoryKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function categoryInSetByKey(categorySet, categoryKey) {
  for (const item of categorySet || []) {
    if (normalizeCategoryKey(item) === categoryKey) return true;
  }
  return false;
}

function isAlwaysBothPeriodsCategory(categoryKey) {
  return new Set([
    'bebida',
    'bebidas',
    'drink',
    'drinks',
    'refrigerante',
    'refrigerantes',
    'suco',
    'sucos',
    'agua',
    'aguas',
    'cerveja',
    'cervejas'
  ]).has(categoryKey);
}

function isLunchSupportCategory(categoryKey) {
  return new Set([
    'sobremesa',
    'sobremesas',
    'doce',
    'doces',
    'acompanhamento',
    'acompanhamentos',
    'porcao',
    'porcoes',
    'entrada',
    'entradas'
  ]).has(categoryKey);
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
          'schedule_message_closed',
          'instagram_url',
          'whatsapp_number',
          'facebook_url',
          'email'
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
    const category = normalizeCategoryKey(product?.categoria);
    const schedule = getScheduleContext();
    const inLunch = categoryInSetByKey(schedule.lunch.categories, category);
    const inDinner = categoryInSetByKey(schedule.dinner.categories, category);
    if (inLunch && inDinner) {
      return { canBuy: false, reason: `Indisponível — almoço (${cfg('lunch_start')} às ${cfg('lunch_end')}) e jantar (${cfg('dinner_start')} às ${cfg('dinner_end')})` };
    } else if (inLunch) {
      return { canBuy: false, reason: `Indisponível — disponível no almoço (${cfg('lunch_start')} às ${cfg('lunch_end')})` };
    } else if (inDinner) {
      return { canBuy: false, reason: `Indisponível — disponível no jantar (${cfg('dinner_start')} às ${cfg('dinner_end')})` };
    }
    return { canBuy: false, reason: 'Indisponível no momento' };
  }

  const schedule = getScheduleContext();
  const category = normalizeCategoryKey(product.categoria);
  const inLunchCatalog = categoryInSetByKey(schedule.lunch.categories, category);
  const inDinnerCatalog = categoryInSetByKey(schedule.dinner.categories, category);
  const alwaysBothPeriods = isAlwaysBothPeriodsCategory(category);
  const lunchSupport = isLunchSupportCategory(category);

  // BEBIDAS: sempre disponíveis se dia aberto e não estiver no intervalo
  if (alwaysBothPeriods) {
    if (!schedule.dayOpen) {
      return { canBuy: false, reason: `Fechado hoje — almoço (${cfg('lunch_start')} às ${cfg('lunch_end')}) / jantar (${cfg('dinner_start')} às ${cfg('dinner_end')})` };
    }
    if (schedule.inBreak) {
      return { canBuy: false, reason: `Intervalo — retorna às ${cfg('dinner_start')}` };
    }
    if (!schedule.activePeriod) {
      return { canBuy: false, reason: cfg('schedule_message_closed') || 'Fora do horário de atendimento' };
    }
    return { canBuy: true, reason: '' };
  }

  if (!schedule.dayOpen) {
    if (inLunchCatalog || lunchSupport) return { canBuy: false, reason: `Fechado hoje — disponível no almoço (${cfg('lunch_start')} às ${cfg('lunch_end')})` };
    if (inDinnerCatalog) return { canBuy: false, reason: `Fechado hoje — disponível no jantar (${cfg('dinner_start')} às ${cfg('dinner_end')})` };
    return { canBuy: false, reason: `Fechado hoje — almoço (${cfg('lunch_start')} às ${cfg('lunch_end')}) / jantar (${cfg('dinner_start')} às ${cfg('dinner_end')})` };
  }

  if (schedule.inBreak) {
    if (inDinnerCatalog) return { canBuy: false, reason: `Intervalo — retorna às ${cfg('dinner_start')}` };
    if (inLunchCatalog || lunchSupport) return { canBuy: false, reason: `Intervalo — disponível no almoço (${cfg('lunch_start')} às ${cfg('lunch_end')})` };
    return { canBuy: false, reason: `Intervalo — retorna às ${cfg('dinner_start')}` };
  }

  if (!schedule.activePeriod) {
    if (inLunchCatalog || lunchSupport) return { canBuy: false, reason: `Disponível no almoço (${cfg('lunch_start')} às ${cfg('lunch_end')})` };
    if (inDinnerCatalog) return { canBuy: false, reason: `Disponível no jantar (${cfg('dinner_start')} às ${cfg('dinner_end')})` };
    return { canBuy: false, reason: cfg('schedule_message_closed') || 'Fora do horário de atendimento' };
  }

  if (schedule.activePeriod.key === 'lunch' && lunchSupport) {
    return { canBuy: true, reason: '' };
  }

  if (!categoryInSetByKey(schedule.activePeriod.categories, category)) {
    if (inDinnerCatalog) return { canBuy: false, reason: `Disponível no jantar (${cfg('dinner_start')} às ${cfg('dinner_end')})` };
    if (inLunchCatalog) return { canBuy: false, reason: `Disponível no almoço (${cfg('lunch_start')} às ${cfg('lunch_end')})` };
    return { canBuy: false, reason: `Indisponível neste período — almoço (${cfg('lunch_start')} às ${cfg('lunch_end')}) / jantar (${cfg('dinner_start')} às ${cfg('dinner_end')})` };
  }

  return { canBuy: true, reason: '' };
}

function getAvailabilityTone(reason) {
  const text = normalizeTextKey(reason || '');
  if (!text) return 'neutral';

  if (text.includes('fechado hoje') || text.includes('fechado agora') || text.includes('fechado no momento')) {
    return 'closed';
  }

  if (text.includes('fechado entre')) {
    return 'break';
  }

  if (text.includes('almoco') || text.includes('jantar') || text.includes('horario')) {
    return 'schedule';
  }

  if (text.includes('neste periodo') || text.includes('periodo')) {
    return 'period';
  }

  if (text.includes('indisponivel')) {
    return 'unavailable';
  }

  return 'neutral';
}

// ============================================================
//  NAVIGATION
// ============================================================
function showPage(page) {
  [splashScreen, menuPage].forEach(p => p.classList.add('hidden'));
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
  openModal('ordersModal'); loadOrders();
});
$('btnMinhaConta').addEventListener('click', () => {
  if (currentUser) { handleLogout(); } else { openModal('loginModal'); }
});
$('btnBackToHome').addEventListener('click', () => showPage(splashScreen));
$('btnScrollCardapio').addEventListener('click', () => {
  const hero = $('menuHero');
  const isMobile = window.innerWidth <= 768;
  if (isMobile && !hero.classList.contains('menu-hero--expanded')) {
    hero.classList.add('menu-hero--expanded');
    setTimeout(() => {
      hero.classList.remove('menu-hero--expanded');
      setTimeout(() => {
        $('catNav').scrollIntoView({ behavior: 'smooth' });
      }, 500);
    }, 1800);
  } else {
    hero.classList.remove('menu-hero--expanded');
    $('catNav').scrollIntoView({ behavior: 'smooth' });
  }
});
$('btnAdminPanel').addEventListener('click', () => {
  if (!isAdmin) return;
  window.location.href = 'index.html?admin=1';
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
  const originalPromotionPrice = parsePriceValue(activePromotion.original_price);
  const promotionalPrice = parsePriceValue(activePromotion.promo_price);
  const hasFixedPromotionPrice = originalPromotionPrice > 0 && promotionalPrice > 0 && promotionalPrice < originalPromotionPrice;
  if (activePromotion.id) {
    sessionStorage.setItem('cjs_last_popup_promo_id', String(activePromotion.id));
    await trackPromotionEvent(activePromotion.id, 'click', {
      product_id: activePromotion.product_id || null,
      coupon_code: activePromotion.coupon_code || null
    }).catch(() => {});
  }

  if (activePromotion.coupon_code && !hasFixedPromotionPrice) {
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

  if (hasFixedPromotionPrice && addPromotionToCart(activePromotion)) {
    openCart();
    return;
  }

  if (hasFixedPromotionPrice) {
    // Never fallback to regular product flow when promotion is fixed-price.
    return;
  }

  const selectedIds = getPromotionSelectedIds(activePromotion);
  if (!selectedIds.length) {
    showToast('Essa promoção não possui produtos vinculados', 'error');
    return;
  }

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

  // Sort categories: those with available products first
  categories.sort((a, b) => {
    const aHasAvail = products.filter(p => p.categoria === a).some(p => getProductAvailability(p).canBuy) ? 0 : 1;
    const bHasAvail = products.filter(p => p.categoria === b).some(p => getProductAvailability(p).canBuy) ? 0 : 1;
    return aHasAvail - bHasAvail;
  });

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

  // Sort: available products first, then unavailable
  filtered.sort((a, b) => {
    const aAvail = getProductAvailability(a).canBuy ? 0 : 1;
    const bAvail = getProductAvailability(b).canBuy ? 0 : 1;
    return aAvail - bAvail;
  });

  const groups = {};
  filtered.forEach(p => {
    if (!groups[p.categoria]) groups[p.categoria] = [];
    groups[p.categoria].push(p);
  });

  // Sort category groups: categories with at least one available product first
  const sortedEntries = Object.entries(groups).sort((a, b) => {
    const aHasAvail = a[1].some(p => getProductAvailability(p).canBuy) ? 0 : 1;
    const bHasAvail = b[1].some(p => getProductAvailability(p).canBuy) ? 0 : 1;
    return aHasAvail - bHasAvail;
  });

  let html = '<div class="products__grid">';
  for (const [cat, items] of sortedEntries) {
    html += `<div class="category-header"><span class="category-header__title">${formatCategory(cat)}</span><span class="category-header__count">${items.length} itens</span></div>`;
    items.forEach(p => {
      const inCart = cart.find(c => c.id === p.id);
      const availability = getProductAvailability(p);
      const availabilityTone = getAvailabilityTone(availability.reason);
      const dataCategory = normalizeCategoryKey(p.categoria);
      // Primeira mídia (imagem ou vídeo)
      let midiaHtml = '';
      const midiasArr = Array.isArray(p.midias) ? p.midias : (p.midias ? [p.midias] : []);
      const typesArr = Array.isArray(p.midias_types) ? p.midias_types : (p.midias_types ? [p.midias_types] : []);
      if (midiasArr.length > 0) {
        const idx = typesArr[0] === 'video' ? midiasArr.findIndex((_, i) => typesArr[i] === 'image') : 0;
        const url = midiasArr[idx >= 0 ? idx : 0];
        const type = typesArr[idx >= 0 ? idx : 0] || 'image';
        if (type === 'image') {
          midiaHtml = `<img class="product-card__img" src="${escapeHtml(url)}" alt="${escapeHtml(p.nome)}" loading="lazy">`;
        } else if (type === 'video') {
          midiaHtml = `<video class="product-card__img" src="${escapeHtml(url)}" alt="${escapeHtml(p.nome)}" muted playsinline preload="metadata" style="object-fit:contain;width:100%;height:100%;max-height:120px;"></video>`;
        }
      }
      html += `
      <div class="product-card" data-id="${p.id}" data-category="${dataCategory}">
        <div class="product-card__img-wrap">
          ${midiaHtml}
          <span class="product-card__category">${escapeHtml(formatCategory(p.categoria))}</span>
          ${!availability.canBuy ? `<div class="product-card__unavailable"><span class="product-card__unavailable-badge product-card__unavailable-badge--${availabilityTone}"><i class="fas fa-clock"></i>${escapeHtml(availability.reason || 'Indisponível')}</span></div>` : ''}
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
  const availabilityTone = getAvailabilityTone(availability.reason);
  const inCart = cart.find(c => c.id === id);
  const qty = inCart ? inCart.qty : 1;
  $('productModalTitle').textContent = '';
  // Galeria/carrossel de mídias
  let galeria = '';
  if (Array.isArray(p.midias) && p.midias.length > 0) {
    galeria = '<div class="product-detail__gallery">';
    p.midias.forEach((url, i) => {
      const type = p.midias_types ? p.midias_types[i] : 'image';
      if (type === 'image') {
        galeria += `<img class="product-detail__img" src="${escapeHtml(url)}" alt="${escapeHtml(p.nome)}">`;
      } else if (type === 'video') {
        galeria += `<video class="product-detail__img" src="${escapeHtml(url)}" controls muted playsinline preload="metadata" style="object-fit:contain;width:100%;max-height:220px;"></video>`;
      }
    });
    galeria += '</div>';
  }
  $('productModalBody').innerHTML = `
    <div class="product-detail">
      ${galeria}
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
      </div>` : `<p class="product-detail__availability product-detail__availability--${availabilityTone}"><i class="fas fa-clock"></i><span>${escapeHtml(availability.reason || 'Produto indisponível')}</span></p>`}
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
$('searchInput').addEventListener('input', (() => {
  let _debTimer;
  return (e) => {
    clearTimeout(_debTimer);
    _debTimer = setTimeout(() => {
      searchQuery = e.target.value.trim();
      renderProducts();
    }, 250);
  };
})());

// ============================================================
//  CART
// ============================================================
function parsePriceValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const raw = String(value ?? '').trim();
  if (!raw) return 0;

  if (raw.includes(',')) {
    const normalized = raw.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseIdList(value) {
  if (Array.isArray(value)) {
    return value
      .map(entry => Number(entry))
      .filter(entry => Number.isFinite(entry) && entry > 0);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? [Math.trunc(value)] : [];
  }

  if (typeof value === 'string') {
    const normalized = value
      .trim()
      .replace(/[\[\]{}()]/g, '')
      .replace(/;/g, ',');

    if (!normalized) return [];

    return normalized
      .split(',')
      .map(entry => Number(String(entry).trim()))
      .filter(entry => Number.isFinite(entry) && entry > 0);
  }

  return [];
}

function getPromotionSelectedIds(promo) {
  const selectedIds = parseIdList(promo?.product_ids);

  if (selectedIds.length) return selectedIds;

  return parseIdList(promo?.product_id);
}

function getCartItemProductIds(item) {
  const productIds = parseIdList(item?.product_ids);

  if (productIds.length) return productIds;

  return parseIdList(item?.id);
}

function getCartItemBlockedReason(item) {
  if (item?.is_promotional) return '';

  const productIds = getCartItemProductIds(item);
  for (const productId of productIds) {
    const product = products.find(entry => entry.id === productId);
    if (!product) continue;
    const availability = getProductAvailability(product);
    if (!availability.canBuy) return availability.reason || 'Indisponível agora';
  }
  return '';
}

function addPromotionToCart(promo) {
  const selectedIds = getPromotionSelectedIds(promo);
  if (!selectedIds.length) {
    showToast('Selecione ao menos um produto para essa promoção', 'error');
    return false;
  }

  const originalPrice = parsePriceValue(promo.original_price);
  const promoPrice = parsePriceValue(promo.promo_price);
  if (!(originalPrice > 0) || !(promoPrice > 0) || promoPrice >= originalPrice) {
    showToast('Essa promoção está com preços inválidos', 'error');
    return false;
  }

  const selectedProducts = selectedIds
    .map(productId => products.find(entry => entry.id === productId))
    .filter(Boolean);
  const availableProducts = selectedProducts.filter(product => getProductAvailability(product).canBuy);

  if (selectedProducts.length && !availableProducts.length) {
    const firstReason = getProductAvailability(selectedProducts[0]).reason || 'Item promocional indisponível agora';
    showToast(firstReason, 'error');
    return false;
  }

  const referenceProduct = availableProducts[0] || selectedProducts[0] || null;
  const promotionId = Number(promo.id || Date.now());
  const cartItemId = -(1000000 + promotionId);
  const existing = cart.find(item => Number(item.id) === cartItemId);

  if (existing) {
    existing.preco = promoPrice;
    existing.original_price = originalPrice;
    existing.nome = selectedProducts.length > 1
      ? (promo.title || promo.name || 'Kit promocional')
      : `${referenceProduct?.nome || promo.title || promo.name || 'Item promocional'} · Promoção`;
    existing.imagem_url = promo.image_url || referenceProduct?.midias?.[0] || existing.imagem_url || '';
    existing.qty += 1;
  } else {
    const itemName = selectedProducts.length > 1
      ? (promo.title || promo.name || 'Kit promocional')
      : `${referenceProduct?.nome || promo.title || promo.name || 'Item promocional'} · Promoção`;

    cart.push({
      id: cartItemId,
      nome: itemName,
      preco: promoPrice,
      original_price: originalPrice,
      imagem_url: promo.image_url || referenceProduct?.midias?.[0] || '',
      qty: 1,
      promotion_id: promo.id || null,
      product_ids: selectedIds,
      is_promotional: true
    });
  }

  saveCart();
  showToast('Oferta promocional adicionada ao carrinho', 'success');
  renderProducts();
  return true;
}

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
  else { cart.push({ id, nome: p.nome, preco: p.preco, imagem_url: p.midias?.[0] || '', qty }); }
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

// Animate counting for money values (R$ X,XX)
function animateValue(el, newText) {
  if (!el || el.textContent === newText) return;
  const oldVal = parseMoney(el.textContent);
  const newVal = parseMoney(newText);
  if (isNaN(oldVal) || isNaN(newVal) || oldVal === newVal) {
    el.textContent = newText;
    return;
  }
  const duration = 400;
  const start = performance.now();
  const diff = newVal - oldVal;
  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = oldVal + diff * eased;
    el.textContent = formatMoney(current);
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = newText;
  }
  requestAnimationFrame(tick);
}

// Animate integer badge count
function animateBadge(el, newCount) {
  if (!el) return;
  const oldCount = parseInt(el.textContent) || 0;
  if (oldCount === newCount) return;
  const duration = 300;
  const start = performance.now();
  const diff = newCount - oldCount;
  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(oldCount + diff * eased);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function parseMoney(str) {
  if (!str) return NaN;
  const cleaned = str.replace(/[^\d,.-]/g, '').replace(',', '.');
  return parseFloat(cleaned);
}

function normalizeCouponCode(code) {
  return (code || '').trim().toUpperCase();
}

function clearCouponState() {
  appliedCoupon = null;
  $('couponInput').value = '';
  $('couponInput').readOnly = false;
  $('couponInput').disabled = false;
  $('btnApplyCoupon').classList.remove('hidden');
  $('btnRemoveCoupon').classList.add('hidden');
  $('cartCouponStatus').textContent = '';
  updateCartUI();
}

function getCartPricing() {
  const subtotal = cart.reduce((sum, item) => sum + (parsePriceValue(item.preco) * Number(item.qty || 0)), 0);
  const rawFee = getCurrentDeliveryFee();
  const fee = rawFee === null ? 0 : rawFee;
  const feeKnown = rawFee !== null;
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
  return { subtotal, fee, discount, total, feeKnown };
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

  if (Number(coupon.linked_promotion_id || 0) > 0) {
    const promotionAlreadyApplied = cart.some(item => Number(item.promotion_id || 0) === Number(coupon.linked_promotion_id || 0));
    if (promotionAlreadyApplied) {
      return { valid: false, reason: 'Essa promoção já está aplicada no carrinho' };
    }
  }

  if (currentUser?.id) {
    const maxPerUser = Number(coupon.per_user_limit || 1) > 0 ? Number(coupon.per_user_limit || 1) : 1;
    const { count, error: usageErr } = await supabaseClient
      .from('pedidos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', currentUser.id)
      .eq('coupon_code', code);
    if (!usageErr && Number(count || 0) >= maxPerUser) {
      return { valid: false, reason: 'Você já utilizou este cupom e não pode usar novamente' };
    }
  }

  if (!silent) $('cartCouponStatus').textContent = `Cupom aplicado: ${code}`;
  return { valid: true, coupon };
}

async function applyCouponFromInput() {
  if (appliedCoupon?.code) {
    showToast('Já existe um cupom aplicado neste carrinho', 'info');
    $('cartCouponStatus').textContent = `Cupom ${appliedCoupon.code} ativo`;
    return;
  }

  const code = normalizeCouponCode($('couponInput').value);
  const result = await validateCouponCode(code);
  if (!result.valid) {
    showToast(result.reason || 'Cupom inválido', 'error');
    $('cartCouponStatus').textContent = result.reason || 'Cupom inválido';
    return;
  }

  appliedCoupon = result.coupon;
  $('couponInput').value = appliedCoupon.code;
  $('couponInput').readOnly = true;
  $('couponInput').disabled = true;
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
  const itemsTotal = Math.max(0, subtotal - discount);

  $('couponInput').readOnly = Boolean(appliedCoupon?.code);
  $('couponInput').disabled = Boolean(appliedCoupon?.code);
  $('btnApplyCoupon').classList.toggle('hidden', Boolean(appliedCoupon?.code));
  $('btnRemoveCoupon').classList.toggle('hidden', !appliedCoupon?.code);

  // Badges
  animateBadge($('cartBadgeMenu'), count);
  animateBadge($('fabCartBadge'), count);
  animateValue($('fabCartTotal'), formatMoney(total));
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
          <div class="cart-item__price">${Number(item.original_price || 0) > Number(item.preco || 0) ? `<span style="text-decoration:line-through;opacity:.65;margin-right:6px;">${formatMoney(item.original_price)}</span>` : ''}${formatMoney(item.preco)}</div>
          <div class="cart-item__controls">
            <button class="cart-item__qty-btn ${item.qty === 1 ? 'cart-item__qty-btn--remove' : ''}" data-id="${item.id}" data-action="minus">
              <i class="fas ${item.qty === 1 ? 'fa-trash-alt' : 'fa-minus'}"></i>
            </button>
            <span class="cart-item__qty value-pop">${item.qty}</span>
            <button class="cart-item__qty-btn" data-id="${item.id}" data-action="plus"><i class="fas fa-plus"></i></button>
          </div>
        </div>
        <span class="cart-item__total value-pop">${formatMoney(item.preco * item.qty)}</span>
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
  animateValue($('cartSubtotal'), formatMoney(subtotal));
  if (pricing.feeKnown) {
    $('cartDelivery').textContent = formatMoney(fee);
    $('cartDelivery').style.color = '';
  } else {
    $('cartDelivery').textContent = 'Informe o bairro';
    $('cartDelivery').style.color = 'var(--text-muted)';
  }
  $('cartDiscount').textContent = '- ' + formatMoney(discount);
  $('cartDiscountLine').classList.toggle('hidden', discount <= 0);
  animateValue($('cartTotal'), formatMoney(total));

  const blockedItem = cart.find(item => Boolean(getCartItemBlockedReason(item)));

  if (blockedItem) {
    const reason = getCartItemBlockedReason(blockedItem) || 'Indisponível agora';
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

// --- Cart scroll indicators ---
(function() {
  const scrollEl = $('cartScroll');
  const hintTop = $('cartScrollTop');
  const hintBottom = $('cartScrollBottom');
  if (!scrollEl || !hintTop || !hintBottom) return;

  function updateScrollHints() {
    const { scrollTop, scrollHeight, clientHeight } = scrollEl;
    const canScroll = scrollHeight > clientHeight + 5;
    hintTop.classList.toggle('visible', canScroll && scrollTop > 10);
    hintBottom.classList.toggle('visible', canScroll && scrollTop + clientHeight < scrollHeight - 10);
  }

  scrollEl.addEventListener('scroll', updateScrollHints, { passive: true });
  const obs = new MutationObserver(updateScrollHints);
  obs.observe(scrollEl, { childList: true, subtree: true });
  window.addEventListener('resize', updateScrollHints);
  // Run on cart open
  const origOpen = openCart;
  openCart = function() { origOpen(); setTimeout(updateScrollHints, 50); };
})();

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
    updateDeliveryFeePreview();
    updateCartUI();
  });
});

$('addrBairro')?.addEventListener('input', () => {
  updateDeliveryFeePreview();
  updateCartUI();
});

$('addrBairro')?.addEventListener('change', () => {
  updateDeliveryFeePreview();
  updateCartUI();
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
  if (addr.cep) $('addrCep').value = addr.cep;
  if (addr.street) $('addrStreet').value = addr.street;
  if (addr.number) $('addrNumber').value = addr.number;
  if (addr.comp) $('addrComp').value = addr.comp;
  if (addr.bairro) $('addrBairro').value = addr.bairro;
  updateDeliveryFeePreview();
}

// CEP Lookup via ViaCEP (#15)
async function lookupCep(cep) {
  const clean = cep.replace(/\D/g, '');
  if (clean.length !== 8) return;
  const hint = $('addrCepHint');
  if (hint) hint.textContent = 'buscando...';
  try {
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    const data = await res.json();
    if (data.erro) { if (hint) hint.textContent = 'CEP não encontrado'; return; }
    if (data.logradouro) $('addrStreet').value = data.logradouro;
    if (data.bairro) { $('addrBairro').value = data.bairro; updateDeliveryFeePreview(); }
    if (hint) hint.textContent = '✓';
    $('addrNumber')?.focus();
  } catch (_) {
    if (hint) hint.textContent = 'Erro ao buscar';
  }
}

$('btnBuscarCep')?.addEventListener('click', () => {
  lookupCep($('addrCep')?.value || '');
});
$('addrCep')?.addEventListener('input', (e) => {
  // Auto-formatar CEP
  let v = e.target.value.replace(/\D/g, '');
  if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5, 8);
  e.target.value = v;
});
$('addrCep')?.addEventListener('blur', (e) => {
  if (e.target.value.replace(/\D/g, '').length === 8) lookupCep(e.target.value);
});

async function saveAddressToUser() {
  if (!currentUser || !$('addrSave').checked) return;
  const addr = {
    cep: $('addrCep')?.value?.trim() || '',
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

  const blockedCartItem = cart.find(item => Boolean(getCartItemBlockedReason(item)));
  if (blockedCartItem) {
    const reason = getCartItemBlockedReason(blockedCartItem) || 'Indisponível agora';
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
      itens: cart.map(c => ({ id: c.id, nome: c.nome, preco: c.preco, qty: c.qty, original_price: c.original_price || null, promotion_id: c.promotion_id || null, product_ids: c.product_ids || [] })),
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
      itens: cart.map(c => ({ id: c.id, nome: c.nome, preco: c.preco, qty: c.qty, original_price: c.original_price || null, promotion_id: c.promotion_id || null, product_ids: c.product_ids || [] })),
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
  // Validar formato de telefone brasileiro
  const phoneClean = phone.replace(/\D/g, '');
  if (phoneClean.length < 10 || phoneClean.length > 11) {
    showToast('Telefone inválido. Use o formato (00) 00000-0000', 'error'); return;
  }
  if (password !== passwordConfirm) { showToast('As senhas não coincidem', 'error'); return; }
  if (password.length < 6) { showToast('Senha deve ter no mínimo 6 caracteres', 'error'); return; }

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email, password,
      options: { data: { name, phone } }
    });
    if (error) throw error;
    // Mostrar mensagem de confirmação de e-mail
    const confirmMsg = $('cadastroConfirmMsg');
    if (confirmMsg) {
      confirmMsg.textContent = '✅ Conta criada! Verifique seu e-mail para confirmar o cadastro antes de fazer login.';
      confirmMsg.classList.remove('hidden');
    }
    // Só faz login automático se e-mail já confirmado (Supabase email confirmation desativado)
    if (data.user && data.session) {
      currentUser = data.user;
      await checkAdminStatus(currentUser);
      closeModal('loginModal');
      updateAuthUI();
      fillAddressFromUser();
    }
    showToast('Conta criada! Verifique seu e-mail.', 'success');
  } catch (err) {
    showToast(err.message || 'Erro ao criar conta', 'error');
  }
});

// Forgot Password (#16)
$('btnForgotPassword')?.addEventListener('click', async () => {
  const email = $('loginEmail').value.trim();
  const msgEl = $('forgotPasswordMsg');
  if (!email) { showToast('Digite seu e-mail acima primeiro', 'error'); return; }
  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname + '?reset=1'
    });
    if (error) throw error;
    if (msgEl) {
      msgEl.textContent = '📧 Link de redefinição enviado para ' + email + '. Verifique sua caixa de entrada.';
      msgEl.classList.remove('hidden');
    }
    showToast('E-mail de redefinição enviado!', 'success');
  } catch (err) {
    showToast(err.message || 'Erro ao enviar e-mail', 'error');
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
    if (isSupabaseNetworkError(err)) {
      clearSupabaseAuthCache('falha de rede ao validar sessao');
    }
  }
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    const prevUser = currentUser?.id;
    currentUser = session?.user || null;
    if (currentUser?.id !== prevUser) {
      await checkAdminStatus(currentUser);
      updateAuthUI();
      // Iniciar realtime de pedidos para cliente logado (#13)
      if (currentUser) startClientOrderRealtime(currentUser.id);
    }
  });
}

// Realtime — cliente acompanha status do próprio pedido (#13)
let _clientOrderChannel = null;
function startClientOrderRealtime(userId) {
  if (_clientOrderChannel) {
    supabaseClient.removeChannel(_clientOrderChannel);
  }
  _clientOrderChannel = supabaseClient
    .channel(`client_orders_${userId}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'pedidos',
      filter: `user_id=eq.${userId}`
    }, (payload) => {
      const statusLabels = {
        pendente: 'Pedido recebido ⏳',
        confirmado: 'Pedido confirmado ✅',
        preparando: 'Preparando seu pedido 👨‍🍳',
        saiu_entrega: 'Saiu para entrega 🛵',
        entregue: 'Pedido entregue! 🎉',
        cancelado: 'Pedido cancelado ❌'
      };
      const msg = statusLabels[payload.new?.status] || `Status: ${payload.new?.status}`;
      showToast(`Pedido #${payload.new?.id} — ${msg}`, 'success');
      // Atualiza lista de pedidos se modal aberto
      if (!$('ordersModal')?.classList.contains('hidden')) loadOrders();
    })
    .subscribe();
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

async function getPromotionProductsForSchedule(promo) {
  const selectedIds = getPromotionSelectedIds(promo);
  if (!selectedIds.length) return [];

  const localMap = new Map(products.map(item => [Number(item.id), item]));
  const missingIds = selectedIds.filter(id => !localMap.has(Number(id)));

  if (missingIds.length) {
    try {
      const { data, error } = await supabaseClient
        .from('produtos')
        .select('id,nome,categoria,disponivel,preco,midias,midias_types')
        .in('id', missingIds);
      if (!error && Array.isArray(data)) {
        data.forEach(item => {
          localMap.set(Number(item.id), item);
          if (!products.some(p => Number(p.id) === Number(item.id))) {
            products.push(item);
          }
        });
      }
    } catch (_) {
      // Keep local cache fallback only.
    }
  }

  return selectedIds
    .map(id => localMap.get(Number(id)))
    .filter(Boolean);
}

async function matchesPromotionSchedule(promo) {
  const promoProducts = await getPromotionProductsForSchedule(promo);
  if (!promoProducts.length) return true;

  const schedule = getScheduleContext();
  if (!schedule.dayOpen || schedule.inBreak || !schedule.activePeriod) return false;

  // Only block by period/category rules. If a category is not explicitly mapped
  // in lunch/dinner config, keep promotion eligible.
  return promoProducts.every(product => {
    const category = String(product?.categoria || '').toLowerCase().trim();
    if (!category) return true;

    const inLunchCatalog = schedule.lunch.categories.has(category);
    const inDinnerCatalog = schedule.dinner.categories.has(category);
    if (!inLunchCatalog && !inDinnerCatalog) return true;

    return schedule.activePeriod.categories.has(category);
  });
}

function isPromotionCooldownOver(promo) {
  const lastClosed = Number(localStorage.getItem(`cjs_promo_closed_${promo.id}`) || '0');
  const cooldownMinutes = Number(promo.cooldown_minutes || 0);
  if (!cooldownMinutes || !lastClosed) return true;

  const promoVersionMs = new Date(promo.updated_at || promo.created_at || 0).getTime();
  if (promoVersionMs && promoVersionMs > lastClosed) return true;

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

  consumedPromotionIds.add(Number(promotionId));
  localStorage.setItem(`cjs_promo_consumed_${promotionId}`, '1');
  if (coupon?.code) {
    usedCouponCodes.add(String(coupon.code).trim().toUpperCase());
  }
}

async function ensureConsumedPromotionCache() {
  if (!currentUser?.id) {
    consumedPromotionUserId = null;
    consumedPromotionIds = new Set();
    return;
  }

  if (consumedPromotionUserId === currentUser.id) return;

  consumedPromotionUserId = currentUser.id;
  consumedPromotionIds = new Set();

  try {
    const { data, error } = await supabaseClient
      .from('promotion_popup_events')
      .select('promotion_id')
      .eq('user_id', currentUser.id)
      .eq('event_type', 'conversion');
    if (!error) {
      (data || []).forEach(row => {
        const promoId = Number(row?.promotion_id || 0);
        if (promoId > 0) {
          consumedPromotionIds.add(promoId);
          localStorage.setItem(`cjs_promo_consumed_${promoId}`, '1');
        }
      });
    }
  } catch (_) {
    // no-op
  }
}

async function ensureUsedCouponCodesCache() {
  if (!currentUser?.id) {
    usedCouponCodesUserId = null;
    usedCouponCodes = new Set();
    return;
  }

  if (usedCouponCodesUserId === currentUser.id) return;

  usedCouponCodesUserId = currentUser.id;
  usedCouponCodes = new Set();

  try {
    const { data, error } = await supabaseClient
      .from('pedidos')
      .select('coupon_code')
      .eq('user_id', currentUser.id)
      .not('coupon_code', 'is', null);
    if (!error) {
      (data || []).forEach(row => {
        const code = String(row?.coupon_code || '').trim().toUpperCase();
        if (code) usedCouponCodes.add(code);
      });
    }
  } catch (_) {
    // no-op
  }
}

async function hasUserConsumedPromotion(promo) {
  const promoId = Number(promo?.id || 0);
  const localConsumed = promoId > 0 && localStorage.getItem(`cjs_promo_consumed_${promoId}`) === '1';
  if (localConsumed) return true;

  await ensureConsumedPromotionCache();
  await ensureUsedCouponCodesCache();

  if (promoId > 0 && consumedPromotionIds.has(promoId)) return true;

  const promoCouponCode = String(promo?.coupon_code || '').trim().toUpperCase();
  if (promoCouponCode && usedCouponCodes.has(promoCouponCode)) return true;

  return false;
}

function renderPromotionPopup(promo) {
  activePromotion = promo;
  $('promoPopupTitle').textContent = promo.title || promo.name || 'Promoção especial';
  $('promoPopupDescription').textContent = promo.description || 'Oferta por tempo limitado.';

  const selectedProducts = getPromotionSelectedIds(promo)
    .map(id => products.find(item => Number(item.id) === Number(id)))
    .filter(Boolean);
  const popupItems = $('promoPopupItems');
  if (selectedProducts.length > 1) {
    const names = selectedProducts.slice(0, 3).map(item => item.nome).join(' · ');
    const extra = selectedProducts.length > 3 ? ` +${selectedProducts.length - 3}` : '';
    popupItems.textContent = `Kit da oferta: ${names}${extra}`;
    popupItems.classList.remove('hidden');
  } else if (selectedProducts.length === 1) {
    popupItems.textContent = `Item da oferta: ${selectedProducts[0].nome}`;
    popupItems.classList.remove('hidden');
  } else {
    popupItems.textContent = '';
    popupItems.classList.add('hidden');
  }

  const oldPrice = parsePriceValue(promo.original_price);
  const newPrice = parsePriceValue(promo.promo_price);
  const hasFixedPromotionPrice = oldPrice > 0 && newPrice > 0 && newPrice < oldPrice;
  $('promoPopupOldPrice').textContent = oldPrice > 0 ? formatMoney(oldPrice) : '';
  $('promoPopupNewPrice').textContent = newPrice > 0 ? formatMoney(newPrice) : 'Oferta ativa';

  const coupon = (promo.coupon_code || '').trim().toUpperCase();
  $('promoPopupCoupon').textContent = coupon || '-';
  $('promoPopupCouponBox').classList.toggle('hidden', !coupon);

  $('promoPopupRules').textContent = promo.rules || 'Consulte as regras no checkout.';
  $('promoPopupAction').textContent = hasFixedPromotionPrice ? 'Aproveitar oferta' : (promo.button_text || (newPrice > 0 ? 'Adicionar oferta' : 'Ver produto'));

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
      if (!(await matchesPromotionSchedule(promo))) continue;
      if (await hasUserConsumedPromotion(promo)) continue;
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
  applyContactLinks();
  await loadDeliveryZones();
  updateStatus();
  await initAuth();
  updateDeliveryFeePreview();
  updateCartUI();
  checkPaymentReturn();
})();

function applyContactLinks() {
  const instaUrl = runtimeConfig['instagram_url'];
  if (instaUrl) {
    document.querySelectorAll('a[aria-label="Instagram"], .footer__social a[href*="instagram"], .contact-list a[href*="instagram"]').forEach(a => {
      a.href = instaUrl;
    });
    const instaSpan = document.querySelector('.contact-list a[href*="instagram"] span');
    if (instaSpan) {
      try {
        const handle = new URL(instaUrl).pathname.replace(/\//g, '');
        if (handle) instaSpan.textContent = '@' + handle;
      } catch(e) {}
    }
  }

  const waNumber = runtimeConfig['whatsapp_number'];
  if (waNumber) {
    const clean = waNumber.replace(/\D/g, '');
    document.querySelectorAll('a[href*="wa.me"]').forEach(a => {
      a.href = 'https://wa.me/' + clean;
    });
  }

  const fbUrl = runtimeConfig['facebook_url'];
  if (fbUrl) {
    document.querySelectorAll('a[href*="facebook"]').forEach(a => {
      a.href = fbUrl;
    });
  }

  const emailVal = runtimeConfig['email'];
  if (emailVal) {
    document.querySelectorAll('a[href*="mailto:"]').forEach(a => {
      a.href = 'mailto:' + emailVal;
    });
  }
}


// === Admin module merged ===
;(() => { 
  const __IS_ADMIN_MODE = new URLSearchParams(window.location.search).get('admin') === '1'; 
  if (!__IS_ADMIN_MODE) return; 
// ==================== MÍDIAS PRODUTO ====================
window.productMidiasState = [];
function renderProductMidiasPreview() {
  const wrap = $('productMidiasPreview');
  if (!wrap) return;
  wrap.innerHTML = '';
  (window.productMidiasState || []).forEach((m, i) => {
    const el = document.createElement(m.type === 'video' ? 'video' : 'img');
    el.className = 'midias-thumb';
    el.src = m.url;
    if (m.type === 'video') {
      el.muted = true; el.playsInline = true; el.controls = true; el.style.maxHeight = '80px';
    }
    el.title = m.url;
    el.style.cursor = 'pointer';
    el.onclick = () => window.open(m.url, '_blank');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'midias-thumb-del';
    del.innerHTML = '<i class="fas fa-trash"></i>';
    del.onclick = (ev) => { ev.stopPropagation(); window.productMidiasState.splice(i, 1); renderProductMidiasPreview(); };
    const box = document.createElement('div');
    box.className = 'midias-thumb-box';
    box.appendChild(el);
    box.appendChild(del);
    wrap.appendChild(box);
  });
  // TODO: Drag and drop reordering (opcional)
}
window.renderProductMidiasPreview = renderProductMidiasPreview;
// ============================================================
//  ADMIN PANEL — Casa José Silva
// ============================================================

const SUPABASE_URL = 'https://uufzqceljdkrnpgjotxw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1ZnpxY2VsamRrcm5wZ2pvdHh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MzIzMjUsImV4cCI6MjA4OTAwODMyNX0.lDBwSOYlF3SlMKblt2WsHo7rdVcZ-wXgjJolD41cNfk';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const SUPABASE_PROJECT_REF = (() => {
  try {
    return new URL(SUPABASE_URL).hostname.split('.')[0] || '';
  } catch (_) {
    return '';
  }
})();
const SUPABASE_AUTH_STORAGE_KEY = SUPABASE_PROJECT_REF ? `sb-${SUPABASE_PROJECT_REF}-auth-token` : '';

function isSupabaseNetworkError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('err_name_not_resolved');
}

function clearSupabaseAuthCache(reason) {
  if (!SUPABASE_AUTH_STORAGE_KEY) return;
  localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
  console.warn(`[Supabase][Admin] Sessao local removida: ${reason}`);
}

// ---------- State ----------
let adminUser = null;
let allOrders = [];
let allProducts = [];
let configData = {};
let revenueChart = null;
let statusChart = null;
let hourlyOrdersChart = null;
let deliveryTypesChart = null;
let weekdayOrdersChart = null;
let revenueCumulativeChart = null;
let paymentMethodsChart = null;
const RESTAURANT_LAT = -23.6912;
const RESTAURANT_LNG = -46.5305;
const ZONE_COLORS = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4', '#FF5722', '#607D8B'];
let deliveryZones = [];
let allPromotions = [];
let deliveryMap = null;
let deliveryMapCircles = [];
let deliveryMapMarker = null;
let orderAgeTimer = null;
let tableOrderDraftItems = [];
let promotionProductsCatalog = [];
let selectedPromotionProductIds = [];
const ORDER_ACTED_STORAGE_KEY = 'cjs_admin_orders_acted_v1';
let actedOrderIds = loadActedOrderIds();
let responsiveTablesObserver = null;

function loadActedOrderIds() {
  try {
    const raw = localStorage.getItem(ORDER_ACTED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(v => Number(v)).filter(v => Number.isFinite(v));
  } catch (_) {
    return [];
  }
}

function saveActedOrderIds() {
  localStorage.setItem(ORDER_ACTED_STORAGE_KEY, JSON.stringify(actedOrderIds));
}

function markOrderAsActed(orderId) {
  if (actedOrderIds.includes(orderId)) return;
  actedOrderIds.push(orderId);
  saveActedOrderIds();
}

function isOrderNew(order) {
  return order?.status === 'pendente' && !actedOrderIds.includes(Number(order.id));
}

function formatOrderAge(createdAt) {
  if (!createdAt) return '--';
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return '--';
  const diffMs = Math.max(0, Date.now() - createdMs);
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}min`;
  if (mins <= 0) return 'agora';
  return `${mins} min`;
}

function getOrderAgeLevel(createdAt, status) {
  if (!createdAt || status === 'entregue' || status === 'cancelado') return 'done';
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const mins = diffMs / 60000;
  if (mins >= 45) return 'danger';
  if (mins >= 25) return 'warn';
  return 'ok';
}

function updateOrderAges() {
  document.querySelectorAll('[data-order-created-at]').forEach(el => {
    const createdAt = el.dataset.orderCreatedAt;
    const status = el.dataset.orderStatus || '';
    el.textContent = formatOrderAge(createdAt);
    el.className = `order-age order-age--${getOrderAgeLevel(createdAt, status)}`;
  });
}

function ensureOrderAgeTimer() {
  if (orderAgeTimer) return;
  orderAgeTimer = setInterval(updateOrderAges, 30000);
}

// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ============================================================
//  AUTH 
// ============================================================
$('adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('adminEmail').value.trim();
  const password = $('adminPassword').value;
  $('loginError').classList.add('hidden');

  try {
    // Sign in with Supabase Auth
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // Check if user is admin
    const { data: adminRow, error: adminErr } = await sb
      .from('admin_users')
      .select('*')
      .eq('email', email)
      .single();
    if (adminErr || !adminRow) {
      await sb.auth.signOut();
      throw new Error('Acesso negado. Você não é administrador.');
    }

    // Auto-link auth_user_id if missing
    if (!adminRow.auth_user_id) {
      await sb.from('admin_users')
        .update({ auth_user_id: data.user.id })
        .eq('email', email);
      adminRow.auth_user_id = data.user.id;
    }

    adminUser = { ...data.user, adminInfo: adminRow };
    showAdmin();
  } catch (err) {
    $('loginError').textContent = err.message || 'Erro ao fazer login';
    $('loginError').classList.remove('hidden');
  }
});

$('btnAdminLogout').addEventListener('click', async () => {
  await sb.auth.signOut();
  adminUser = null;
  $('adminPanel').classList.add('hidden');
  $('loginPage').classList.remove('hidden');
});

// Check existing session
async function checkSession() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      const { data: adminRow } = await sb
        .from('admin_users')
        .select('*')
        .eq('email', session.user.email)
        .single();
      if (adminRow) {
        // Auto-link auth_user_id if missing
        if (!adminRow.auth_user_id) {
          await sb.from('admin_users')
            .update({ auth_user_id: session.user.id })
            .eq('email', session.user.email);
          adminRow.auth_user_id = session.user.id;
        }
        adminUser = { ...session.user, adminInfo: adminRow };
        showAdmin();
      }
    }
  } catch (err) {
    console.error('[Admin Auth] Erro ao verificar sessao:', err?.message || err);
    if (isSupabaseNetworkError(err)) {
      clearSupabaseAuthCache('falha de rede ao validar sessao');
    }
  }
}

function showAdmin() {
  $('loginPage').classList.add('hidden');
  $('adminPanel').classList.remove('hidden');
  $('adminUserInfo').textContent = adminUser.adminInfo?.nome || adminUser.email;
  $('currentDate').textContent = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  startResponsiveTableObserver();
  initDashboardControls();
  loadAdminLibs().then(() => loadDashboard());
  startAdminRealtime();
}

// Lazy-load Chart.js e Leaflet somente quando o admin abre (#5)
let _adminLibsLoaded = false;
function loadAdminLibs() {
  if (_adminLibsLoaded) return Promise.resolve();
  const loadScript = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return Promise.all([
    window.Chart ? Promise.resolve() : loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'),
    window.L     ? Promise.resolve() : loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js')
  ]).then(() => { _adminLibsLoaded = true; });
}

// Realtime — novos pedidos para o admin (#14)
let _adminRealtimeChannel = null;
let _adminOrderBadgeCount = 0;
function startAdminRealtime() {
  if (_adminRealtimeChannel) return;
  _adminRealtimeChannel = supabaseClient
    .channel('admin_orders_rt')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, (payload) => {
      _adminOrderBadgeCount++;
      const btn = document.querySelector('.nav-item[data-page="pedidos"]');
      if (btn) btn.setAttribute('data-badge', _adminOrderBadgeCount);
      showToast(`Novo pedido #${payload.new?.id || ''}!`, 'success');
      // Recarrega se na página de pedidos
      if (document.getElementById('pagePedidos')?.classList.contains('active')) {
        const orig = _adminOrderBadgeCount;
        loadOrders().then(() => { if (orig === _adminOrderBadgeCount) _adminOrderBadgeCount = 0; });
      }
    })
    .subscribe();
}

// Export CSV (#18)
function exportOrdersCSV() {
  if (!allOrders || !allOrders.length) { showToast('Nenhum pedido para exportar', 'error'); return; }
  const headers = ['#', 'Cliente', 'E-mail', 'Telefone', 'Itens', 'Total', 'Tipo Entrega', 'Pagamento', 'Status', 'Data'];
  const rows = allOrders.map(o => {
    const itens = Array.isArray(o.itens) ? o.itens.map(i => `${i.qty}x ${i.nome}`).join(' | ') : '';
    const dt = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR') : '';
    return [
      o.id, o.nome_cliente || '', o.email_cliente || '', o.telefone_cliente || '',
      `"${itens}"`, Number(o.total || 0).toFixed(2).replace('.', ','),
      o.tipo_entrega || '', o.forma_pagamento || '', o.status || '', dt
    ].join(';');
  });
  const csv = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `pedidos_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
document.addEventListener('click', (e) => {
  if (e.target.closest('#btnExportCSV')) exportOrdersCSV();
});

function hydrateResponsiveTables(root = document) {
  const tables = root.querySelectorAll('table.table');
  tables.forEach((table) => {
    const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim() || 'Info');
    if (!headers.length) return;

    table.classList.add('table--stack');

    table.querySelectorAll('tbody tr').forEach((row) => {
      const cells = [...row.children].filter(el => el.tagName === 'TD');
      cells.forEach((cell, index) => {
        cell.setAttribute('data-label', headers[index] || 'Info');
      });
    });
  });
}

function startResponsiveTableObserver() {
  if (responsiveTablesObserver) return;
  const panel = $('adminPanel');
  if (!panel) return;

  let rafId = null;
  const runHydration = () => {
    rafId = null;
    hydrateResponsiveTables(panel);
  };

  responsiveTablesObserver = new MutationObserver(() => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(runHydration);
  });

  responsiveTablesObserver.observe(panel, { childList: true, subtree: true });
  hydrateResponsiveTables(panel);
}

// ============================================================
//  NAVIGATION
// ============================================================
const pages = { dashboard: 'pageDashboard', pedidos: 'pagePedidos', cardapio: 'pageCardapio', clientes: 'pageClientes', entrega: 'pageEntrega', promocoes: 'pagePromocoes', config: 'pageConfig' };
const pageTitles = { dashboard: 'Dashboard', pedidos: 'Pedidos', cardapio: 'Cardápio', clientes: 'Clientes', entrega: 'Entrega', promocoes: 'Promoções', config: 'Configurações' };

$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const p = btn.dataset.page;
    $$('.page').forEach(pg => pg.classList.remove('active'));
    $(pages[p]).classList.add('active');
    $('pageTitle').textContent = pageTitles[p];
    // Load data for each page
    if (p === 'dashboard') loadDashboard();
    else if (p === 'pedidos') loadOrders();
    else if (p === 'cardapio') loadProducts();
    else if (p === 'clientes') loadClients();
    else if (p === 'entrega') loadDeliveryZones();
    else if (p === 'promocoes') loadPromotions();
    else if (p === 'config') loadConfig();
    // Close sidebar on mobile
    $('sidebar').classList.remove('open');
  });
});

$('btnHamburger').addEventListener('click', () => $('sidebar').classList.toggle('open'));

function initDashboardControls() {
  const preset = $('dashPeriodPreset');
  const start = $('dashPeriodStart');
  const end = $('dashPeriodEnd');
  const apply = $('btnApplyPeriod');
  if (!preset || !start || !end || !apply) return;
  if (preset.dataset.bound === '1') return;

  const toggleCustomInputs = () => {
    const custom = preset.value === 'custom';
    start.disabled = !custom;
    end.disabled = !custom;
  };

  preset.addEventListener('change', () => {
    toggleCustomInputs();
    if (preset.value !== 'custom') loadDashboard();
  });

  start.addEventListener('change', () => {
    if (preset.value === 'custom' && end.value) loadDashboard();
  });

  end.addEventListener('change', () => {
    if (preset.value === 'custom' && start.value) loadDashboard();
  });

  apply.addEventListener('click', loadDashboard);
  preset.dataset.bound = '1';
  toggleCustomInputs();
}

// Close modals
$$('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => $(btn.dataset.close).classList.add('hidden'));
});
$$('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.add('hidden'); });
});

// ============================================================
//  DASHBOARD
// ============================================================
function toLocalDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getDashboardRange() {
  const preset = $('dashPeriodPreset')?.value || '7d';
  const startInput = $('dashPeriodStart')?.value;
  const endInput = $('dashPeriodEnd')?.value;
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  let start = new Date(todayStart);
  let end = new Date(todayEnd);
  let label = 'Últimos 7 dias';

  if (preset === 'today') {
    label = 'Hoje';
  } else if (preset === '7d') {
    start.setDate(start.getDate() - 6);
    label = 'Últimos 7 dias';
  } else if (preset === '30d') {
    start.setDate(start.getDate() - 29);
    label = 'Últimos 30 dias';
  } else if (preset === 'this_month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    label = 'Este mês';
  } else if (preset === 'last_month') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    label = 'Mês passado';
  } else if (preset === 'custom' && startInput && endInput) {
    start = startOfDay(new Date(startInput));
    end = endOfDay(new Date(endInput));
    label = `${new Date(startInput).toLocaleDateString('pt-BR')} a ${new Date(endInput).toLocaleDateString('pt-BR')}`;
  } else {
    start.setDate(start.getDate() - 6);
    label = 'Últimos 7 dias';
  }

  if (start > end) {
    const copy = new Date(start);
    start = new Date(end);
    end = endOfDay(copy);
  }

  const duration = end.getTime() - start.getTime();
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - duration);
  return { start, end, previousStart, previousEnd, label };
}

function filterOrdersByRange(orders, start, end) {
  return orders.filter(o => {
    const d = new Date(o.created_at);
    if (Number.isNaN(d.getTime())) return false;
    return d >= start && d <= end;
  });
}

function calculateDashboardMetrics(orders) {
  const validOrders = orders.filter(o => o.status !== 'cancelado');
  const revenue = validOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const grossRevenue = orders.reduce((s, o) => s + Number(o.total || 0), 0);
  const deliveredCount = validOrders.filter(o => o.status === 'entregue').length;
  const canceledCount = orders.filter(o => o.status === 'cancelado').length;
  const orderCount = validOrders.length;
  return {
    revenue,
    grossRevenue,
    orderCount,
    avgTicket: orderCount ? revenue / orderCount : 0,
    deliveryRate: orders.length ? (deliveredCount / orders.length) * 100 : 0,
    cancelRate: orders.length ? (canceledCount / orders.length) * 100 : 0,
    activeClients: getActiveClientsCount(validOrders),
    peakHour: getPeakHour(validOrders)
  };
}

function getDeltaPercent(current, previous) {
  if (!previous && !current) return 0;
  if (!previous && current) return 100;
  return ((current - previous) / previous) * 100;
}

function applyDelta(el, value, inverse = false) {
  if (!el) return;
  el.classList.remove('delta--up', 'delta--down', 'delta--neutral');
  if (!Number.isFinite(value)) {
    el.textContent = '--';
    el.classList.add('delta--neutral');
    return;
  }

  const rounded = Number(value.toFixed(1));
  const formatted = `${rounded > 0 ? '+' : ''}${String(rounded).replace('.', ',')}%`;
  el.textContent = formatted;

  if (Math.abs(rounded) < 0.1) {
    el.classList.add('delta--neutral');
    return;
  }
  const positive = rounded > 0;
  if (inverse) el.classList.add(positive ? 'delta--down' : 'delta--up');
  else el.classList.add(positive ? 'delta--up' : 'delta--down');
}

async function loadDashboard() {
  await loadAdminLibs();
  try {
    const { data: orders } = await sb.from('pedidos').select('*').order('created_at', { ascending: false });
    allOrders = orders || [];
    const range = getDashboardRange();
    const ordersInPeriod = filterOrdersByRange(allOrders, range.start, range.end);
    const previousOrders = filterOrdersByRange(allOrders, range.previousStart, range.previousEnd);

    const current = calculateDashboardMetrics(ordersInPeriod);
    const previous = calculateDashboardMetrics(previousOrders);

    $('kpiRevenueToday').textContent = formatMoney(current.revenue);
    $('kpiOrdersToday').textContent = current.orderCount;
    $('kpiAvgTicket').textContent = formatMoney(current.avgTicket);
    $('kpiRevenueMonth').textContent = formatMoney(current.grossRevenue);
    $('kpiDeliveryRate').textContent = formatPercent(current.deliveryRate);
    $('kpiCancelRate').textContent = formatPercent(current.cancelRate);
    $('kpiActiveClientsMonth').textContent = current.activeClients;
    $('kpiPeakHour').textContent = current.peakHour;
    $('kpiPeriodLabel').textContent = range.label;

    applyDelta($('cmpRevenue'), getDeltaPercent(current.revenue, previous.revenue));
    applyDelta($('cmpOrders'), getDeltaPercent(current.orderCount, previous.orderCount));
    applyDelta($('cmpAvgTicket'), getDeltaPercent(current.avgTicket, previous.avgTicket));
    applyDelta($('cmpCancelRate'), getDeltaPercent(current.cancelRate, previous.cancelRate), true);

    renderRevenueChart(ordersInPeriod, range.start, range.end);
    renderStatusChart(ordersInPeriod);
    renderHourlyOrdersChart(ordersInPeriod);
    renderDeliveryTypesChart(ordersInPeriod);
    renderStatusSummary(ordersInPeriod);
    renderWeekdayOrdersChart(ordersInPeriod);
    renderCumulativeRevenueChart(ordersInPeriod, range.start, range.end);
    renderPaymentMethodsChart(ordersInPeriod);
    renderTopProducts(ordersInPeriod);
    renderTopClients(ordersInPeriod);
    renderBusinessInsights(ordersInPeriod, previousOrders, current, previous);
    renderRecentOrders(ordersInPeriod.slice(0, 10));
    await loadPromotionPerformance(range.start, range.end);
  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

function renderRevenueChart(orders, rangeStart, rangeEnd) {
  const canvas = $('chartRevenue');
  if (!canvas) return;
  const labels = [];
  const data = [];

  const cursor = startOfDay(rangeStart);
  const limit = endOfDay(rangeEnd);
  while (cursor <= limit) {
    const key = toLocalDateKey(cursor);
    labels.push(cursor.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' }));
    const dayOrders = orders.filter(o => o.created_at?.startsWith(key) && o.status !== 'cancelado');
    data.push(dayOrders.reduce((s, o) => s + Number(o.total || 0), 0));
    cursor.setDate(cursor.getDate() + 1);
  }

  if (revenueChart) revenueChart.destroy();
  revenueChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Faturamento (R$)',
        data,
        backgroundColor: 'rgba(212,175,55,.6)',
        borderColor: 'rgba(212,175,55,1)',
        borderWidth: 1, borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderStatusChart(orders) {
  const canvas = $('chartStatus');
  const statusCounts = {};
  const statusLabels = { pendente: 'Pendente', confirmado: 'Confirmado', preparando: 'Preparando', saiu_entrega: 'Saiu Entrega', entregue: 'Entregue', cancelado: 'Cancelado' };
  const colors = { pendente: '#FF9800', confirmado: '#2196F3', preparando: '#FFC107', saiu_entrega: '#4CAF50', entregue: '#1B5E20', cancelado: '#E53935' };

  orders.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });

  if (statusChart) statusChart.destroy();
  statusChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: Object.keys(statusCounts).map(k => statusLabels[k] || k),
      datasets: [{ data: Object.values(statusCounts), backgroundColor: Object.keys(statusCounts).map(k => colors[k] || '#999'), borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 11 } } } } }
  });
}

function renderRecentOrders(orders) {
  const tbody = $('recentOrdersBody');
  if (!orders.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;padding:20px;">Nenhum pedido</td></tr>'; return; }
  tbody.innerHTML = orders.map(o => `
    <tr>
      <td><strong>#${o.id}</strong></td>
      <td>${escapeHtml(o.nome_cliente || 'N/A')}</td>
      <td><strong>${formatMoney(o.total)}</strong></td>
      <td><span class="badge badge--${o.status}">${statusLabel(o.status)}</span></td>
      <td>${formatDate(o.created_at)}</td>
    </tr>
  `).join('');
}

async function loadPromotionPerformance(start, end) {
  const tbody = $('promotionPerfBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:14px;"><i class="fas fa-spinner fa-spin"></i></td></tr>';

  try {
    const [{ data: events, error: eventsErr }, { data: promotions, error: promoErr }] = await Promise.all([
      sb
        .from('promotion_popup_events')
        .select('promotion_id,event_type,created_at')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString()),
      sb
        .from('promotion_popups')
        .select('id,name')
    ]);

    if (eventsErr) throw eventsErr;
    if (promoErr) throw promoErr;

    const promotionMap = new Map((promotions || []).map(p => [Number(p.id), p.name || `Promoção #${p.id}`]));
    const metrics = new Map();

    (events || []).forEach(evt => {
      const promoId = Number(evt.promotion_id || 0);
      if (!promoId) return;
      if (!metrics.has(promoId)) {
        metrics.set(promoId, { views: 0, clicks: 0, conversions: 0 });
      }
      const record = metrics.get(promoId);
      if (evt.event_type === 'view') record.views += 1;
      if (evt.event_type === 'click') record.clicks += 1;
      if (evt.event_type === 'conversion') record.conversions += 1;
    });

    if (!metrics.size) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:16px;">Sem eventos de popup no período</td></tr>';
      return;
    }

    const rows = [...metrics.entries()]
      .map(([id, m]) => ({
        id,
        name: promotionMap.get(id) || `Promoção #${id}`,
        ...m,
        ctr: m.views ? (m.clicks / m.views) * 100 : 0,
        cvr: m.clicks ? (m.conversions / m.clicks) * 100 : 0
      }))
      .sort((a, b) => b.conversions - a.conversions || b.clicks - a.clicks);

    tbody.innerHTML = rows.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.name)}</strong></td>
        <td>${row.views}</td>
        <td>${row.clicks}</td>
        <td>${row.conversions}</td>
        <td>${formatPercent(row.ctr)}</td>
        <td>${formatPercent(row.cvr)}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Promotion performance error:', err);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#E53935;padding:16px;">Erro ao carregar performance de promoções</td></tr>';
  }
}

function getActiveClientsCount(orders) {
  const keys = new Set();
  orders.forEach(o => {
    const k = (o.email_cliente || o.telefone_cliente || o.nome_cliente || '').trim().toLowerCase();
    if (k) keys.add(k);
  });
  return keys.size;
}

function getPeakHour(orders) {
  if (!orders.length) return '--:--';
  const hours = new Array(24).fill(0);
  orders.forEach(o => {
    const d = new Date(o.created_at);
    if (!Number.isNaN(d.getTime())) hours[d.getHours()] += 1;
  });
  const max = Math.max(...hours);
  if (max <= 0) return '--:--';
  const idx = hours.findIndex(v => v === max);
  return `${String(idx).padStart(2, '0')}:00`;
}

function renderHourlyOrdersChart(orders) {
  const canvas = $('chartHourlyOrders');
  if (!canvas) return;
  const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}h`);
  const data = new Array(24).fill(0);
  orders.forEach(o => {
    const d = new Date(o.created_at);
    if (!Number.isNaN(d.getTime())) data[d.getHours()] += 1;
  });
  if (hourlyOrdersChart) hourlyOrdersChart.destroy();
  hourlyOrdersChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Pedidos',
        data,
        borderColor: 'rgba(33,150,243,1)',
        backgroundColor: 'rgba(33,150,243,.12)',
        tension: .3,
        fill: true,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

function renderDeliveryTypesChart(orders) {
  const canvas = $('chartDeliveryTypes');
  if (!canvas) return;
  const counts = { delivery: 0, retirada: 0, mesa: 0, outro: 0 };
  orders.forEach(o => {
    const key = (o.forma_entrega || '').toLowerCase();
    if (key in counts) counts[key] += 1;
    else counts.outro += 1;
  });
  if (deliveryTypesChart) deliveryTypesChart.destroy();
  deliveryTypesChart = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: ['Delivery', 'Retirada', 'Mesa', 'Outros'],
      datasets: [{
        data: [counts.delivery, counts.retirada, counts.mesa, counts.outro],
        backgroundColor: ['#4CAF50', '#2196F3', '#FF9800', '#9E9E9E'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 11 } } } }
    }
  });
}

function renderWeekdayOrdersChart(orders) {
  const canvas = $('chartWeekdayOrders');
  if (!canvas) return;
  const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
  const data = new Array(7).fill(0);
  orders.forEach(o => {
    const d = new Date(o.created_at);
    if (!Number.isNaN(d.getTime())) data[d.getDay()] += 1;
  });

  if (weekdayOrdersChart) weekdayOrdersChart.destroy();
  weekdayOrdersChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Pedidos',
        data,
        backgroundColor: 'rgba(255, 152, 0, .6)',
        borderColor: 'rgba(255, 152, 0, 1)',
        borderWidth: 1,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

function renderCumulativeRevenueChart(orders, startDate, endDate) {
  const canvas = $('chartRevenueCumulative');
  if (!canvas) return;
  const labels = [];
  const data = [];

  let runningTotal = 0;
  const cursor = startOfDay(startDate);
  const limit = endOfDay(endDate);
  while (cursor <= limit) {
    const key = toLocalDateKey(cursor);
    const dayRevenue = orders
      .filter(o => o.created_at?.startsWith(key) && o.status !== 'cancelado')
      .reduce((acc, o) => acc + Number(o.total || 0), 0);
    runningTotal += dayRevenue;
    labels.push(cursor.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
    data.push(runningTotal);
    cursor.setDate(cursor.getDate() + 1);
  }

  if (revenueCumulativeChart) revenueCumulativeChart.destroy();
  revenueCumulativeChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Acumulado (R$)',
        data,
        borderColor: 'rgba(76, 175, 80, 1)',
        backgroundColor: 'rgba(76, 175, 80, .14)',
        fill: true,
        tension: .25,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderPaymentMethodsChart(orders) {
  const canvas = $('chartPaymentMethods');
  if (!canvas) return;
  const counts = {};
  orders.forEach(o => {
    const method = (o.forma_pagamento || 'não informado').trim().toLowerCase();
    counts[method] = (counts[method] || 0) + 1;
  });

  const entries = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const labels = entries.length
    ? entries.map(([name]) => name.replace(/\b\w/g, l => l.toUpperCase()))
    : ['Sem dados'];
  const data = entries.length ? entries.map(([, qty]) => qty) : [1];

  if (paymentMethodsChart) paymentMethodsChart.destroy();
  paymentMethodsChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: ['#8E24AA', '#43A047', '#1E88E5', '#FB8C00', '#546E7A', '#EC407A'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 11 } } } }
    }
  });
}

function renderStatusSummary(orders) {
  const target = $('statusSummary');
  if (!target) return;
  const labels = {
    pendente: 'Pendente',
    confirmado: 'Confirmado',
    preparando: 'Preparando',
    saiu_entrega: 'Saiu Entrega',
    entregue: 'Entregue',
    cancelado: 'Cancelado'
  };
  const counts = {};
  orders.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1; });
  const total = orders.length || 1;
  target.innerHTML = Object.keys(labels).map(key => {
    const qty = counts[key] || 0;
    const pct = ((qty / total) * 100).toFixed(1);
    return `
      <div class="status-summary__row">
        <span class="badge badge--${key}">${labels[key]}</span>
        <strong>${qty}</strong>
        <span class="status-summary__pct">${pct}%</span>
      </div>
    `;
  }).join('');
}

function renderTopProducts(orders) {
  const tbody = $('topProductsBody');
  if (!tbody) return;
  const acc = new Map();
  orders.forEach(o => {
    const items = Array.isArray(o.itens) ? o.itens : [];
    items.forEach(i => {
      const key = (i.nome || 'Item').trim();
      const prev = acc.get(key) || { qty: 0, revenue: 0 };
      const qty = Number(i.qty || 0);
      const price = Number(i.preco || 0);
      acc.set(key, { qty: prev.qty + qty, revenue: prev.revenue + (qty * price) });
    });
  });
  const top = [...acc.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5);
  if (!top.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#999;padding:16px;">Sem dados</td></tr>';
    return;
  }
  tbody.innerHTML = top.map(([name, v]) => `
    <tr>
      <td>${escapeHtml(name)}</td>
      <td>${v.qty}</td>
      <td><strong>${formatMoney(v.revenue)}</strong></td>
    </tr>
  `).join('');
}

function renderTopClients(orders) {
  const tbody = $('topClientsBody');
  if (!tbody) return;
  const acc = new Map();
  orders.forEach(o => {
    const key = (o.email_cliente || o.telefone_cliente || o.nome_cliente || 'Cliente').trim();
    const prev = acc.get(key) || { name: o.nome_cliente || key, count: 0, total: 0 };
    prev.count += 1;
    prev.total += Number(o.total || 0);
    acc.set(key, prev);
  });
  const top = [...acc.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  if (!top.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#999;padding:16px;">Sem dados</td></tr>';
    return;
  }
  tbody.innerHTML = top.map(c => `
    <tr>
      <td>${escapeHtml(c.name || 'Cliente')}</td>
      <td>${c.count}</td>
      <td><strong>${formatMoney(c.total)}</strong></td>
    </tr>
  `).join('');
}

function renderBusinessInsights(currentOrders, previousOrders, currentMetrics, previousMetrics) {
  const box = $('businessInsights');
  if (!box) return;

  const currentDeliveryOrders = currentOrders.filter(o => (o.forma_entrega || '').toLowerCase() === 'delivery').length;
  const deliveryShare = currentOrders.length ? (currentDeliveryOrders / currentOrders.length) * 100 : 0;
  const previousDeliveryOrders = previousOrders.filter(o => (o.forma_entrega || '').toLowerCase() === 'delivery').length;
  const previousDeliveryShare = previousOrders.length ? (previousDeliveryOrders / previousOrders.length) * 100 : 0;
  const deliveryDelta = getDeltaPercent(deliveryShare, previousDeliveryShare);

  const currentActiveClients = currentMetrics.activeClients;
  const previousActiveClients = previousMetrics.activeClients;
  const clientsDelta = getDeltaPercent(currentActiveClients, previousActiveClients);

  const list = [
    { label: 'Receita líquida', value: formatMoney(currentMetrics.revenue), delta: getDeltaPercent(currentMetrics.revenue, previousMetrics.revenue), inverse: false },
    { label: 'Participação Delivery', value: formatPercent(deliveryShare), delta: deliveryDelta, inverse: false },
    { label: 'Clientes ativos', value: String(currentActiveClients), delta: clientsDelta, inverse: false },
    { label: 'Taxa de cancelamento', value: formatPercent(currentMetrics.cancelRate), delta: getDeltaPercent(currentMetrics.cancelRate, previousMetrics.cancelRate), inverse: true }
  ];

  box.innerHTML = `<ul class="insights-list">${list.map(item => {
    const delta = Number.isFinite(item.delta) ? `${item.delta > 0 ? '+' : ''}${item.delta.toFixed(1).replace('.', ',')}%` : '--';
    const cls = !Number.isFinite(item.delta) || Math.abs(item.delta) < 0.1
      ? 'delta--neutral'
      : item.inverse
        ? (item.delta > 0 ? 'delta--down' : 'delta--up')
        : (item.delta > 0 ? 'delta--up' : 'delta--down');
    return `<li><span>${item.label}</span><strong>${item.value}</strong><span class="${cls}">${delta}</span></li>`;
  }).join('')}</ul>`;
}

// ============================================================
//  ORDERS PAGE
// ============================================================
$('btnRefreshOrders').addEventListener('click', loadOrders);
$('filterStatus').addEventListener('change', loadOrders);
$('filterDate').addEventListener('change', loadOrders);

$('btnNewTableOrder')?.addEventListener('click', openTableOrderModal);
$('btnAddTableItem')?.addEventListener('click', addItemToTableOrderDraft);
$('tableOrderForm')?.addEventListener('submit', createTableOrder);

const ORDER_STATUS_FLOW = ['pendente', 'confirmado', 'preparando', 'saiu_entrega', 'entregue', 'cancelado'];
const ORDER_STATUS_ICON = {
  pendente: 'fa-hourglass-half',
  confirmado: 'fa-check-circle',
  preparando: 'fa-pizza-slice',
  saiu_entrega: 'fa-motorcycle',
  entregue: 'fa-box-open',
  cancelado: 'fa-times-circle'
};

function getQuickStatusActions(status) {
  const map = {
    pendente: ['confirmado', 'cancelado'],
    confirmado: ['preparando', 'cancelado'],
    preparando: ['saiu_entrega', 'entregue', 'cancelado'],
    saiu_entrega: ['entregue', 'cancelado'],
    entregue: [],
    cancelado: ['pendente']
  };
  return map[status] || [];
}

function statusOptionsMarkup(currentStatus) {
  return ORDER_STATUS_FLOW.map(status =>
    `<option value="${status}" ${currentStatus === status ? 'selected' : ''}>${statusLabel(status)}</option>`
  ).join('');
}

function quickStatusButtonsMarkup(orderId, currentStatus) {
  const actions = getQuickStatusActions(currentStatus);
  if (!actions.length) return '<span class="status-hint">Sem ações rápidas</span>';
  return actions.map(status =>
    `<button class="status-quick" data-order-id="${orderId}" data-status="${status}" type="button"><i class="fas ${ORDER_STATUS_ICON[status] || 'fa-circle'} status-quick__icon"></i>${statusLabel(status)}</button>`
  ).join('');
}

function orderStatusCellMarkup(order) {
  const newBadge = isOrderNew(order) ? '<span class="badge badge--new" data-new-badge="1">Novo</span>' : '';
  const newClass = isOrderNew(order) ? ' order-status--new' : '';
  return `
    <div class="order-status${newClass}" data-order-id="${order.id}">
      <div class="order-status__badges">
        <span class="badge badge--${order.status} order-status__badge">${statusLabel(order.status)}</span>
        ${newBadge}
      </div>
      <span class="order-status__label">Ações rápidas</span>
      <div class="order-status__controls">${quickStatusButtonsMarkup(order.id, order.status)}</div>
      <select class="status-select" data-order-id="${order.id}">${statusOptionsMarkup(order.status)}</select>
    </div>
  `;
}

function bindOrderStatusEvents(tbody) {
  tbody.onchange = async (event) => {
    const select = event.target.closest('.status-select');
    if (!select) return;
    await updateOrderStatus(parseInt(select.dataset.orderId, 10), select.value, select);
  };

  tbody.onclick = async (event) => {
    const quickBtn = event.target.closest('.status-quick');
    if (!quickBtn) return;
    await updateOrderStatus(parseInt(quickBtn.dataset.orderId, 10), quickBtn.dataset.status, quickBtn);
  };
}

async function updateOrderStatus(orderId, newStatus, sourceEl) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order || order.status === newStatus) return;

  const oldStatus = order.status;
  const row = sourceEl?.closest('tr');
  const controls = row?.querySelectorAll('.status-select, .status-quick');

  controls?.forEach(el => { el.disabled = true; });
  if (row) row.classList.add('order-row--updating');

  order.status = newStatus;
  if (row) {
    const badge = row.querySelector('.order-status__badge');
    if (badge) {
      badge.className = `badge badge--${newStatus} order-status__badge`;
      badge.textContent = statusLabel(newStatus);
    }
    const quickWrap = row.querySelector('.order-status__controls');
    if (quickWrap) quickWrap.innerHTML = quickStatusButtonsMarkup(orderId, newStatus);
    const select = row.querySelector('.status-select');
    if (select) select.value = newStatus;
  }

  try {
    const { error } = await sb.from('pedidos').update({ status: newStatus }).eq('id', orderId);
    if (error) throw error;

    markOrderAsActed(orderId);
    if (row) {
      row.classList.remove('order-row--new');
      const statusBox = row.querySelector('.order-status');
      statusBox?.classList.remove('order-status--new');
      row.querySelector('[data-new-badge="1"]')?.remove();
      const ageEl = row.querySelector('[data-order-created-at]');
      if (ageEl) {
        ageEl.dataset.orderStatus = newStatus;
      }
    }
    updateOrderAges();

    showToast(`Pedido #${orderId}: ${statusLabel(oldStatus)} -> ${statusLabel(newStatus)}`, 'success');
    renderStatusChart(allOrders);
    renderRecentOrders(allOrders.slice(0, 10));
  } catch (err) {
    order.status = oldStatus;
    if (row) {
      const badge = row.querySelector('.order-status__badge');
      if (badge) {
        badge.className = `badge badge--${oldStatus} order-status__badge`;
        badge.textContent = statusLabel(oldStatus);
      }
      const quickWrap = row.querySelector('.order-status__controls');
      if (quickWrap) quickWrap.innerHTML = quickStatusButtonsMarkup(orderId, oldStatus);
      const select = row.querySelector('.status-select');
      if (select) select.value = oldStatus;
    }
    showToast('Erro ao atualizar status', 'error');
  } finally {
    controls?.forEach(el => { el.disabled = false; });
    if (row) row.classList.remove('order-row--updating');
  }
}

async function loadOrders() {
  const tbody = $('ordersTableBody');
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Carregando...</td></tr>';

  try {
    let query = sb.from('pedidos').select('*').order('created_at', { ascending: false });
    const status = $('filterStatus').value;
    const date = $('filterDate').value;
    if (status) query = query.eq('status', status);
    if (date) query = query.gte('created_at', date + 'T00:00:00').lte('created_at', date + 'T23:59:59');

    const { data, error } = await query;
    if (error) throw error;
    allOrders = data || [];

    if (!allOrders.length) {
      tbody.innerHTML = '';
      $('ordersEmpty').classList.remove('hidden');
      return;
    }
    $('ordersEmpty').classList.add('hidden');

    tbody.innerHTML = allOrders.map(o => {
      const items = Array.isArray(o.itens) ? o.itens.map(i => `${i.qty}x ${i.nome}`).join(', ') : '';
      const rowNewClass = isOrderNew(o) ? ' class="order-row--new"' : '';
      return `
        <tr data-order-id="${o.id}"${rowNewClass}>
          <td><strong>#${o.id}</strong></td>
          <td>${escapeHtml(o.nome_cliente || 'N/A')}</td>
          <td title="${escapeHtml(items)}">${escapeHtml(items.slice(0, 40))}${items.length > 40 ? '...' : ''}</td>
          <td><strong>${formatMoney(o.total)}</strong></td>
          <td>${escapeHtml(o.forma_entrega || 'delivery')}</td>
          <td>${orderStatusCellMarkup(o)}</td>
          <td>${formatDate(o.created_at)}</td>
          <td><span class="order-age" data-order-created-at="${escapeHtml(o.created_at || '')}" data-order-status="${escapeHtml(o.status || '')}"></span></td>
          <td><button class="btn btn--outline-sm btn--sm" onclick="viewOrder(${o.id})"><i class="fas fa-eye"></i></button></td>
        </tr>`;
    }).join('');
    bindOrderStatusEvents(tbody);
    updateOrderAges();
    ensureOrderAgeTimer();
  } catch (err) {
    console.error('Orders error:', err);
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#E53935;">Erro ao carregar pedidos</td></tr>';
  }
}

async function openTableOrderModal() {
  tableOrderDraftItems = [];
  $('tableOrderForm')?.reset();
  $('tableOrderQty').value = '1';
  await ensureTableOrderProductOptions();
  renderTableOrderDraft();
  $('tableOrderModal').classList.remove('hidden');
}

async function ensureTableOrderProductOptions() {
  if (!allProducts.length) {
    const { data, error } = await sb
      .from('produtos')
      .select('id, nome, preco, disponivel')
      .eq('disponivel', true)
      .order('nome');
    if (error) throw error;
    allProducts = data || [];
  }

  const select = $('tableOrderProduct');
  if (!select) return;
  const available = allProducts.filter(p => p.disponivel !== false);
  select.innerHTML = available.map(p =>
    `<option value="${p.id}">${escapeHtml(p.nome)} - ${formatMoney(p.preco)}</option>`
  ).join('');
}

function addItemToTableOrderDraft() {
  const select = $('tableOrderProduct');
  const qty = Math.max(1, parseInt($('tableOrderQty').value || '1', 10));
  const id = parseInt(select?.value || '0', 10);
  const product = allProducts.find(p => p.id === id);
  if (!product) {
    showToast('Selecione um item válido', 'error');
    return;
  }

  const existing = tableOrderDraftItems.find(i => i.id === id);
  if (existing) {
    existing.qty += qty;
  } else {
    tableOrderDraftItems.push({ id: product.id, nome: product.nome, preco: Number(product.preco || 0), qty });
  }
  $('tableOrderQty').value = '1';
  renderTableOrderDraft();
}

function updateTableOrderItemQty(id, delta) {
  const item = tableOrderDraftItems.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    tableOrderDraftItems = tableOrderDraftItems.filter(i => i.id !== id);
  }
  renderTableOrderDraft();
}

function removeTableOrderItem(id) {
  tableOrderDraftItems = tableOrderDraftItems.filter(i => i.id !== id);
  renderTableOrderDraft();
}

function renderTableOrderDraft() {
  const list = $('tableOrderItemsList');
  const totalEl = $('tableOrderTotal');
  if (!list || !totalEl) return;

  const total = tableOrderDraftItems.reduce((sum, i) => sum + (Number(i.preco || 0) * Number(i.qty || 0)), 0);

  if (!tableOrderDraftItems.length) {
    list.innerHTML = '<div class="empty-state" style="padding:20px;"><i class="fas fa-receipt"></i><p>Nenhum item adicionado</p></div>';
    totalEl.textContent = formatMoney(0);
    return;
  }

  list.innerHTML = tableOrderDraftItems.map(i => `
    <div class="local-order-item-row">
      <div>
        <strong>${escapeHtml(i.nome)}</strong>
        <div class="local-order-item-price">${formatMoney(i.preco)} cada</div>
      </div>
      <div class="local-order-item-actions">
        <button type="button" class="btn btn--outline-sm btn--sm" onclick="updateTableOrderItemQty(${i.id}, -1)"><i class="fas fa-minus"></i></button>
        <span>${i.qty}</span>
        <button type="button" class="btn btn--outline-sm btn--sm" onclick="updateTableOrderItemQty(${i.id}, 1)"><i class="fas fa-plus"></i></button>
        <button type="button" class="btn btn--danger btn--sm" onclick="removeTableOrderItem(${i.id})"><i class="fas fa-trash"></i></button>
      </div>
    </div>
  `).join('');
  totalEl.textContent = formatMoney(total);
}

window.updateTableOrderItemQty = updateTableOrderItemQty;
window.removeTableOrderItem = removeTableOrderItem;

async function createTableOrder(event) {
  event.preventDefault();
  const mesa = $('tableOrderMesa').value.trim();
  const cliente = $('tableOrderCliente').value.trim();
  const pagamento = $('tableOrderPayment').value;
  const status = $('tableOrderStatus').value;
  const observacoes = $('tableOrderObs').value.trim();

  if (!mesa) {
    showToast('Informe a mesa', 'error');
    return;
  }
  if (!tableOrderDraftItems.length) {
    showToast('Adicione ao menos um item', 'error');
    return;
  }

  const adminUserId = adminUser?.id;
  if (!adminUserId) {
    showToast('Sessão admin inválida. Faça login novamente.', 'error');
    return;
  }

  const total = tableOrderDraftItems.reduce((sum, i) => sum + (Number(i.preco || 0) * Number(i.qty || 0)), 0);
  const pedido = {
    user_id: adminUserId,
    itens: tableOrderDraftItems.map(i => ({ id: i.id, nome: i.nome, preco: i.preco, qty: i.qty })),
    total,
    status,
    nome_cliente: cliente || `Mesa ${mesa}`,
    telefone_cliente: '',
    email_cliente: '',
    endereco_entrega: `Consumo no local - Mesa ${mesa}`,
    forma_pagamento: pagamento,
    observacoes: observacoes ? `[Mesa ${mesa}] ${observacoes}` : `[Mesa ${mesa}] Pedido no local`,
    forma_entrega: 'retirada'
  };

  const saveBtn = $('btnSaveTableOrder');
  const oldText = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';

  try {
    const { error } = await sb.from('pedidos').insert([pedido]);
    if (error) throw error;

    $('tableOrderModal').classList.add('hidden');
    showToast('Pedido de mesa criado com sucesso!', 'success');
    await loadOrders();
  } catch (err) {
    showToast('Erro ao criar pedido: ' + (err.message || 'erro desconhecido'), 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = oldText;
  }
}

window.viewOrder = function(id) {
  const order = allOrders.find(o => o.id === id);
  if (!order) return;
  const items = Array.isArray(order.itens) ? order.itens : [];
  $('orderDetailBody').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3 style="font-size:1.1rem;">#${order.id}</h3>
        <span class="badge badge--${order.status}">${statusLabel(order.status)}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:.85rem;">
        <div><strong>Cliente:</strong> ${escapeHtml(order.nome_cliente || 'N/A')}</div>
        <div><strong>Email:</strong> ${escapeHtml(order.email_cliente || 'N/A')}</div>
        <div><strong>Telefone:</strong> ${escapeHtml(order.telefone_cliente || 'N/A')}</div>
        <div><strong>Entrega:</strong> ${escapeHtml(order.forma_entrega || 'delivery')}</div>
        <div style="grid-column:1/-1;"><strong>Endereço:</strong> ${escapeHtml(order.endereco_entrega || 'N/A')}</div>
        ${order.observacoes ? `<div style="grid-column:1/-1;"><strong>Observações:</strong> ${escapeHtml(order.observacoes)}</div>` : ''}
      </div>
      <div>
        <strong>Itens:</strong>
        <table class="table" style="margin-top:8px;">
          <thead><tr><th>Item</th><th>Qtd</th><th>Preço</th><th>Subtotal</th></tr></thead>
          <tbody>
            ${items.map(i => `<tr><td>${escapeHtml(i.nome)}</td><td>${i.qty}</td><td>${formatMoney(i.preco)}</td><td>${formatMoney(i.preco * i.qty)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:1.1rem;font-weight:700;padding-top:10px;border-top:1px solid #eee;">
        <span>Total</span><span style="color:#4CAF50;">${formatMoney(order.total)}</span>
      </div>
      <div style="font-size:.75rem;color:#999;">
        Criado em: ${new Date(order.created_at).toLocaleString('pt-BR')}
        ${order.checkout_url ? ` · <a href="${escapeHtml(order.checkout_url)}" target="_blank" rel="noopener noreferrer" style="color:#2196F3;">Link pagamento</a>` : ''}
      </div>
    </div>
  `;
  $('orderDetailModal').classList.remove('hidden');
};

// ============================================================
//  PRODUCTS (Cardápio)
// ============================================================
$('btnAddProduct').addEventListener('click', () => {
  $('productFormTitle').textContent = 'Novo Produto';
  $('productForm').reset();
  $('productId').value = '';
  $('productDisponivel').checked = true;
  window.productMidiasState = [];
  renderProductMidiasPreview();
  $('productMidias').value = '';
  $('productFormModal').classList.remove('hidden');
});

$('filterProduct').addEventListener('input', renderProductsTable);
$('filterCategory').addEventListener('change', renderProductsTable);

async function loadProducts() {
  try {
    const { data, error } = await sb.from('produtos').select('*').order('ordem').order('nome');
    if (error) throw error;
    allProducts = data || [];
    populateCategoryFilter();
    renderProductsTable();
  } catch (err) {
    console.error('Products error:', err);
  }
}

function populateCategoryFilter() {
  const sel = $('filterCategory');
  const cats = [...new Set(allProducts.map(p => p.categoria))];
  sel.innerHTML = '<option value="">Todas Categorias</option>' +
    cats.map(c => `<option value="${c}">${formatCategory(c)}</option>`).join('');
  // Also populate datalist in form
  const dl = $('categoryList');
  dl.innerHTML = cats.map(c => `<option value="${c}">`).join('');
}

function renderProductsTable() {
  let filtered = allProducts;
  const catFilter = $('filterCategory').value;
  const search = $('filterProduct').value.toLowerCase().trim();
  if (catFilter) filtered = filtered.filter(p => p.categoria === catFilter);
  if (search) filtered = filtered.filter(p => p.nome.toLowerCase().includes(search));

  const tbody = $('productsTableBody');
  tbody.innerHTML = filtered.map(p => {
    let thumb = '';
    if (Array.isArray(p.midias) && p.midias.length > 0) {
      const idx = p.midias_types && p.midias_types[0] === 'video' ? p.midias.findIndex((_, i) => p.midias_types[i] === 'image') : 0;
      const url = p.midias[idx >= 0 ? idx : 0];
      if (url && p.midias_types[idx >= 0 ? idx : 0] === 'image') {
        thumb = `<img class="table__img" src="${escapeHtml(url)}" alt="">`;
      } else if (url && p.midias_types[idx >= 0 ? idx : 0] === 'video') {
        thumb = `<video class="table__img" src="${escapeHtml(url)}" alt="" muted playsinline style="object-fit:cover;width:100%;height:100%;"></video>`;
      }
    } else {
      thumb = '<div class="table__img" style="background:#f0f0f0;"></div>';
    }
    return `
    <tr>
      <td>${thumb}</td>
      <td><strong>${escapeHtml(p.nome)}</strong></td>
      <td>${escapeHtml(formatCategory(p.categoria))}</td>
      <td>${formatMoney(p.preco)}</td>
      <td>
        <label class="switch-label" style="margin:0;">
          <input type="checkbox" ${p.disponivel ? 'checked' : ''} onchange="toggleAvailability(${p.id}, this.checked)">
          <span class="switch"></span>
        </label>
      </td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn--outline-sm btn--sm" onclick="editProduct(${p.id})"><i class="fas fa-edit"></i></button>
          <button class="btn btn--danger btn--sm" onclick="deleteProduct(${p.id})"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>
    `;
  }).join('');
}

window.editProduct = function(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  $('productFormTitle').textContent = 'Editar Produto';
  $('productId').value = p.id;
  $('productNome').value = p.nome;
  $('productCategoria').value = p.categoria;
  $('productDescricao').value = p.descricao || '';
  $('productPreco').value = p.preco;
  $('productOrdem').value = p.ordem || 0;
  $('productDisponivel').checked = p.disponivel;
  // Preencher galeria de mídias (robusto para produtos antigos)
  const midiasArr = Array.isArray(p.midias) ? p.midias : (p.midias ? [p.midias] : []);
  const typesArr = Array.isArray(p.midias_types) ? p.midias_types : (p.midias_types ? [p.midias_types] : []);
  window.productMidiasState = midiasArr.map((url, i) => ({ url, type: typesArr[i] || 'image' }));
  renderProductMidiasPreview();
  $('productFormModal').classList.remove('hidden');
};

window.deleteProduct = async function(id) {
  if (!confirm('Tem certeza que deseja excluir este produto?')) return;
  try {
    const { error } = await sb.from('produtos').delete().eq('id', id);
    if (error) throw error;
    showToast('Produto excluído!', 'success');
    loadProducts();
  } catch (err) {
    showToast('Erro ao excluir produto', 'error');
  }
};

window.toggleAvailability = async function(id, available) {
  try {
    const { error } = await sb.from('produtos').update({ disponivel: available }).eq('id', id);
    if (error) throw error;
    showToast(available ? 'Produto disponível' : 'Produto indisponível', 'success');
  } catch (err) {
    showToast('Erro ao atualizar', 'error');
    loadProducts();
  }
};

$('productForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const idValue = $('productId').value?.trim();
  const nomeProduto = $('productNome').value.trim();
  
  if (!nomeProduto) { showToast('Nome do produto é obrigatório', 'error'); return; }
  
  const payload = {
    nome: nomeProduto,
    categoria: $('productCategoria').value.trim(),
    descricao: $('productDescricao').value.trim(),
    preco: parseFloat($('productPreco').value),
    ordem: parseInt($('productOrdem').value) || 0,
    disponivel: $('productDisponivel').checked,
    midias: (window.productMidiasState || []).map(m => m.url),
    midias_types: (window.productMidiasState || []).map(m => m.type),
  };

  try {
    if (idValue && idValue !== '' && !isNaN(idValue)) {
      const { error } = await sb.from('produtos').update(payload).eq('id', parseInt(idValue));
      if (error) throw error;
      showToast('Produto atualizado!', 'success');
    } else {
      const { error } = await sb.from('produtos').insert([payload]);
      if (error) throw error;
      showToast('Produto criado!', 'success');
    }
    window.productMidiasState = [];
    $('productFormModal').classList.add('hidden');
    loadProducts();
  } catch (err) {
    showToast('Erro ao salvar produto: ' + err.message, 'error');
    console.error('Erro ao salvar:', err);
  }
});

// ==================== UPLOAD DE MÍDIAS DO PRODUTO ====================
$('productMidias')?.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    if (!/^image\//.test(file.type) && !/^video\//.test(file.type)) continue;
    if (file.size > 8 * 1024 * 1024) { showToast('Arquivo muito grande (máx. 8MB)', 'error'); continue; }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const safeName = (file.name.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 32));
    const filePath = `produtos/${Date.now()}-${safeName}.${ext}`;

    const { data, error } = await sb.storage.from('produtos').upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (error) { showToast(`Erro ao enviar arquivo: ${error.message}`, 'error'); console.error('Upload error:', error); continue; }
    const { data: publicData } = sb.storage.from('produtos').getPublicUrl(filePath);
    if (!publicData?.publicUrl) { showToast('Erro ao obter URL pública', 'error'); continue; }
    window.productMidiasState = window.productMidiasState || [];
    window.productMidiasState.push({ url: publicData.publicUrl, type: file.type.startsWith('video/') ? 'video' : 'image' });
    console.log('Arquivo enviado:', publicData.publicUrl);
    renderProductMidiasPreview();
  }
  e.target.value = '';
});

// Limpar galeria ao fechar modal
$('productFormModal')?.addEventListener('click', (e) => {
  if (e.target?.dataset?.close === 'productFormModal') {
    window.productMidiasState = [];
    renderProductMidiasPreview();
    $('productForm').reset();
    $('productId').value = '';
  }
});

// ============================================================
//  CLIENTS
// ============================================================
async function loadClients() {
  const tbody = $('clientsTableBody');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i></td></tr>';
  try {
    const { data: orders } = await sb.from('pedidos').select('*');
    if (!orders || !orders.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;padding:20px;">Nenhum cliente</td></tr>';
      return;
    }
    // Group by email
    const clients = {};
    orders.forEach(o => {
      const key = o.email_cliente || o.nome_cliente || 'unknown';
      if (!clients[key]) clients[key] = { nome: o.nome_cliente, email: o.email_cliente, telefone: o.telefone_cliente, orders: 0, total: 0 };
      clients[key].orders++;
      clients[key].total += (o.total || 0);
      if (!clients[key].nome && o.nome_cliente) clients[key].nome = o.nome_cliente;
      if (!clients[key].telefone && o.telefone_cliente) clients[key].telefone = o.telefone_cliente;
    });

    const sorted = Object.values(clients).sort((a, b) => b.total - a.total);
    tbody.innerHTML = sorted.map(c => `
      <tr>
        <td><strong>${escapeHtml(c.nome || 'N/A')}</strong></td>
        <td>${escapeHtml(c.email || 'N/A')}</td>
        <td>${escapeHtml(c.telefone || 'N/A')}</td>
        <td>${c.orders}</td>
        <td><strong>${formatMoney(c.total)}</strong></td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Clients error:', err);
  }
}

// ============================================================
//  DELIVERY ZONES
// ============================================================
$('btnAddZone')?.addEventListener('click', () => openZoneModal());
$('zoneForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('zoneId').value ? parseInt($('zoneId').value, 10) : null;
  const nome = $('zoneNome').value.trim();
  const raio = parseFloat($('zoneRaio').value);
  const taxa = parseFloat($('zoneTaxa').value);
  const prazo = $('zonePrazo').value.trim();

  if (!nome || Number.isNaN(raio) || raio <= 0 || Number.isNaN(taxa) || taxa < 0 || !prazo) {
    showToast('Preencha todos os campos corretamente', 'error');
    return;
  }

  $('zoneFormModal').classList.add('hidden');
  await saveZone(id, nome, raio, taxa, prazo);
});

async function loadDeliveryZones() {
  const list = $('zonesList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Carregando regiões...</p></div>';

  try {
    const { data, error } = await sb.from('delivery_zones').select('*').order('raio_km');
    if (error) throw error;
    deliveryZones = data || [];
    renderDeliveryZones();
    renderDeliveryMap();
  } catch (err) {
    console.error('Delivery zones error:', err);
    list.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escapeHtml(err.message || 'Erro ao carregar regiões')}</p></div>`;
  }
}

function renderDeliveryZones() {
  const list = $('zonesList');
  if (!list) return;
  if (!deliveryZones.length) {
    list.innerHTML = '<div class="empty-state"><i class="fas fa-map-marked-alt"></i><p>Nenhuma região cadastrada</p></div>';
    return;
  }

  list.innerHTML = deliveryZones.map((zone, index) => {
    const color = ZONE_COLORS[index % ZONE_COLORS.length];
    return `
      <div class="zone-card" style="border-left:4px solid ${color};">
        <div class="zone-card__header">
          <div class="zone-card__color" style="background:${color};"></div>
          <strong>${escapeHtml(zone.nome)}</strong>
          <div class="zone-card__actions">
            <button class="btn btn--outline-sm btn--sm" onclick="editZone(${zone.id})"><i class="fas fa-edit"></i></button>
            <button class="btn btn--danger btn--sm" onclick="deleteZone(${zone.id})"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="zone-card__details">
          <span><i class="fas fa-bullseye"></i> ${zone.raio_km} km</span>
          <span><i class="fas fa-dollar-sign"></i> ${formatMoney(zone.taxa_entrega)}</span>
          <span><i class="fas fa-clock"></i> ${escapeHtml(zone.prazo_entrega)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderDeliveryMap() {
  const mapEl = $('deliveryMap');
  if (!mapEl) return;
  if (typeof L === 'undefined') {
    $('mapLegend').innerHTML = '<span class="map-legend-item">Mapa indisponível</span>';
    return;
  }

  if (!deliveryMap) {
    deliveryMap = L.map('deliveryMap').setView([RESTAURANT_LAT, RESTAURANT_LNG], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 18
    }).addTo(deliveryMap);
    deliveryMapMarker = L.marker([RESTAURANT_LAT, RESTAURANT_LNG]).addTo(deliveryMap)
      .bindPopup('<strong>Casa José Silva</strong><br>Base da operação');
  } else {
    setTimeout(() => deliveryMap.invalidateSize(), 200);
  }

  deliveryMapCircles.forEach(circle => deliveryMap.removeLayer(circle));
  deliveryMapCircles = [];

  const sorted = [...deliveryZones].sort((a, b) => b.raio_km - a.raio_km);
  sorted.forEach(zone => {
    const originalIndex = deliveryZones.indexOf(zone);
    const color = ZONE_COLORS[originalIndex % ZONE_COLORS.length];
    const circle = L.circle([RESTAURANT_LAT, RESTAURANT_LNG], {
      radius: zone.raio_km * 1000,
      color,
      fillColor: color,
      fillOpacity: 0.12,
      weight: 2
    }).addTo(deliveryMap);
    circle.bindPopup(`<strong>${escapeHtml(zone.nome)}</strong><br>Raio: ${zone.raio_km} km<br>Frete: ${formatMoney(zone.taxa_entrega)}<br>Prazo: ${escapeHtml(zone.prazo_entrega)}`);
    deliveryMapCircles.push(circle);
  });

  if (sorted.length) {
    const largestRadius = sorted[0].raio_km * 1000;
    deliveryMap.fitBounds(L.latLng(RESTAURANT_LAT, RESTAURANT_LNG).toBounds(largestRadius * 2.2));
  }

  const legend = $('mapLegend');
  legend.innerHTML = deliveryZones.map((zone, index) => {
    const color = ZONE_COLORS[index % ZONE_COLORS.length];
    return `<span class="map-legend-item"><span class="map-legend-dot" style="background:${color};"></span>${escapeHtml(zone.nome)} (${zone.raio_km}km)</span>`;
  }).join('');
}

function openZoneModal(zone = null) {
  $('zoneId').value = zone ? zone.id : '';
  $('zoneNome').value = zone ? zone.nome : '';
  $('zoneRaio').value = zone ? zone.raio_km : '';
  $('zoneTaxa').value = zone ? zone.taxa_entrega : '';
  $('zonePrazo').value = zone ? zone.prazo_entrega : '';
  $('zoneFormTitle').innerHTML = zone
    ? '<i class="fas fa-edit"></i> Editar Região'
    : '<i class="fas fa-map-marked-alt"></i> Nova Região';
  $('zoneFormModal').classList.remove('hidden');
}

window.editZone = function(id) {
  const zone = deliveryZones.find(item => item.id === id);
  if (!zone) return;
  openZoneModal(zone);
};

async function saveZone(id, nome, raio_km, taxa_entrega, prazo_entrega) {
  const payload = { nome, raio_km, taxa_entrega, prazo_entrega };
  try {
    if (id) {
      const { error } = await sb.from('delivery_zones').update(payload).eq('id', id);
      if (error) throw error;
      showToast('Região atualizada!', 'success');
    } else {
      const { error } = await sb.from('delivery_zones').insert([payload]);
      if (error) throw error;
      showToast('Região criada!', 'success');
    }
    loadDeliveryZones();
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message, 'error');
  }
}

window.deleteZone = async function(id) {
  if (!confirm('Excluir esta região de entrega?')) return;
  try {
    const { error } = await sb.from('delivery_zones').delete().eq('id', id);
    if (error) throw error;
    showToast('Região excluída!', 'success');
    loadDeliveryZones();
  } catch (err) {
    showToast('Erro ao excluir: ' + err.message, 'error');
  }
};

// ============================================================
//  PROMOTIONS
// ============================================================
const PROMO_TYPE_LABELS = {
  general: 'Geral',
  daily: 'Do dia',
  weekly: 'Da semana',
  first_login: 'Primeiro login',
  first_order: 'Primeiro pedido'
};

function promotionTypeLabel(type) {
  return PROMO_TYPE_LABELS[type] || type;
}

function getSelectedPromotionDays() {
  return [...$$('#promotionDays input[type="checkbox"]')]
    .filter(input => input.checked)
    .map(input => Number(input.value))
    .filter(v => Number.isInteger(v) && v >= 0 && v <= 6);
}

function setSelectedPromotionDays(days) {
  const daySet = new Set((Array.isArray(days) ? days : []).map(v => Number(v)));
  $$('#promotionDays input[type="checkbox"]').forEach(input => {
    input.checked = daySet.has(Number(input.value));
  });
}

function formatPromotionSchedule(promo) {
  const dateParts = [];
  if (promo.start_date) dateParts.push(`de ${new Date(promo.start_date + 'T00:00:00').toLocaleDateString('pt-BR')}`);
  if (promo.end_date) dateParts.push(`até ${new Date(promo.end_date + 'T00:00:00').toLocaleDateString('pt-BR')}`);

  const timeParts = [];
  if (promo.start_time) timeParts.push(promo.start_time.slice(0, 5));
  if (promo.end_time) timeParts.push(promo.end_time.slice(0, 5));

  let daysText = 'Todos os dias';
  const days = Array.isArray(promo.days_of_week) ? promo.days_of_week : [];
  if (days.length) {
    const names = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    daysText = days
      .map(v => names[Number(v)])
      .filter(Boolean)
      .join(', ');
  }

  return `${dateParts.join(' ')}${dateParts.length ? ' · ' : ''}${timeParts.join(' às ') || '00:00 às 23:59'} · ${daysText}`;
}

function resetPromotionForm() {
  $('promotionForm')?.reset();
  $('promotionId').value = '';
  $('promotionTipo').value = 'general';
  $('promotionTimeStart').value = '00:00';
  $('promotionTimeEnd').value = '23:59';
  $('promotionDelay').value = '3';
  $('promotionCooldown').value = '180';
  $('promotionButtonText').value = 'Ver Produto';
  $('promotionAtiva').checked = true;
  $('promotionHighlight').checked = false;
  $('promotionImageUrl').value = '';
  $('promotionImagePreview').src = '';
  $('promotionImagePreviewWrap').classList.add('hidden');
  $('promotionImageHint').textContent = 'JPG/PNG/WebP · até 8MB';
  $('promotionImageDropzone').classList.remove('dragover');
  $('promotionImageFile').value = '';
  selectedPromotionProductIds = [];
  renderPromotionProductsSummary();
  updatePromotionSavingsInfo();
  setSelectedPromotionDays([]);
  $('btnDeletePromotion').style.display = 'none';
}

function fillPromotionForm(promo) {
  $('promotionId').value = promo.id;
  $('promotionNome').value = promo.name || '';
  $('promotionTipo').value = promo.promo_type || 'general';
  $('promotionTitulo').value = promo.title || '';
  $('promotionDescricao').value = promo.description || '';
  $('promotionRules').value = promo.rules || '';
  $('promotionCoupon').value = promo.coupon_code || '';
  $('promotionImageUrl').value = promo.image_url || '';
  if (promo.image_url) {
    $('promotionImagePreview').src = promo.image_url;
    $('promotionImagePreviewWrap').classList.remove('hidden');
    $('promotionImageHint').textContent = 'Imagem pronta para a campanha';
  } else {
    $('promotionImagePreview').src = '';
    $('promotionImagePreviewWrap').classList.add('hidden');
    $('promotionImageHint').textContent = 'JPG/PNG/WebP · até 8MB';
  }
  const multi = Array.isArray(promo.product_ids) ? promo.product_ids : [];
  if (multi.length) {
    selectedPromotionProductIds = multi.map(v => Number(v)).filter(v => Number.isFinite(v));
  } else if (promo.product_id) {
    selectedPromotionProductIds = [Number(promo.product_id)];
  } else {
    selectedPromotionProductIds = [];
  }
  renderPromotionProductsSummary();
  ensurePromotionProductsCatalog()
    .then(() => {
      renderPromotionProductsSummary();
      syncPromotionOriginalPrice();
      updatePromotionSavingsInfo();
    })
    .catch(() => {});
  $('promotionButtonText').value = promo.button_text || 'Ver Produto';
  $('promotionOriginalPrice').value = promo.original_price ?? '';
  $('promotionPromoPrice').value = promo.promo_price ?? '';
  updatePromotionSavingsInfo();
  $('promotionDateStart').value = promo.start_date || '';
  $('promotionDateEnd').value = promo.end_date || '';
  $('promotionTimeStart').value = promo.start_time ? promo.start_time.slice(0, 5) : '00:00';
  $('promotionTimeEnd').value = promo.end_time ? promo.end_time.slice(0, 5) : '23:59';
  $('promotionDelay').value = promo.delay_seconds ?? 3;
  $('promotionCooldown').value = promo.cooldown_minutes ?? 180;
  $('promotionAtiva').checked = promo.is_active !== false;
  $('promotionHighlight').checked = promo.highlight_style === true;
  setSelectedPromotionDays(promo.days_of_week || []);
  $('btnDeletePromotion').style.display = 'inline-flex';
}

function renderPromotionProductsSummary() {
  const box = $('promotionProductSelectionSummary');
  if (!box) return;
  if (!selectedPromotionProductIds.length) {
    box.textContent = 'Nenhum item selecionado';
    return;
  }

  const picked = selectedPromotionProductIds
    .map(id => promotionProductsCatalog.find(p => Number(p.id) === Number(id)))
    .filter(Boolean);

  if (!picked.length) {
    box.textContent = `${selectedPromotionProductIds.length} item(ns) selecionado(s)`;
    return;
  }

  const labels = picked.slice(0, 3).map(p => p.nome).join(' · ');
  const extra = picked.length > 3 ? ` +${picked.length - 3}` : '';
  const total = picked.reduce((sum, item) => sum + Number(item.preco || 0), 0);
  box.textContent = `${labels}${extra} · Total atual: ${formatMoney(total)}`;
}

function syncPromotionOriginalPrice() {
  const input = $('promotionOriginalPrice');
  if (!input) return;

  const picked = selectedPromotionProductIds
    .map(id => promotionProductsCatalog.find(p => Number(p.id) === Number(id)))
    .filter(Boolean);

  if (!picked.length) return;

  const total = picked.reduce((sum, item) => sum + Number(item.preco || 0), 0);
  input.value = total.toFixed(2);
  updatePromotionSavingsInfo();
}

function updatePromotionSavingsInfo() {
  const el = $('promotionSavingsInfo');
  if (!el) return;

  const original = Number($('promotionOriginalPrice')?.value || 0);
  const promotional = Number($('promotionPromoPrice')?.value || 0);

  if (!(original > 0) || !(promotional > 0)) {
    el.textContent = 'Economia: defina o valor promocional.';
    return;
  }

  if (promotional >= original) {
    el.textContent = 'Economia: valor promocional deve ser menor que o original.';
    return;
  }

  const savings = original - promotional;
  const savingsPct = (savings / original) * 100;
  el.textContent = `Economia: ${formatMoney(savings)} (${savingsPct.toFixed(1)}%)`;
}

async function ensurePromotionProductsCatalog() {
  if (promotionProductsCatalog.length) return;
  const { data, error } = await sb
    .from('produtos')
    .select('id,nome,preco,categoria,midias,midias_types,disponivel')
    .order('nome');
  if (error) throw error;
  promotionProductsCatalog = data || [];
}

function renderPromotionProductsGrid(searchTerm = '') {
  const grid = $('promotionProductsGrid');
  if (!grid) return;
  const query = (searchTerm || '').trim().toLowerCase();
  const filtered = promotionProductsCatalog.filter(item => {
    if (!query) return true;
    return String(item.nome || '').toLowerCase().includes(query)
      || String(item.categoria || '').toLowerCase().includes(query);
  });

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state" style="padding:20px;"><i class="fas fa-search"></i><p>Nenhum produto encontrado</p></div>';
    return;
  }

  grid.innerHTML = filtered.map(item => {
    const selected = selectedPromotionProductIds.includes(Number(item.id));
    return `
      <label class="promotion-product-item ${selected ? 'is-selected' : ''}">
        <input type="checkbox" class="promotion-product-check" value="${item.id}" ${selected ? 'checked' : ''} style="margin-top:0;">
        ${(item.imagem_url || item.midias?.[0]) ? `<img class="promotion-product-item__thumb" src="${escapeHtml(item.imagem_url || item.midias[0])}" alt="">` : '<div class="promotion-product-item__thumb"></div>'}
        <div>
          <div class="promotion-product-item__name">${escapeHtml(item.nome || 'Produto')}</div>
          <div class="promotion-product-item__meta">${formatMoney(item.preco || 0)} · ${escapeHtml(formatCategory(item.categoria || ''))}</div>
        </div>
      </label>
    `;
  }).join('');

  grid.querySelectorAll('.promotion-product-check').forEach(input => {
    input.addEventListener('change', () => {
      const id = Number(input.value);
      if (input.checked) {
        if (!selectedPromotionProductIds.includes(id)) selectedPromotionProductIds.push(id);
      } else {
        selectedPromotionProductIds = selectedPromotionProductIds.filter(v => v !== id);
      }
      renderPromotionProductsGrid($('promotionProductsSearch')?.value || '');
      renderPromotionProductsSummary();
      syncPromotionOriginalPrice();
    });
  });
}

async function openPromotionProductsModal() {
  try {
    await ensurePromotionProductsCatalog();
    $('promotionProductsSearch').value = '';
    renderPromotionProductsGrid('');
    $('promotionProductsModal').classList.remove('hidden');
  } catch (err) {
    showToast('Erro ao carregar produtos para promoção', 'error');
  }
}

function sanitizeFileName(name) {
  return String(name || 'image')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-');
}

async function uploadPromotionImage(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Selecione um arquivo de imagem válido', 'error');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showToast('Imagem muito grande (máximo 8MB)', 'error');
    return;
  }

  try {
    promotionImageUploading = true;
    $('promotionImageHint').textContent = 'Enviando imagem...';
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const safeName = sanitizeFileName(file.name.replace(/\.[^.]+$/, ''));
    const filePath = `promotions/${Date.now()}-${safeName}.${ext}`;
    const { error: upError } = await sb.storage
      .from(PROMOTION_IMAGE_BUCKET)
      .upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (upError) throw upError;

    const { data: publicData } = sb.storage.from(PROMOTION_IMAGE_BUCKET).getPublicUrl(filePath);
    const publicUrl = publicData?.publicUrl;
    if (!publicUrl) throw new Error('Não foi possível obter URL pública da imagem');

    $('promotionImageUrl').value = publicUrl;
    $('promotionImagePreview').src = publicUrl;
    $('promotionImagePreviewWrap').classList.remove('hidden');
    $('promotionImageHint').textContent = 'Imagem carregada com sucesso!';
    showToast('Imagem enviada com sucesso', 'success');
  } catch (err) {
    $('promotionImageHint').textContent = 'Erro no upload. Tente novamente.';
    showToast('Erro ao enviar imagem: ' + (err.message || 'erro desconhecido'), 'error');
  } finally {
    promotionImageUploading = false;
    $('promotionImageFile').value = '';
  }
}

function bindPromotionImageUpload() {
  const dropzone = $('promotionImageDropzone');
  const input = $('promotionImageFile');
  if (!dropzone || !input || dropzone.dataset.bound === '1') return;

  dropzone.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    if (input.files?.[0]) await uploadPromotionImage(input.files[0]);
  });

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file) await uploadPromotionImage(file);
  });

  $('btnRemovePromotionImage')?.addEventListener('click', () => {
    $('promotionImageUrl').value = '';
    $('promotionImagePreview').src = '';
    $('promotionImagePreviewWrap').classList.add('hidden');
    $('promotionImageHint').textContent = 'JPG/PNG/WebP · até 8MB';
  });

  dropzone.dataset.bound = '1';
}

async function syncPromotionCoupon(promotionId, promoName, couponCode, originalPrice, promoPrice, dateStart, dateEnd, isActive) {
  const normalizedCode = (couponCode || '').trim().toUpperCase();
  if (!normalizedCode) return;

  const originalValue = Number(originalPrice || 0);
  const promotionalValue = Number(promoPrice || 0);
  const discountValue = Math.max(0, Number((originalValue - promotionalValue).toFixed(2)));
  if (discountValue <= 0) return;

  const payload = {
    code: normalizedCode,
    description: `Cupom da promoção: ${promoName}`,
    discount_type: 'fixed',
    discount_value: discountValue,
    is_active: isActive,
    starts_at: dateStart ? `${dateStart}T00:00:00` : null,
    expires_at: dateEnd ? `${dateEnd}T23:59:59` : null,
    usage_limit: null,
    per_user_limit: 1,
    min_order_value: null,
    linked_promotion_id: promotionId
  };

  const { data: existing, error: findError } = await sb
    .from('discount_coupons')
    .select('id')
    .eq('code', normalizedCode)
    .maybeSingle();
  if (findError) throw findError;

  if (existing?.id) {
    const { error: updError } = await sb.from('discount_coupons').update(payload).eq('id', existing.id);
    if (updError) throw updError;
  } else {
    const { error: insError } = await sb.from('discount_coupons').insert([payload]);
    if (insError) throw insError;
  }
}

async function loadPromotions() {
  const tbody = $('promotionsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Carregando promoções...</td></tr>';

  try {
    const { data, error } = await sb
      .from('promotion_popups')
      .select('*')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;

    allPromotions = data || [];
    renderPromotionsTable();
  } catch (err) {
    console.error('Promotions error:', err);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#E53935;">Erro ao carregar promoções</td></tr>';
  }
}

function renderPromotionsTable() {
  const tbody = $('promotionsTableBody');
  if (!tbody) return;

  if (!allPromotions.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:20px;">Nenhuma promoção cadastrada</td></tr>';
    return;
  }

  tbody.innerHTML = allPromotions.map(promo => `
    <tr>
      <td>
        <strong>${escapeHtml(promo.name || 'Sem nome')}</strong>
        <div style="font-size:.72rem;color:#888;">${escapeHtml(promo.title || '')}</div>
      </td>
      <td>${escapeHtml(promotionTypeLabel(promo.promo_type || 'general'))}</td>
      <td>${promo.coupon_code ? `<span class="badge badge--confirmado">${escapeHtml(promo.coupon_code)}</span>` : '-'}</td>
      <td style="max-width:280px;white-space:normal;">${escapeHtml(formatPromotionSchedule(promo))}</td>
      <td>${promo.is_active ? '<span class="badge badge--entregue">Ativa</span>' : '<span class="badge badge--cancelado">Pausada</span>'}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn--outline-sm btn--sm" onclick="editPromotion(${promo.id})"><i class="fas fa-edit"></i></button>
          <button class="btn btn--danger btn--sm" onclick="deletePromotion(${promo.id})"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.editPromotion = function(id) {
  const promo = allPromotions.find(p => p.id === id);
  if (!promo) return;
  fillPromotionForm(promo);
  showToast('Promoção carregada para edição', 'info');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.deletePromotion = async function(id) {
  if (!confirm('Deseja excluir esta promoção?')) return;
  try {
    const { error } = await sb.from('promotion_popups').delete().eq('id', id);
    if (error) throw error;
    showToast('Promoção excluída', 'success');
    if (String($('promotionId').value) === String(id)) resetPromotionForm();
    await loadPromotions();
  } catch (err) {
    showToast('Erro ao excluir promoção: ' + (err.message || 'erro desconhecido'), 'error');
  }
};

$('btnResetPromotionForm')?.addEventListener('click', resetPromotionForm);

$('btnDeletePromotion')?.addEventListener('click', async () => {
  const id = parseInt($('promotionId').value || '0', 10);
  if (!id) return;
  await window.deletePromotion(id);
});

$('promotionForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const id = parseInt($('promotionId').value || '0', 10) || null;
  const name = $('promotionNome').value.trim();
  const title = $('promotionTitulo').value.trim();
  const description = $('promotionDescricao').value.trim();
  const promoType = $('promotionTipo').value;
  const couponCode = $('promotionCoupon').value.trim().toUpperCase();
  const dateStart = $('promotionDateStart').value || null;
  const dateEnd = $('promotionDateEnd').value || null;
  const originalPrice = $('promotionOriginalPrice').value ? Number($('promotionOriginalPrice').value) : null;
  const promoPrice = $('promotionPromoPrice').value ? Number($('promotionPromoPrice').value) : null;

  if (!name || !title || !description) {
    showToast('Preencha nome, título e descrição', 'error');
    return;
  }

  if (!(originalPrice > 0) || !(promoPrice > 0)) {
    showToast('Defina o valor original e o valor promocional da oferta', 'error');
    return;
  }

  if (promoPrice >= originalPrice) {
    showToast('O valor promocional precisa ser menor que o valor original', 'error');
    return;
  }

  if (promotionImageUploading) {
    showToast('Aguarde o envio da imagem terminar', 'info');
    return;
  }

  const payload = {
    name,
    promo_type: promoType,
    title,
    description,
    rules: $('promotionRules').value.trim() || null,
    image_url: $('promotionImageUrl').value.trim() || null,
    coupon_code: couponCode || null,
    discount_percent: null,
    original_price: originalPrice,
    promo_price: promoPrice,
    product_id: selectedPromotionProductIds.length ? Number(selectedPromotionProductIds[0]) : null,
    product_ids: selectedPromotionProductIds,
    button_text: $('promotionButtonText').value.trim() || 'Ver Produto',
    start_date: dateStart,
    end_date: dateEnd,
    start_time: $('promotionTimeStart').value || '00:00',
    end_time: $('promotionTimeEnd').value || '23:59',
    days_of_week: getSelectedPromotionDays(),
    delay_seconds: Number($('promotionDelay').value || 0),
    cooldown_minutes: Number($('promotionCooldown').value || 0),
    is_active: $('promotionAtiva').checked,
    highlight_style: $('promotionHighlight').checked,
    priority: 100
  };

  try {
    let promotionId = id;
    if (id) {
      const { error } = await sb.from('promotion_popups').update(payload).eq('id', id);
      if (error) throw error;
      showToast('Promoção atualizada com sucesso!', 'success');
    } else {
      const { data, error } = await sb.from('promotion_popups').insert([payload]).select('id').single();
      if (error) throw error;
      promotionId = data?.id;
      showToast('Promoção criada com sucesso!', 'success');
    }

    if (couponCode && promotionId) {
      await syncPromotionCoupon(promotionId, name, couponCode, originalPrice, promoPrice, dateStart, dateEnd, payload.is_active);
    }

    resetPromotionForm();
    await loadPromotions();
  } catch (err) {
    showToast('Erro ao salvar promoção: ' + (err.message || 'erro desconhecido'), 'error');
  }
});

bindPromotionImageUpload();
resetPromotionForm();

$('btnOpenPromotionProductsModal')?.addEventListener('click', openPromotionProductsModal);
$('btnApplyPromotionProducts')?.addEventListener('click', () => {
  renderPromotionProductsSummary();
  syncPromotionOriginalPrice();
  $('promotionProductsModal').classList.add('hidden');
});

$('promotionPromoPrice')?.addEventListener('input', updatePromotionSavingsInfo);

$('promotionProductsSearch')?.addEventListener('input', (event) => {
  renderPromotionProductsGrid(event.target.value || '');
});

// ============================================================
//  CONFIG
// ============================================================
const configSections = {
  geral: {
    icon: 'fa-store',
    title: 'Geral',
    desc: 'Nome, descrição e informações básicas do restaurante',
    keys: [
      'restaurant_name',
      'restaurant_subtitle',
      'restaurant_description',
      'footer_text',
      'opening_message',
      'closing_message'
    ]
  },
  contato: {
    icon: 'fa-phone',
    title: 'Contato',
    desc: 'Redes sociais e canais de comunicação',
    keys: [
      'whatsapp_number',
      'whatsapp_message_template',
      'email',
      'phone_support',
      'instagram_url',
      'facebook_url',
      'telegram_url',
      'tiktok_url'
    ]
  },
  endereco: {
    icon: 'fa-map-marker-alt',
    title: 'Endereço',
    desc: 'Localização completa e mapas',
    keys: [
      'address',
      'address_complement',
      'neighborhood',
      'city',
      'state',
      'postal_code',
      'latitude',
      'longitude',
      'google_maps_link',
      'google_maps_embed',
      'map_marker_color'
    ]
  },
  visual: {
    icon: 'fa-palette',
    title: 'Visual',
    desc: 'Cores, tipografia e imagens do site',
    keys: [
      'primary_color',
      'accent_color',
      'secondary_color',
      'text_color',
      'background_color',
      'hero_image',
      'logo_image',
      'favicon_image',
      'font_family',
      'border_radius'
    ]
  },
  horarios: {
    icon: 'fa-clock',
    title: 'Horários',
    desc: 'Horários de funcionamento por dia da semana',
    keys: [
      'sales_open_days',
      'lunch_open_days',
      'lunch_start',
      'lunch_end',
      'lunch_categories',
      'closed_between_start',
      'closed_between_end',
      'dinner_open_days',
      'dinner_start',
      'dinner_end',
      'dinner_categories',
      'schedule_message_closed',
      'monday_hours',
      'tuesday_hours',
      'wednesday_hours',
      'thursday_hours',
      'friday_hours',
      'saturday_hours',
      'sunday_hours',
      'holiday_closed',
      'holiday_schedule'
    ]
  }
};

let configOriginal = {};
let currentSection = 'geral';
let scheduleCategoryOptions = ['menu', 'pizzas-tradicionais', 'pizzas-especiais', 'pizzas-doces'];
const PROMOTION_IMAGE_BUCKET = 'images';
let promotionImageUploading = false;

const configDefaults = {
  sales_open_days: '0,2,3,4,5,6',
  lunch_open_days: '0,2,3,4,5,6',
  lunch_start: '11:00',
  lunch_end: '15:00',
  lunch_categories: 'menu',
  closed_between_start: '15:00',
  closed_between_end: '18:00',
  dinner_open_days: '0,2,3,4,5,6',
  dinner_start: '18:00',
  dinner_end: '22:00',
  dinner_categories: 'pizzas-tradicionais,pizzas-especiais,pizzas-doces',
  schedule_message_closed: 'Fechado no momento'
};

function getConfigSectionByKey(key) {
  for (const [section, info] of Object.entries(configSections)) {
    if (info.keys.includes(key)) return section;
  }
  return 'geral';
}

function getConfigValue(key) {
  return (configData[key]?.value ?? configDefaults[key] ?? '').toString();
}

function parseConfigCsvList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function toCsvFromChecked(selector) {
  return [...document.querySelectorAll(selector)]
    .filter(input => input.checked)
    .map(input => input.value)
    .join(',');
}

async function loadScheduleCategories() {
  try {
    const { data, error } = await sb.from('produtos').select('categoria').order('categoria');
    if (error) throw error;
    const categories = [...new Set((data || []).map(row => (row.categoria || '').trim()).filter(Boolean))];
    if (categories.length) scheduleCategoryOptions = categories;
  } catch (_) {
    // fallback para categorias padrão
  }
}

function renderScheduleConfigSection(form) {
  const selectedOpenDays = new Set(parseConfigCsvList(getConfigValue('sales_open_days')));
  const selectedLunchDays = new Set(parseConfigCsvList(getConfigValue('lunch_open_days')));
  const selectedDinnerDays = new Set(parseConfigCsvList(getConfigValue('dinner_open_days')));
  const selectedLunchCategories = new Set(parseConfigCsvList(getConfigValue('lunch_categories')));
  const selectedDinnerCategories = new Set(parseConfigCsvList(getConfigValue('dinner_categories')));
  const days = [
    { v: '0', label: 'Domingo' },
    { v: '1', label: 'Segunda' },
    { v: '2', label: 'Terça' },
    { v: '3', label: 'Quarta' },
    { v: '4', label: 'Quinta' },
    { v: '5', label: 'Sexta' },
    { v: '6', label: 'Sábado' }
  ];

  const categories = scheduleCategoryOptions;
  form.innerHTML = `
    <div class="schedule-builder">
      <div class="schedule-block">
        <h4><i class="fas fa-calendar-check"></i> Dias abertos</h4>
        <p>Marque os dias em que o restaurante aceita pedidos.</p>
        <div class="schedule-days" id="scheduleOpenDays">
          ${days.map(day => `
            <label class="schedule-check">
              <input type="checkbox" class="schedule-day-check" value="${day.v}" ${selectedOpenDays.has(day.v) ? 'checked' : ''}>
              <span>${day.label}</span>
            </label>
          `).join('')}
        </div>
        <input type="hidden" id="cfgSalesOpenDays" data-config-key="sales_open_days" data-config-type="text" value="${escapeHtml(getConfigValue('sales_open_days'))}">
      </div>

      <div class="schedule-block">
        <h4><i class="fas fa-sun"></i> Janela de almoço</h4>
        <label class="schedule-subtitle">Dias com almoço</label>
        <div class="schedule-days schedule-days--tight" id="scheduleLunchDays">
          ${days.map(day => `
            <label class="schedule-check">
              <input type="checkbox" class="schedule-lunch-day-check" value="${day.v}" ${selectedLunchDays.has(day.v) ? 'checked' : ''}>
              <span>${day.label.slice(0, 3)}</span>
            </label>
          `).join('')}
        </div>
        <input type="hidden" id="cfgLunchOpenDays" data-config-key="lunch_open_days" data-config-type="text" value="${escapeHtml(getConfigValue('lunch_open_days'))}">
        <div class="schedule-time-grid">
          <div class="config-field">
            <label>Início</label>
            <input type="time" data-config-key="lunch_start" data-config-type="text" value="${escapeHtml(getConfigValue('lunch_start') || '11:00')}">
          </div>
          <div class="config-field">
            <label>Fim</label>
            <input type="time" data-config-key="lunch_end" data-config-type="text" value="${escapeHtml(getConfigValue('lunch_end') || '15:00')}">
          </div>
        </div>
        <label class="schedule-subtitle">Categorias liberadas no almoço</label>
        <div class="schedule-category-grid" id="scheduleLunchCategories">
          ${categories.map(cat => `
            <label class="schedule-check">
              <input type="checkbox" class="schedule-lunch-category-check" value="${escapeHtml(cat)}" ${selectedLunchCategories.has(cat) ? 'checked' : ''}>
              <span>${escapeHtml(formatCategory(cat))}</span>
            </label>
          `).join('')}
        </div>
        <input type="hidden" id="cfgLunchCategories" data-config-key="lunch_categories" data-config-type="text" value="${escapeHtml(getConfigValue('lunch_categories'))}">
      </div>

      <div class="schedule-block">
        <h4><i class="fas fa-door-closed"></i> Intervalo fechado</h4>
        <div class="schedule-time-grid">
          <div class="config-field">
            <label>Início</label>
            <input type="time" data-config-key="closed_between_start" data-config-type="text" value="${escapeHtml(getConfigValue('closed_between_start') || '15:00')}">
          </div>
          <div class="config-field">
            <label>Fim</label>
            <input type="time" data-config-key="closed_between_end" data-config-type="text" value="${escapeHtml(getConfigValue('closed_between_end') || '18:00')}">
          </div>
        </div>
      </div>

      <div class="schedule-block">
        <h4><i class="fas fa-moon"></i> Janela de jantar</h4>
        <label class="schedule-subtitle">Dias com janta</label>
        <div class="schedule-days schedule-days--tight" id="scheduleDinnerDays">
          ${days.map(day => `
            <label class="schedule-check">
              <input type="checkbox" class="schedule-dinner-day-check" value="${day.v}" ${selectedDinnerDays.has(day.v) ? 'checked' : ''}>
              <span>${day.label.slice(0, 3)}</span>
            </label>
          `).join('')}
        </div>
        <input type="hidden" id="cfgDinnerOpenDays" data-config-key="dinner_open_days" data-config-type="text" value="${escapeHtml(getConfigValue('dinner_open_days'))}">
        <div class="schedule-time-grid">
          <div class="config-field">
            <label>Início</label>
            <input type="time" data-config-key="dinner_start" data-config-type="text" value="${escapeHtml(getConfigValue('dinner_start') || '18:00')}">
          </div>
          <div class="config-field">
            <label>Fim</label>
            <input type="time" data-config-key="dinner_end" data-config-type="text" value="${escapeHtml(getConfigValue('dinner_end') || '22:00')}">
          </div>
        </div>
        <label class="schedule-subtitle">Categorias liberadas no jantar</label>
        <div class="schedule-category-grid" id="scheduleDinnerCategories">
          ${categories.map(cat => `
            <label class="schedule-check">
              <input type="checkbox" class="schedule-dinner-category-check" value="${escapeHtml(cat)}" ${selectedDinnerCategories.has(cat) ? 'checked' : ''}>
              <span>${escapeHtml(formatCategory(cat))}</span>
            </label>
          `).join('')}
        </div>
        <input type="hidden" id="cfgDinnerCategories" data-config-key="dinner_categories" data-config-type="text" value="${escapeHtml(getConfigValue('dinner_categories'))}">
      </div>

      <div class="schedule-block">
        <h4><i class="fas fa-comment-alt"></i> Mensagem quando fechado</h4>
        <div class="config-field">
          <label>Texto exibido no site</label>
          <input type="text" data-config-key="schedule_message_closed" data-config-type="text" value="${escapeHtml(getConfigValue('schedule_message_closed'))}" placeholder="Ex.: Fechado no momento">
        </div>
      </div>
    </div>
  `;

  const syncOpenDays = () => {
    $('cfgSalesOpenDays').value = toCsvFromChecked('.schedule-day-check');
  };
  const syncLunchCategories = () => {
    $('cfgLunchCategories').value = toCsvFromChecked('.schedule-lunch-category-check');
  };
  const syncLunchDays = () => {
    $('cfgLunchOpenDays').value = toCsvFromChecked('.schedule-lunch-day-check');
  };
  const syncDinnerCategories = () => {
    $('cfgDinnerCategories').value = toCsvFromChecked('.schedule-dinner-category-check');
  };
  const syncDinnerDays = () => {
    $('cfgDinnerOpenDays').value = toCsvFromChecked('.schedule-dinner-day-check');
  };

  $$('.schedule-day-check').forEach(input => input.addEventListener('change', syncOpenDays));
  $$('.schedule-lunch-category-check').forEach(input => input.addEventListener('change', syncLunchCategories));
  $$('.schedule-lunch-day-check').forEach(input => input.addEventListener('change', syncLunchDays));
  $$('.schedule-dinner-category-check').forEach(input => input.addEventListener('change', syncDinnerCategories));
  $$('.schedule-dinner-day-check').forEach(input => input.addEventListener('change', syncDinnerDays));

  syncOpenDays();
  syncLunchCategories();
  syncLunchDays();
  syncDinnerCategories();
  syncDinnerDays();
}

async function loadConfig() {
  try {
    const [{ data, error }] = await Promise.all([
      sb.from('site_config').select('*'),
      loadScheduleCategories()
    ]);
    if (error) throw error;
    configData = {};
    (data || []).forEach(row => { configData[row.key] = row; });
    configOriginal = JSON.parse(JSON.stringify(configData));
    renderConfigUI();
  } catch (err) {
    console.error('Config error:', err);
    showToast('Erro ao carregar configurações', 'error');
  }
}

function renderConfigUI() {
  // Renderizar sidebar nav
  const nav = $('configNav');
  nav.innerHTML = '';
  for (const [section, info] of Object.entries(configSections)) {
    const item = document.createElement('li');
    item.className = 'config-nav-item';
    const btn = document.createElement('button');
    btn.className = 'config-nav-btn' + (section === currentSection ? ' active' : '');
    btn.innerHTML = `<i class="fas ${info.icon}"></i><span class="config-nav-btn-label">${info.title}</span>`;
    btn.onclick = () => switchConfigSection(section);
    item.appendChild(btn);
    nav.appendChild(item);
  }
  
  // Renderizar seção ativa
  renderConfigSection(currentSection);
}

function renderConfigSection(section) {
  const info = configSections[section];
  
  // Update header
  $('configSectionTitle').textContent = info.title;
  $('configSectionDesc').textContent = info.desc;

  // Update nav buttons
  $$('.config-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.includes(info.title));
  });

  // Render form
  const form = $('configForm');
  form.innerHTML = '';

  if (section === 'horarios') {
    renderScheduleConfigSection(form);
    updateConfigPreview(section);
    return;
  }

  // Agrupar campos por categoria
  const fieldsToRender = info.keys;
  
  if (fieldsToRender.length === 0) {
    form.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">Nenhuma configuração disponível nesta seção</p>';
    return;
  }

  fieldsToRender.forEach((key, idx) => {
    const row = configData[key] || {
      key,
      value: configDefaults[key] || '',
      type: inferConfigType(key, configDefaults[key] || ''),
      label: formatConfigLabel(key),
      section
    };
    const label = row.label || formatConfigLabel(key);
    const val = row.value || '';
    const type = row.type || inferConfigType(key, val);

    const field = document.createElement('div');
    field.className = 'config-field';

    const labelEl = document.createElement('label');
    labelEl.innerHTML = `${escapeHtml(label)}`;

    let inputEl;
    
    if (type === 'textarea' || (typeof val === 'string' && val.length > 80)) {
      inputEl = document.createElement('textarea');
      inputEl.textContent = val;
      inputEl.rows = 3;
    } else if (type === 'color') {
      inputEl = document.createElement('input');
      inputEl.type = 'color';
      inputEl.value = val || '#000000';
    } else if (type === 'number') {
      inputEl = document.createElement('input');
      inputEl.type = 'number';
      inputEl.value = val;
      inputEl.step = '0.01';
    } else if (type === 'url' || key.includes('url') || key.includes('link') || key.includes('embed')) {
      inputEl = document.createElement('input');
      inputEl.type = 'url';
      inputEl.value = val;
    } else if (type === 'email' || key === 'email') {
      inputEl = document.createElement('input');
      inputEl.type = 'email';
      inputEl.value = val;
    } else if (type === 'time' || key.includes('hours')) {
      inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.value = val;
      inputEl.placeholder = '09:00 - 23:00';
    } else if (type === 'date' || key.includes('expires')) {
      inputEl = document.createElement('input');
      inputEl.type = 'date';
      inputEl.value = val;
    } else if (type === 'bool' || key.includes('enabled') || key.includes('available') || key.includes('accepts')) {
      inputEl = document.createElement('input');
      inputEl.type = 'checkbox';
      inputEl.checked = val === 'true' || val === '1' || val === true;
    } else {
      inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.value = val;
    }

    inputEl.dataset.configKey = key;
    inputEl.dataset.configType = type;
    
    if (inputEl.type !== 'checkbox') {
      inputEl.placeholder = `Digite ${label.toLowerCase()}...`;
    }
    
    // Add change listener para preview
    if (type === 'color') {
      inputEl.addEventListener('change', () => updateConfigPreview(section));
    }

    field.appendChild(labelEl);
    
    if (inputEl.type === 'checkbox') {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.gap = '8px';
      wrapper.appendChild(inputEl);
      const checkLabel = document.createElement('span');
      checkLabel.textContent = 'Ativo';
      checkLabel.style.fontSize = '.85rem';
      checkLabel.style.color = 'var(--text-muted)';
      wrapper.appendChild(checkLabel);
      field.appendChild(wrapper);
    } else {
      field.appendChild(inputEl);
    }

    // Add hints para campos especiais
    const hints = {
      'whatsapp_number': 'Formato: (11) 99999-9999 ou link WhatsApp',
      'email': 'Seu e-mail de contato para clientes',
      'phone_support': 'Telefone para suporte',
      'delivery_fee': 'Em reais (ex: 5.00)',
      'min_order': 'Valor mínimo do pedido em reais',
      'delivery_time': 'Tempo estimado em minutos',
      'lat longitude': 'Para mapas automáticos',
      'primary_color': 'Cor principal do site (tema)',
      'accent_color': 'Cor de destaque/botões',
      'monday_hours': 'Formato: 09:00 - 23:00 ou "Fechado"',
        'sales_open_days': 'Dias que aceita pedidos. Use: 0=Dom,1=Seg,2=Ter... Ex.: 0,2,3,4,5,6',
        'lunch_open_days': 'Dias com almoço (0=Dom...6=Sáb). Ex.: 2,3,4,5,6,0',
        'lunch_start': 'Início do almoço (HH:MM), ex.: 11:00',
        'lunch_end': 'Fim do almoço (HH:MM), ex.: 15:00',
        'lunch_categories': 'Categorias liberadas no almoço (separe por vírgula). Ex.: menu',
        'closed_between_start': 'Início do período fechado (HH:MM), ex.: 15:00',
        'closed_between_end': 'Fim do período fechado (HH:MM), ex.: 18:00',
        'dinner_open_days': 'Dias com jantar (0=Dom...6=Sáb). Ex.: 2,3,4,5,6,0',
        'dinner_start': 'Início do jantar (HH:MM), ex.: 18:00',
        'dinner_end': 'Fim do jantar (HH:MM), ex.: 22:00',
        'dinner_categories': 'Categorias liberadas no jantar. Ex.: pizzas-tradicionais,pizzas-especiais,pizzas-doces',
        'schedule_message_closed': 'Mensagem mostrada quando estiver fechado',
    };

    for (const [hintKey, hintText] of Object.entries(hints)) {
      if (key.includes(hintKey)) {
        const hint = document.createElement('span');
        hint.className = 'config-field-hint';
        hint.textContent = hintText;
        field.appendChild(hint);
        break;
      }
    }

    form.appendChild(field);
  });

  // Show preview if colors
  updateConfigPreview(section);
}

function updateConfigPreview(section) {
  const preview = $('configPreview');
  const colorFields = $$('[data-config-key="primary_color"], [data-config-key="accent_color"]');
  
  if (section === 'visual' && colorFields.length > 0) {
    preview.classList.remove('hidden');
    const demo = $('previewDemo');
    demo.innerHTML = '';

    const primary = $('[data-config-key="primary_color"]')?.value || '#d4492e';
    const accent = $('[data-config-key="accent_color"]')?.value || '#f9a825';
    const secondary = $('[data-config-key="secondary_color"]')?.value || '#333333';

    const colors = [
      { name: 'Primária', val: primary },
      { name: 'Acentuada', val: accent },
      { name: 'Secundária', val: secondary }
    ];

    colors.forEach(c => {
      const box = document.createElement('div');
      box.className = 'preview-color-box';
      box.style.background = c.val;
      box.textContent = c.name;
      demo.appendChild(box);
    });
  } else {
    preview.classList.add('hidden');
  }
}

function switchConfigSection(section) {
  currentSection = section;
  $('configStatus').classList.add('hidden');
  renderConfigSection(section);
}

function inferConfigType(key, val) {
  if (key.includes('color')) return 'color';
  if (key.includes('fee') || key.includes('price') || key.includes('time') || key.includes('discount')) return 'number';
  if (key.includes('url') || key.includes('link') || key.includes('embed')) return 'url';
  if (key === 'email') return 'email';
  if (key.includes('embed') || (typeof val === 'string' && val.length > 80)) return 'textarea';
  if (key.includes('_at') || key.includes('date') || key.includes('expires')) return 'date';
  if (key.includes('enabled') || key.includes('available') || key.includes('accepts') || key.includes('closed') || key.includes('program')) return 'bool';
  if (key.includes('hours')) return 'time';
  return 'text';
}

function formatConfigLabel(key) {
  const translations = {
    'restaurant_name': 'Nome do Restaurante',
    'restaurant_subtitle': 'Subtítulo/Slogan',
    'restaurant_description': 'Descrição da Pizzaria',
    'footer_text': 'Texto do Rodapé',
    'opening_message': 'Mensagem de Abertura',
    'closing_message': 'Mensagem de Fechamento',
    'whatsapp_number': 'Número WhatsApp',
    'whatsapp_message_template': 'Template Mensagem WhatsApp',
    'email': 'E-mail de Contato',
    'phone_support': 'Telefone de Suporte',
    'instagram_url': 'URL Instagram',
    'facebook_url': 'URL Facebook',
    'telegram_url': 'URL Telegram',
    'tiktok_url': 'URL TikTok',
    'address': 'Endereço Completo',
    'address_complement': 'Complemento do Endereço',
    'neighborhood': 'Bairro',
    'city': 'Cidade',
    'state': 'Estado/UF',
    'postal_code': 'CEP',
    'latitude': 'Latitude',
    'longitude': 'Longitude',
    'google_maps_link': 'Link Google Maps',
    'google_maps_embed': 'Código Embed Google Maps',
    'map_marker_color': 'Cor do Marcador',
    'delivery_available': 'Entrega Disponível',
    'delivery_fee': 'Taxa de Entrega (R$)',
    'delivery_fee_free_above': 'Entrega Grátis Acima de (R$)',
    'min_order': 'Pedido Mínimo (R$)',
    'min_order_delivery': 'Pedido Mínimo Entrega (R$)',
    'delivery_time': 'Tempo Entrega (min)',
    'delivery_time_max': 'Tempo Máximo Entrega (min)',
    'delivery_zones_info': 'Informações Zonas de Entrega',
    'delivery_schedule': 'Horário Entrega',
    'payment_methods_available': 'Métodos Disponíveis',
    'accepts_cash': 'Aceita Dinheiro',
    'accepts_debit': 'Aceita Débito',
    'accepts_credit': 'Aceita Crédito',
    'accepts_pix': 'Aceita PIX',
    'accepts_online': 'Aceita Pagamento Online',
    'payment_instructions': 'Instruções de Pagamento',
    'minimum_card_payment': 'Valor Mínimo Cartão (R$)',
    'primary_color': 'Cor Primária',
    'accent_color': 'Cor de Acentuação',
    'secondary_color': 'Cor Secundária',
    'text_color': 'Cor do Texto',
    'background_color': 'Cor de Fundo',
    'hero_image': 'Imagem Hero/Banner',
    'logo_image': 'Logo',
    'favicon_image': 'Favicon (Ícone Abas)',
    'font_family': 'Família de Fontes',
    'border_radius': 'Arredondamento Bordas',
    'monday_hours': 'Horário Segunda',
    'tuesday_hours': 'Horário Terça',
    'wednesday_hours': 'Horário Quarta',
    'thursday_hours': 'Horário Quinta',
    'friday_hours': 'Horário Sexta',
    'saturday_hours': 'Horário Sábado',
    'sunday_hours': 'Horário Domingo',
    'holiday_closed': 'Fechado Feriados',
    'holiday_schedule': 'Horário Especial Feriados',
    'sales_open_days': 'Dias Abertos Para Pedido',
    'lunch_open_days': 'Dias Com Almoço',
    'lunch_start': 'Início Almoço (HH:MM)',
    'lunch_end': 'Fim Almoço (HH:MM)',
    'lunch_categories': 'Categorias Liberadas Almoço',
    'closed_between_start': 'Início Intervalo Fechado',
    'closed_between_end': 'Fim Intervalo Fechado',
    'dinner_open_days': 'Dias Com Jantar',
    'dinner_start': 'Início Jantar (HH:MM)',
    'dinner_end': 'Fim Jantar (HH:MM)',
    'dinner_categories': 'Categorias Liberadas Jantar',
    'schedule_message_closed': 'Mensagem Quando Fechado',
    'enable_promotions': 'Ativar Promoções',
    'current_promotion': 'Promoção Atual',
    'promotion_discount': 'Desconto Promoção (%)',
    'promotion_expires_at': 'Validade Promoção',
    'coupon_code': 'Código Cupom',
    'coupon_discount': 'Desconto Cupom',
    'loyalty_program_enabled': 'Programa Fidelidade Ativo',
    'birthday_discount': 'Desconto Aniversariante (%)',
  };

  return translations[key] || key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())
    .replace(/url/i, 'URL')
    .replace(/fee/i, 'Taxa')
    .replace(/email/i, 'E-mail');
}

$('btnSaveConfig').addEventListener('click', async () => {
  const fields = $$('[data-config-key]');
  const updates = [];
  let hasError = false;

  for (const field of fields) {
    const key = field.dataset.configKey;
    let value = field.type === 'checkbox' ? (field.checked ? '1' : '0') : field.value;

    // Validações básicas
    if (value === '' && !key.includes('optional')) {
      // Valores vazios são ok para campos opcionais
    }

    // Validação de URL
    if (field.type === 'url' && value && !isValidUrl(value)) {
      showToast(`URL em ${formatConfigLabel(key)} inválida`, 'error');
      hasError = true;
      break;
    }

    // Validação de email
    if (field.type === 'email' && value && !isValidEmail(value)) {
      showToast(`E-mail em ${formatConfigLabel(key)} inválido`, 'error');
      hasError = true;
      break;
    }

    // Validação de número
    if (field.type === 'number' && value && isNaN(value)) {
      showToast(`${formatConfigLabel(key)} deve ser um número válido`, 'error');
      hasError = true;
      break;
    }

    updates.push({ key, value, type: field.dataset.configType || inferConfigType(key, value) });
  }

  if (hasError) return;

  try {
    const statusEl = $('configStatus');
    statusEl.classList.remove('hidden', 'error');
    statusEl.classList.add('hidden');

    const promises = updates.map(upd =>
      sb.from('site_config').upsert([{
        key: upd.key,
        value: upd.value,
        type: upd.type || inferConfigType(upd.key, upd.value),
        label: formatConfigLabel(upd.key),
        section: getConfigSectionByKey(upd.key)
      }], { onConflict: 'key' })
    );

    await Promise.all(promises);
    
    configOriginal = JSON.parse(JSON.stringify(configData));
    // Update config data to current values
    updates.forEach(upd => {
      if (configData[upd.key]) configData[upd.key].value = upd.value;
      else {
        configData[upd.key] = {
          key: upd.key,
          value: upd.value,
          type: upd.type || inferConfigType(upd.key, upd.value),
          label: formatConfigLabel(upd.key),
          section: getConfigSectionByKey(upd.key)
        };
      }
    });

    statusEl.textContent = '✓ Configurações salvas com sucesso!';
    statusEl.classList.remove('hidden', 'error');
    showToast('✓ Tudo salvo!', 'success');
  } catch (err) {
    console.error('Save error:', err);
    const statusEl = $('configStatus');
    statusEl.textContent = 'Erro ao salvar configurações. Tente novamente.';
    statusEl.classList.add('error');
    statusEl.classList.remove('hidden');
    showToast('Erro ao salvar', 'error');
  }
});

$('btnCancelConfig').addEventListener('click', () => {
  if (currentSection === 'horarios') {
    renderConfigSection(currentSection);
    $('configStatus').classList.add('hidden');
    showToast('Alterações descartadas', 'info');
    return;
  }

  // Reset to original values
  const fields = $$('[data-config-key]');
  fields.forEach(field => {
    const key = field.dataset.configKey;
    if (configOriginal[key]) {
      const val = configOriginal[key].value || '';
      if (field.type === 'checkbox') {
        field.checked = val === '1' || val === 'true' || val === true;
      } else {
        field.value = val;
      }
    }
  });
  $('configStatus').classList.add('hidden');
  showToast('Alterações descartadas', 'info');
});

function isValidUrl(str) {
  try {
    new URL(str);
    return true;
  } catch { return false; }
}

function isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

// ============================================================
//  UTILITIES
// ============================================================
function formatMoney(val) {
  return 'R$ ' + Number(val || 0).toFixed(2).replace('.', ',');
}

function formatCategory(cat) {
  return (cat || '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function formatPercent(v) { return Number(v || 0).toFixed(1).replace('.', ',') + '%'; }

function statusLabel(s) {
  const labels = { pendente: 'Pendente', confirmado: 'Confirmado', preparando: 'Preparando', saiu_entrega: 'Saiu p/ Entrega', entregue: 'Entregue', cancelado: 'Cancelado' };
  return labels[s] || s;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
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
checkSession();

})();

// Registrar Service Worker (#9)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {/* silently fail */});
  });
}


