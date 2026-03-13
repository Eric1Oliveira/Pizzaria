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
const DELIVERY_FEE = 5;

// ---------- DOM cache ----------
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// Pages
const splashScreen = $('splashScreen');
const menuPage = $('menuPage');
const ordersPage = $('ordersPage');
const adminPage = $('adminPage');

// ============================================================
//  NAVIGATION
// ============================================================
function showPage(page) {
  [splashScreen, menuPage, ordersPage, adminPage].forEach(p => p.classList.add('hidden'));
  page.classList.remove('hidden');
  window.scrollTo(0, 0);
}

$('btnFazerPedido').addEventListener('click', () => { showPage(menuPage); loadProducts(); });
$('btnMeusPedidos').addEventListener('click', () => {
  if (!currentUser) { openModal('loginModal'); return; }
  showPage(ordersPage); loadOrders();
});
$('btnMinhaConta').addEventListener('click', () => {
  if (currentUser) { handleLogout(); } else { openModal('loginModal'); }
});
$('btnBackToHome').addEventListener('click', () => showPage(splashScreen));
$('btnBackToHome2').addEventListener('click', () => showPage(splashScreen));
$('btnBackFromAdmin').addEventListener('click', () => showPage(splashScreen));
$('btnAdminPanel').addEventListener('click', () => {
  if (!isAdmin) return;
  showPage(adminPage);
  $('adminDate').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  adminLoadDashboard();
});

// ============================================================
//  MODALS
// ============================================================
function openModal(id) { $(id).classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { $(id).classList.add('hidden'); document.body.style.overflow = ''; }

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
  const now = new Date();
  const day = now.getDay();
  const time = now.getHours() * 60 + now.getMinutes();
  const schedule = {
    0: [[1080, 1320]],                    // Dom 18-22
    1: [[660, 900]],                       // Seg 11-15
    2: [[660, 900], [1080, 1320]],         // Ter
    3: [[660, 900], [1080, 1320]],         // Qua
    4: [[660, 900], [1080, 1320]],         // Qui
    5: [[660, 900], [1080, 1410]],         // Sex 18-23:30
    6: [[660, 900], [1080, 1410]],         // Sáb
  };
  const periods = schedule[day] || [];
  const isOpen = periods.some(([a, b]) => time >= a && time <= b);
  const dot = document.querySelector('.status-dot');
  const text = document.querySelector('.status-text');
  if (isOpen) {
    dot.className = 'status-dot open'; text.textContent = 'Aberto agora';
  } else {
    dot.className = 'status-dot closed'; text.textContent = 'Fechado agora';
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
    renderFeatured();
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

// ---------- Featured ----------
function renderFeatured() {
  const featured = products.filter(p => p.destaque);
  const section = $('featuredSection');
  const scroll = $('featuredScroll');
  if (!featured.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  scroll.innerHTML = featured.map(p => `
    <div class="featured-card" data-id="${p.id}">
      <div class="featured-card__badge">★ DESTAQUE</div>
      ${p.imagem_url ? `<img class="featured-card__img" src="${escapeHtml(p.imagem_url)}" alt="${escapeHtml(p.nome)}" loading="lazy">` :
        `<div class="featured-card__img"></div>`}
      <div class="featured-card__body">
        <div class="featured-card__name">${escapeHtml(p.nome)}</div>
        <div class="featured-card__price">${formatMoney(p.preco)}</div>
      </div>
    </div>
  `).join('');
  scroll.querySelectorAll('.featured-card').forEach(card => {
    card.addEventListener('click', () => openProductDetail(parseInt(card.dataset.id)));
  });
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
      p.nome.toLowerCase().includes(q) || (p.descricao && p.descricao.toLowerCase().includes(q))
    );
  }

  if (!filtered.length) {
    grid.innerHTML = '<div class="loader"><p>Nenhum produto encontrado.</p></div>';
    return;
  }

  // Group by category
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
      html += `
      <div class="product-card" data-id="${p.id}">
        <div class="product-card__img-wrap">
          ${p.imagem_url ? `<img class="product-card__img" src="${escapeHtml(p.imagem_url)}" alt="${escapeHtml(p.nome)}" loading="lazy">` : ''}
          <span class="product-card__category">${escapeHtml(formatCategory(p.categoria))}</span>
          ${!p.disponivel ? '<div class="product-card__unavailable">Indisponível</div>' : ''}
        </div>
        <div class="product-card__body">
          <div class="product-card__name">${escapeHtml(p.nome)}</div>
          <div class="product-card__desc">${escapeHtml(p.descricao || '')}</div>
          <div class="product-card__footer">
            <span class="product-card__price">${formatMoney(p.preco)}</span>
            <button class="product-card__add" data-id="${p.id}" ${!p.disponivel ? 'disabled' : ''}>
              ${inCart ? inCart.qty : '<i class="fas fa-plus"></i>'}
            </button>
          </div>
        </div>
      </div>`;
    });
  }
  html += '</div>';
  grid.innerHTML = html;

  // Event listeners
  grid.querySelectorAll('.product-card__add').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); addToCart(parseInt(btn.dataset.id)); });
  });
  grid.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', () => openProductDetail(parseInt(card.dataset.id)));
  });
}

// ---------- Product Detail ----------
function openProductDetail(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  const inCart = cart.find(c => c.id === id);
  const qty = inCart ? inCart.qty : 1;
  $('productModalTitle').textContent = p.nome;
  $('productModalBody').innerHTML = `
    <div class="product-detail">
      ${p.imagem_url ? `<img class="product-detail__img" src="${escapeHtml(p.imagem_url)}" alt="${escapeHtml(p.nome)}">` : ''}
      <div class="product-detail__name">${escapeHtml(p.nome)}</div>
      <div class="product-detail__desc">${escapeHtml(p.descricao || 'Sem descrição disponível.')}</div>
      <div class="product-detail__price">${formatMoney(p.preco)}</div>
      ${p.disponivel ? `
      <div class="product-detail__actions">
        <div class="product-detail__qty">
          <button class="product-detail__qty-btn" id="detailMinus"><i class="fas fa-minus"></i></button>
          <span class="product-detail__qty-val" id="detailQty">${qty}</span>
          <button class="product-detail__qty-btn" id="detailPlus"><i class="fas fa-plus"></i></button>
        </div>
        <button class="btn btn--primary btn--lg" id="detailAdd" style="flex:1;">
          <i class="fas fa-cart-plus"></i> Adicionar ${formatMoney(p.preco * qty)}
        </button>
      </div>` : '<p style="color:var(--red);font-weight:600;">Produto indisponível</p>'}
    </div>
  `;
  if (p.disponivel) {
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
  if (!p || !p.disponivel) return;
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

function updateCartUI() {
  const count = cart.reduce((s, c) => s + c.qty, 0);
  const subtotal = cart.reduce((s, c) => s + c.preco * c.qty, 0);
  const fee = deliveryType === 'delivery' ? DELIVERY_FEE : 0;
  const total = subtotal + fee;

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
  $('cartTotal').textContent = formatMoney(total);
  $('btnCheckout').disabled = !cart.length;
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

  const btn = $('btnCheckout');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando...';

  try {
    const subtotal = cart.reduce((s, c) => s + c.preco * c.qty, 0);
    const fee = deliveryType === 'delivery' ? DELIVERY_FEE : 0;
    const total = subtotal + fee;
    const orderNSU = 'CJS' + Date.now();
    const obs = $('obsInput').value.trim();

    // Build InfinitePay items
    const items = cart.map(item => ({
      description: item.nome,
      quantity: item.qty,
      price: Math.round(item.preco * 100)
    }));
    if (fee > 0) {
      items.push({ description: 'Taxa de Entrega', quantity: 1, price: Math.round(fee * 100) });
    }

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
            address: deliveryType === 'delivery' ? getFullAddress() : ''
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
      endereco_entrega: deliveryType === 'delivery' ? getFullAddress() : 'Retirada no local',
      forma_pagamento: 'infinitepay',
      infinitepay_ref: orderNSU,
      checkout_url: checkoutUrl,
      observacoes: obs,
      forma_entrega: deliveryType
    };
    const { error: dbError } = await supabaseClient.from('pedidos').insert([pedidoData]);
    if (dbError) console.error('Erro ao salvar pedido:', dbError);

    // Save address for future orders
    if (deliveryType === 'delivery') await saveAddressToUser();

    // Clear cart & redirect
    cart = [];
    saveCart();
    closeCart();
    updateCartUI();
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
  if (!user) { isAdmin = false; return; }
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
      isAdmin = false;
      return;
    }
    if (adminRow) {
      isAdmin = true;
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
    }
  } catch (err) {
    console.error('[Admin Check] Erro inesperado:', err);
    isAdmin = false;
  }
}

async function initAuth() {
  try {
    console.log('[Auth] Verificando sessão...');
    const { data: { session } } = await withTimeout(supabaseClient.auth.getSession(), 10000);
    console.log('[Auth] Sessão:', session ? 'ativa' : 'nenhuma');
    if (session?.user) {
      currentUser = session.user;
      await checkAdminStatus(currentUser);
      updateAuthUI();
      fillAddressFromUser();
    }
  } catch (err) {
    console.error('[Auth] Erro ao verificar sessão:', err.message);
  }
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    await checkAdminStatus(currentUser);
    updateAuthUI();
  });
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
//  ADMIN PANEL LOGIC (integrated)
// ============================================================
let adminOrders = [];
let adminProducts = [];
let adminConfigData = {};
let aRevenueChart = null;
let aStatusChart = null;

// ---------- Admin Navigation ----------
$$('.admin-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.admin-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const p = btn.dataset.apage;
    $$('.apage').forEach(pg => pg.classList.remove('active'));
    $('ap' + p.charAt(0).toUpperCase() + p.slice(1)).classList.add('active');
    if (p === 'dashboard') adminLoadDashboard();
    else if (p === 'pedidos') adminLoadOrders();
    else if (p === 'cardapio') adminLoadProducts();
    else if (p === 'clientes') adminLoadClients();
    else if (p === 'config') adminLoadConfig();
  });
});

// Admin close modals
$$('[data-close]').forEach(btn => {
  btn.removeEventListener('click', btn._closeHandler);
  btn._closeHandler = () => { const id = btn.dataset.close; if ($(id)) $(id).classList.add('hidden'); document.body.style.overflow = ''; };
  btn.addEventListener('click', btn._closeHandler);
});
$$('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', (e) => { if (e.target === ov) { ov.classList.add('hidden'); document.body.style.overflow = ''; } });
});

// ---------- Admin Dashboard ----------
async function adminLoadDashboard() {
  try {
    console.log('[Dashboard] Carregando pedidos...');
    const { data: orders, error } = await withTimeout(
      supabaseClient.from('pedidos').select('*').order('created_at', { ascending: false })
    );
    if (error) { console.error('[Dashboard] Erro:', error); throw error; }
    console.log('[Dashboard] Pedidos carregados:', orders?.length);
    adminOrders = orders || [];
    const today = new Date().toISOString().slice(0, 10);
    const thisMonth = new Date().toISOString().slice(0, 7);
    const todayOrders = adminOrders.filter(o => o.created_at?.startsWith(today) && o.status !== 'cancelado');
    const monthOrders = adminOrders.filter(o => o.created_at?.startsWith(thisMonth) && o.status !== 'cancelado');
    const revenueToday = todayOrders.reduce((s, o) => s + (o.total || 0), 0);
    const revenueMonth = monthOrders.reduce((s, o) => s + (o.total || 0), 0);
    const avgTicket = todayOrders.length ? revenueToday / todayOrders.length : 0;
    $('akpiRevenueToday').textContent = formatMoney(revenueToday);
    $('akpiOrdersToday').textContent = todayOrders.length;
    $('akpiAvgTicket').textContent = formatMoney(avgTicket);
    $('akpiRevenueMonth').textContent = formatMoney(revenueMonth);
    adminRenderRevenueChart(adminOrders);
    adminRenderStatusChart(adminOrders);
    adminRenderRecentOrders(adminOrders.slice(0, 10));
  } catch (err) { console.error('Admin dashboard error:', err); }
}

function adminRenderRevenueChart(orders) {
  const canvas = $('aChartRevenue');
  const labels = [], data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' }));
    data.push(orders.filter(o => o.created_at?.startsWith(key) && o.status !== 'cancelado').reduce((s, o) => s + (o.total || 0), 0));
  }
  if (aRevenueChart) aRevenueChart.destroy();
  aRevenueChart = new Chart(canvas, {
    type: 'bar', data: { labels, datasets: [{ label: 'Faturamento (R$)', data, backgroundColor: 'rgba(197,165,90,.6)', borderColor: 'rgba(197,165,90,1)', borderWidth: 1, borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

function adminRenderStatusChart(orders) {
  const canvas = $('aChartStatus');
  const statusLabels = { pendente: 'Pendente', confirmado: 'Confirmado', preparando: 'Preparando', saiu_entrega: 'Saiu Entrega', entregue: 'Entregue', cancelado: 'Cancelado' };
  const colors = { pendente: '#FF9800', confirmado: '#2196F3', preparando: '#FFC107', saiu_entrega: '#4CAF50', entregue: '#1B5E20', cancelado: '#E53935' };
  const counts = {};
  orders.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1; });
  if (aStatusChart) aStatusChart.destroy();
  aStatusChart = new Chart(canvas, {
    type: 'doughnut', data: { labels: Object.keys(counts).map(k => statusLabels[k] || k), datasets: [{ data: Object.values(counts), backgroundColor: Object.keys(counts).map(k => colors[k] || '#999'), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 11 } } } } }
  });
}

function adminRenderRecentOrders(orders) {
  const tbody = $('aRecentOrdersBody');
  if (!orders.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;padding:20px;">Nenhum pedido</td></tr>'; return; }
  tbody.innerHTML = orders.map(o => `<tr><td><strong>#${o.id}</strong></td><td>${escapeHtml(o.nome_cliente || 'N/A')}</td><td><strong>${formatMoney(o.total)}</strong></td><td><span class="abadge abadge--${o.status}">${adminStatusLabel(o.status)}</span></td><td>${adminFormatDate(o.created_at)}</td></tr>`).join('');
}

// ---------- Admin Orders ----------
$('aBtnRefreshOrders').addEventListener('click', adminLoadOrders);
$('aFilterStatus').addEventListener('change', adminLoadOrders);
$('aFilterDate').addEventListener('change', adminLoadOrders);

async function adminLoadOrders() {
  const tbody = $('aOrdersTableBody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Carregando...</td></tr>';
  try {
    let query = supabaseClient.from('pedidos').select('*').order('created_at', { ascending: false });
    const status = $('aFilterStatus').value;
    const date = $('aFilterDate').value;
    if (status) query = query.eq('status', status);
    if (date) query = query.gte('created_at', date + 'T00:00:00').lte('created_at', date + 'T23:59:59');
    const { data, error } = await withTimeout(query);
    if (error) throw error;
    adminOrders = data || [];
    if (!adminOrders.length) { tbody.innerHTML = ''; $('aOrdersEmpty').classList.remove('hidden'); return; }
    $('aOrdersEmpty').classList.add('hidden');
    tbody.innerHTML = adminOrders.map(o => {
      const items = Array.isArray(o.itens) ? o.itens.map(i => `${i.qty}x ${i.nome}`).join(', ') : '';
      return `<tr><td><strong>#${o.id}</strong></td><td>${escapeHtml(o.nome_cliente || 'N/A')}</td><td title="${escapeHtml(items)}">${escapeHtml(items.slice(0, 40))}${items.length > 40 ? '...' : ''}</td><td><strong>${formatMoney(o.total)}</strong></td><td>${escapeHtml(o.forma_entrega || 'delivery')}</td><td><select class="admin-status-select" data-order-id="${o.id}" style="font-size:.75rem;padding:4px 8px;border-radius:4px;border:1px solid #ddd;"><option value="pendente" ${o.status === 'pendente' ? 'selected' : ''}>Pendente</option><option value="confirmado" ${o.status === 'confirmado' ? 'selected' : ''}>Confirmado</option><option value="preparando" ${o.status === 'preparando' ? 'selected' : ''}>Preparando</option><option value="saiu_entrega" ${o.status === 'saiu_entrega' ? 'selected' : ''}>Saiu p/ Entrega</option><option value="entregue" ${o.status === 'entregue' ? 'selected' : ''}>Entregue</option><option value="cancelado" ${o.status === 'cancelado' ? 'selected' : ''}>Cancelado</option></select></td><td>${adminFormatDate(o.created_at)}</td><td><button class="btn btn--outline" style="border-radius:var(--radius-sm);padding:6px 10px;font-size:.75rem;" onclick="adminViewOrder(${o.id})"><i class="fas fa-eye"></i></button></td></tr>`;
    }).join('');
    tbody.querySelectorAll('.admin-status-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          const { error } = await supabaseClient.from('pedidos').update({ status: sel.value }).eq('id', parseInt(sel.dataset.orderId));
          if (error) throw error;
          showToast('Status atualizado!', 'success');
        } catch { showToast('Erro ao atualizar status', 'error'); adminLoadOrders(); }
      });
    });
  } catch (err) { console.error('Admin orders error:', err); tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#D32F2F;">Erro ao carregar pedidos</td></tr>'; }
}

window.adminViewOrder = function(id) {
  const order = adminOrders.find(o => o.id === id);
  if (!order) return;
  const items = Array.isArray(order.itens) ? order.itens : [];
  $('aOrderDetailBody').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;"><h3 style="font-size:1.1rem;">#${order.id}</h3><span class="abadge abadge--${order.status}">${adminStatusLabel(order.status)}</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:.85rem;">
        <div><strong>Cliente:</strong> ${escapeHtml(order.nome_cliente || 'N/A')}</div>
        <div><strong>Email:</strong> ${escapeHtml(order.email_cliente || 'N/A')}</div>
        <div><strong>Telefone:</strong> ${escapeHtml(order.telefone_cliente || 'N/A')}</div>
        <div><strong>Entrega:</strong> ${escapeHtml(order.forma_entrega || 'delivery')}</div>
        <div style="grid-column:1/-1;"><strong>Endereço:</strong> ${escapeHtml(order.endereco_entrega || 'N/A')}</div>
        ${order.observacoes ? `<div style="grid-column:1/-1;"><strong>Obs:</strong> ${escapeHtml(order.observacoes)}</div>` : ''}
      </div>
      <div><strong>Itens:</strong>
        <table class="admin-table" style="margin-top:8px;"><thead><tr><th>Item</th><th>Qtd</th><th>Preço</th><th>Subtotal</th></tr></thead><tbody>${items.map(i => `<tr><td>${escapeHtml(i.nome)}</td><td>${i.qty}</td><td>${formatMoney(i.preco)}</td><td>${formatMoney(i.preco * i.qty)}</td></tr>`).join('')}</tbody></table>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:1.1rem;font-weight:700;padding-top:10px;border-top:1px solid #eee;"><span>Total</span><span style="color:#4CAF50;">${formatMoney(order.total)}</span></div>
      <div style="font-size:.75rem;color:#999;">Criado em: ${new Date(order.created_at).toLocaleString('pt-BR')}${order.checkout_url ? ` · <a href="${escapeHtml(order.checkout_url)}" target="_blank" rel="noopener noreferrer" style="color:#2196F3;">Link pagamento</a>` : ''}</div>
    </div>`;
  $('aOrderDetailModal').classList.remove('hidden');
};

// ---------- Admin Products ----------
$('aBtnAddProduct').addEventListener('click', () => {
  $('aProductFormTitle').textContent = 'Novo Produto';
  $('aProductForm').reset();
  $('aProductId').value = '';
  $('aProductImagem').value = '';
  pendingProductFile = null;
  $('aProductDisponivel').checked = true;
  $('aProductDestaque').checked = false;
  $('aProductFormModal').classList.remove('hidden');
  initProductDropZone();
  showProductImagePreview('');
});
$('aFilterProduct').addEventListener('input', adminRenderProductsTable);
$('aFilterCategory').addEventListener('change', adminRenderProductsTable);

async function adminLoadProducts() {
  try {
    const { data, error } = await withTimeout(supabaseClient.from('produtos').select('*').order('ordem').order('nome'));
    if (error) throw error;
    adminProducts = data || [];
    adminPopulateCategoryFilter();
    adminRenderProductsTable();
  } catch (err) { console.error('Admin products error:', err); }
}

function adminPopulateCategoryFilter() {
  const sel = $('aFilterCategory');
  const cats = [...new Set(adminProducts.map(p => p.categoria))];
  sel.innerHTML = '<option value="">Todas Categorias</option>' + cats.map(c => `<option value="${c}">${formatCategory(c)}</option>`).join('');
  $('aCategoryList').innerHTML = cats.map(c => `<option value="${c}">`).join('');
}

function adminRenderProductsTable() {
  let filtered = adminProducts;
  const catFilter = $('aFilterCategory').value;
  const search = $('aFilterProduct').value.toLowerCase().trim();
  if (catFilter) filtered = filtered.filter(p => p.categoria === catFilter);
  if (search) filtered = filtered.filter(p => p.nome.toLowerCase().includes(search));
  $('aProductsTableBody').innerHTML = filtered.map(p => `
    <tr>
      <td>${p.imagem_url ? `<img class="admin-table__img" src="${escapeHtml(p.imagem_url)}" alt="">` : '<div class="admin-table__img"></div>'}</td>
      <td><strong>${escapeHtml(p.nome)}</strong></td>
      <td>${escapeHtml(formatCategory(p.categoria))}</td>
      <td>${formatMoney(p.preco)}</td>
      <td>${p.destaque ? '<i class="fas fa-star" style="color:var(--gold);"></i>' : '-'}</td>
      <td><label class="admin-switch-label" style="margin:0;"><input type="checkbox" ${p.disponivel ? 'checked' : ''} onchange="adminToggleAvail(${p.id}, this.checked)"><span class="admin-switch"></span></label></td>
      <td><div style="display:flex;gap:6px;"><button class="btn btn--outline" style="border-radius:var(--radius-sm);padding:5px 10px;font-size:.75rem;" onclick="adminEditProduct(${p.id})"><i class="fas fa-edit"></i></button><button style="background:#D32F2F;color:#fff;padding:5px 10px;font-size:.75rem;border-radius:var(--radius-sm);" onclick="adminDeleteProduct(${p.id})"><i class="fas fa-trash"></i></button></div></td>
    </tr>`).join('');
}

window.adminEditProduct = function(id) {
  const p = adminProducts.find(x => x.id === id);
  if (!p) return;
  $('aProductFormTitle').textContent = 'Editar Produto';
  $('aProductId').value = p.id;
  $('aProductNome').value = p.nome;
  $('aProductCategoria').value = p.categoria;
  $('aProductDescricao').value = p.descricao || '';
  $('aProductPreco').value = p.preco;
  $('aProductOrdem').value = p.ordem || 0;
  $('aProductImagem').value = p.imagem_url || '';
  pendingProductFile = null;
  $('aProductDisponivel').checked = p.disponivel;
  $('aProductDestaque').checked = p.destaque || false;
  $('aProductFormModal').classList.remove('hidden');
  initProductDropZone();
  showProductImagePreview(p.imagem_url || '');
};

window.adminDeleteProduct = async function(id) {
  if (!confirm('Excluir este produto?')) return;
  try {
    const { error } = await supabaseClient.from('produtos').delete().eq('id', id);
    if (error) throw error;
    showToast('Produto excluído!', 'success');
    adminLoadProducts();
  } catch { showToast('Erro ao excluir produto', 'error'); }
};

window.adminToggleAvail = async function(id, available) {
  try {
    const { error } = await supabaseClient.from('produtos').update({ disponivel: available }).eq('id', id);
    if (error) throw error;
    showToast(available ? 'Produto disponível' : 'Produto indisponível', 'success');
  } catch { showToast('Erro ao atualizar', 'error'); adminLoadProducts(); }
};

$('aProductForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('aProductId').value;
  let imageUrl = $('aProductImagem').value.trim() || null;

  // Upload new image if a file was selected
  if (pendingProductFile) {
    $('aBtnSaveProduct').disabled = true;
    $('aBtnSaveProduct').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    const uploadedUrl = await uploadImageToSupabase(pendingProductFile, 'products');
    $('aBtnSaveProduct').disabled = false;
    $('aBtnSaveProduct').innerHTML = 'Salvar';
    if (uploadedUrl) {
      imageUrl = uploadedUrl;
    } else {
      return; // Upload failed, don't save
    }
  }

  const payload = {
    nome: $('aProductNome').value.trim(),
    categoria: $('aProductCategoria').value.trim(),
    descricao: $('aProductDescricao').value.trim(),
    preco: parseFloat($('aProductPreco').value),
    ordem: parseInt($('aProductOrdem').value) || 0,
    imagem_url: imageUrl,
    disponivel: $('aProductDisponivel').checked,
    destaque: $('aProductDestaque').checked,
  };
  try {
    if (id) {
      const { error } = await supabaseClient.from('produtos').update(payload).eq('id', parseInt(id));
      if (error) throw error;
      showToast('Produto atualizado!', 'success');
    } else {
      const { error } = await supabaseClient.from('produtos').insert([payload]);
      if (error) throw error;
      showToast('Produto criado!', 'success');
    }
    pendingProductFile = null;
    $('aProductFormModal').classList.add('hidden');
    adminLoadProducts();
  } catch (err) { showToast('Erro ao salvar: ' + err.message, 'error'); }
});

// ---------- Admin Clients ----------
async function adminLoadClients() {
  const tbody = $('aClientsTableBody');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i></td></tr>';
  try {
    const { data: orders } = await withTimeout(supabaseClient.from('pedidos').select('*'));
    if (!orders?.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;padding:20px;">Nenhum cliente</td></tr>'; return; }
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
    tbody.innerHTML = sorted.map(c => `<tr><td><strong>${escapeHtml(c.nome || 'N/A')}</strong></td><td>${escapeHtml(c.email || 'N/A')}</td><td>${escapeHtml(c.telefone || 'N/A')}</td><td>${c.orders}</td><td><strong>${formatMoney(c.total)}</strong></td></tr>`).join('');
  } catch (err) { console.error('Admin clients error:', err); }
}

// ---------- Admin Config ----------
const adminConfigSections = {
  geral: { icon: 'fa-store', title: 'Geral', keys: ['restaurant_name', 'restaurant_subtitle', 'footer_text'] },
  contato: { icon: 'fa-phone', title: 'Contato', keys: ['whatsapp_number', 'instagram_url', 'email', 'facebook_url'] },
  endereco: { icon: 'fa-map-marker-alt', title: 'Endereço', keys: ['address', 'google_maps_embed', 'google_maps_link'] },
  entrega: { icon: 'fa-motorcycle', title: 'Entrega', keys: ['delivery_fee', 'min_order', 'delivery_time'] },
  visual: { icon: 'fa-palette', title: 'Visual', keys: ['primary_color', 'accent_color', 'hero_image'] },
};

const VISUAL_DEFAULTS = {
  primary_color: '#D4AF37',
  accent_color: '#4A7043',
  hero_image: '',
};

async function adminLoadConfig() {
  const grid = $('aConfigGrid');
  grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);"><i class="fas fa-spinner fa-spin" style="font-size:1.5rem;"></i><p style="margin-top:8px;font-size:.85rem;">Carregando configurações...</p></div>';
  try {
    console.log('[Config] Carregando site_config...');
    const { data, error } = await withTimeout(supabaseClient.from('site_config').select('*'));
    console.log('[Config] Resultado:', { data: data?.length, error });
    if (error) throw error;
    if (!data || data.length === 0) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:#D32F2F;"><i class="fas fa-exclamation-triangle" style="font-size:1.5rem;"></i><p style="margin-top:8px;">Tabela site_config vazia. Execute o SQL de seed no Supabase.</p></div>';
      return;
    }
    adminConfigData = {};
    data.forEach(row => { adminConfigData[row.key] = row; });
    adminRenderConfig();
  } catch (err) {
    console.error('Admin config error:', err);
    grid.innerHTML = '<div style="text-align:center;padding:40px;color:#D32F2F;"><i class="fas fa-exclamation-triangle" style="font-size:1.5rem;"></i><p style="margin-top:8px;">Erro ao carregar configurações: ' + (err.message || 'desconhecido') + '</p></div>';
  }
}

function adminRenderConfig() {
  const grid = $('aConfigGrid');
  grid.innerHTML = '';
  for (const [, info] of Object.entries(adminConfigSections)) {
    const card = document.createElement('div');
    card.className = 'admin-config-card';
    let fieldsHtml = '';
    info.keys.forEach(key => {
      const row = adminConfigData[key];
      if (!row) return;
      const label = row.label || key;
      const val = row.value || '';
      if (key.includes('_color')) {
        fieldsHtml += `<div class="admin-config-field"><label>${escapeHtml(label)}</label><div style="display:flex;gap:8px;align-items:center;"><input type="color" data-aconfig-key="${key}" value="${escapeHtml(val || '#000000')}" style="width:48px;height:36px;padding:2px;border:1px solid #ddd;border-radius:var(--radius-sm);cursor:pointer;"><input type="text" data-aconfig-key-mirror="${key}" value="${escapeHtml(val)}" style="flex:1;" placeholder="#RRGGBB"></div></div>`;
      } else if (key === 'hero_image') {
        fieldsHtml += `<div class="admin-config-field"><label>${escapeHtml(label)}</label><div class="drop-zone drop-zone--small" id="aConfigHeroDropZone"><input type="file" accept="image/*" class="drop-zone__input" id="aConfigHeroFileInput"><div class="drop-zone__prompt ${val ? 'hidden' : ''}" id="aConfigHeroPrompt"><i class="fas fa-cloud-upload-alt"></i><span>Arraste ou clique</span></div><div class="drop-zone__preview ${val ? '' : 'hidden'}" id="aConfigHeroPreview"><img src="${escapeHtml(val)}" id="aConfigHeroPreviewImg" alt="Hero"><button type="button" class="drop-zone__remove" id="aConfigHeroRemove"><i class="fas fa-times"></i></button></div></div><input type="hidden" data-aconfig-key="${key}" id="aConfigHeroValue" value="${escapeHtml(val)}"></div>`;
      } else {
        const isTextarea = val.length > 80 || key.includes('embed') || key.includes('link');
        fieldsHtml += `<div class="admin-config-field"><label>${escapeHtml(label)}</label>${isTextarea ? `<textarea data-aconfig-key="${key}" rows="3">${escapeHtml(val)}</textarea>` : `<input type="text" data-aconfig-key="${key}" value="${escapeHtml(val)}">`}</div>`;
      }
    });
    card.innerHTML = `<h4><i class="fas ${info.icon}"></i> ${info.title}</h4>${fieldsHtml}`;
    grid.appendChild(card);
  }
  // Sync color pickers with text inputs
  grid.querySelectorAll('input[type="color"]').forEach(picker => {
    const key = picker.dataset.aconfigKey;
    const mirror = grid.querySelector(`[data-aconfig-key-mirror="${key}"]`);
    if (mirror) {
      picker.addEventListener('input', () => { mirror.value = picker.value; });
      mirror.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(mirror.value)) picker.value = mirror.value; });
    }
  });
  // Hero image drop zone
  initConfigHeroDropZone();
}

$('aBtnSaveConfig').addEventListener('click', async () => {
  const fields = $$('[data-aconfig-key]');
  const updates = [];
  fields.forEach(field => {
    updates.push(supabaseClient.from('site_config').update({ value: field.value }).eq('key', field.dataset.aconfigKey));
  });
  try {
    await Promise.all(updates);
    showToast('Configurações salvas!', 'success');
  } catch { showToast('Erro ao salvar configurações', 'error'); }
});

// Visual reset button
$('aBtnResetVisual').addEventListener('click', async () => {
  if (!confirm('Restaurar as cores e imagem de destaque para o padrão original?')) return;
  const updates = Object.entries(VISUAL_DEFAULTS).map(([key, value]) =>
    supabaseClient.from('site_config').update({ value }).eq('key', key)
  );
  try {
    await Promise.all(updates);
    showToast('Visual restaurado para o padrão!', 'success');
    adminLoadConfig();
  } catch { showToast('Erro ao resetar visual', 'error'); }
});

// ---------- Image Upload Helpers ----------
async function uploadImageToSupabase(file, folder = 'products') {
  const ext = file.name.split('.').pop().toLowerCase();
  const allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
  if (!allowed.includes(ext)) { showToast('Formato de imagem não suportado. Use JPG, PNG, WebP ou GIF.', 'error'); return null; }
  if (file.size > 5 * 1024 * 1024) { showToast('Imagem muito grande. Máximo 5MB.', 'error'); return null; }
  const fileName = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    const { data, error } = await supabaseClient.storage.from('images').upload(fileName, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    const { data: urlData } = supabaseClient.storage.from('images').getPublicUrl(data.path);
    return urlData.publicUrl;
  } catch (err) { console.error('Upload error:', err); showToast('Erro no upload: ' + err.message, 'error'); return null; }
}

let pendingProductFile = null;
let productDropZoneInitialized = false;

function initProductDropZone() {
  if (productDropZoneInitialized) return;
  const zone = $('aProductDropZone');
  const fileInput = $('aProductFileInput');
  const removeBtn = $('aProductRemoveImg');
  if (!zone) return;
  productDropZoneInitialized = true;

  zone.addEventListener('click', (e) => { if (e.target === removeBtn || removeBtn.contains(e.target)) return; fileInput.click(); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drop-zone--over'); });
  zone.addEventListener('dragleave', () => { zone.classList.remove('drop-zone--over'); });
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('drop-zone--over');
    if (e.dataTransfer.files.length) handleProductFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) handleProductFile(fileInput.files[0]); });
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pendingProductFile = null;
    $('aProductImagem').value = '';
    $('aProductDropPrompt').classList.remove('hidden');
    $('aProductDropPreview').classList.add('hidden');
  });
}

function handleProductFile(file) {
  if (!file.type.startsWith('image/')) { showToast('Selecione um arquivo de imagem', 'error'); return; }
  pendingProductFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    $('aProductPreviewImg').src = e.target.result;
    $('aProductDropPrompt').classList.add('hidden');
    $('aProductDropPreview').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function showProductImagePreview(url) {
  if (url) {
    $('aProductPreviewImg').src = url;
    $('aProductDropPrompt').classList.add('hidden');
    $('aProductDropPreview').classList.remove('hidden');
  } else {
    $('aProductDropPrompt').classList.remove('hidden');
    $('aProductDropPreview').classList.add('hidden');
  }
}

let heroDropZoneInitialized = false;
function initConfigHeroDropZone() {
  heroDropZoneInitialized = false;
  const zone = $('aConfigHeroDropZone');
  const fileInput = $('aConfigHeroFileInput');
  const removeBtn = $('aConfigHeroRemove');
  const hiddenInput = $('aConfigHeroValue');
  if (!zone) return;
  heroDropZoneInitialized = true;

  zone.addEventListener('click', (e) => { if (e.target === removeBtn || removeBtn.contains(e.target)) return; fileInput.click(); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drop-zone--over'); });
  zone.addEventListener('dragleave', () => { zone.classList.remove('drop-zone--over'); });
  zone.addEventListener('drop', async (e) => {
    e.preventDefault(); zone.classList.remove('drop-zone--over');
    if (e.dataTransfer.files.length) await handleConfigHeroFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', async () => { if (fileInput.files.length) await handleConfigHeroFile(fileInput.files[0]); });
  if (removeBtn) removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hiddenInput.value = '';
    const p = $('aConfigHeroPrompt');
    const v = $('aConfigHeroPreview');
    if (p) p.classList.remove('hidden');
    if (v) v.classList.add('hidden');
  });
}

async function handleConfigHeroFile(file) {
  if (!file.type.startsWith('image/')) { showToast('Selecione um arquivo de imagem', 'error'); return; }
  showToast('Enviando imagem...', 'success');
  const url = await uploadImageToSupabase(file, 'hero');
  if (url) {
    $('aConfigHeroPreviewImg').src = url;
    $('aConfigHeroValue').value = url;
    $('aConfigHeroPrompt').classList.add('hidden');
    $('aConfigHeroPreview').classList.remove('hidden');
    showToast('Imagem enviada! Salve as configurações.', 'success');
  }
}



// ---------- Admin Helpers ----------
function adminStatusLabel(s) {
  const labels = { pendente: 'Pendente', confirmado: 'Confirmado', preparando: 'Preparando', saiu_entrega: 'Saiu p/ Entrega', entregue: 'Entregue', cancelado: 'Cancelado' };
  return labels[s] || s;
}
function adminFormatDate(dateStr) {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ============================================================
//  INIT
// ============================================================
(async function init() {
  initAuth();
  updateCartUI();
  checkPaymentReturn();
})();

