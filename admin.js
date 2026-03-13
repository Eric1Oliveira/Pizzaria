// ============================================================
//  ADMIN PANEL — Casa José Silva
// ============================================================

const SUPABASE_URL = 'https://uufzqceljdkrnpgjotxw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1ZnpxY2VsamRrcm5wZ2pvdHh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MzIzMjUsImV4cCI6MjA4OTAwODMyNX0.lDBwSOYlF3SlMKblt2WsHo7rdVcZ-wXgjJolD41cNfk';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- State ----------
let adminUser = null;
let allOrders = [];
let allProducts = [];
let configData = {};
let revenueChart = null;
let statusChart = null;

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
}

function showAdmin() {
  $('loginPage').classList.add('hidden');
  $('adminPanel').classList.remove('hidden');
  $('adminUserInfo').textContent = adminUser.adminInfo?.nome || adminUser.email;
  $('currentDate').textContent = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  loadDashboard();
}

// ============================================================
//  NAVIGATION
// ============================================================
const pages = { dashboard: 'pageDashboard', pedidos: 'pagePedidos', cardapio: 'pageCardapio', clientes: 'pageClientes', config: 'pageConfig' };
const pageTitles = { dashboard: 'Dashboard', pedidos: 'Pedidos', cardapio: 'Cardápio', clientes: 'Clientes', config: 'Configurações' };

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
    else if (p === 'config') loadConfig();
    // Close sidebar on mobile
    $('sidebar').classList.remove('open');
  });
});

$('btnHamburger').addEventListener('click', () => $('sidebar').classList.toggle('open'));

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
async function loadDashboard() {
  try {
    // Fetch all orders
    const { data: orders } = await sb.from('pedidos').select('*').order('created_at', { ascending: false });
    allOrders = orders || [];

    const today = new Date().toISOString().slice(0, 10);
    const thisMonth = new Date().toISOString().slice(0, 7);

    const todayOrders = allOrders.filter(o => o.created_at?.startsWith(today) && o.status !== 'cancelado');
    const monthOrders = allOrders.filter(o => o.created_at?.startsWith(thisMonth) && o.status !== 'cancelado');

    const revenueToday = todayOrders.reduce((s, o) => s + (o.total || 0), 0);
    const revenueMonth = monthOrders.reduce((s, o) => s + (o.total || 0), 0);
    const avgTicket = todayOrders.length ? revenueToday / todayOrders.length : 0;

    $('kpiRevenueToday').textContent = formatMoney(revenueToday);
    $('kpiOrdersToday').textContent = todayOrders.length;
    $('kpiAvgTicket').textContent = formatMoney(avgTicket);
    $('kpiRevenueMonth').textContent = formatMoney(revenueMonth);

    // Revenue chart (last 7 days)
    renderRevenueChart(allOrders);

    // Status chart
    renderStatusChart(allOrders);

    // Recent orders table
    renderRecentOrders(allOrders.slice(0, 10));
  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

function renderRevenueChart(orders) {
  const canvas = $('chartRevenue');
  const labels = [];
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' }));
    const dayOrders = orders.filter(o => o.created_at?.startsWith(key) && o.status !== 'cancelado');
    data.push(dayOrders.reduce((s, o) => s + (o.total || 0), 0));
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

// ============================================================
//  ORDERS PAGE
// ============================================================
$('btnRefreshOrders').addEventListener('click', loadOrders);
$('filterStatus').addEventListener('change', loadOrders);
$('filterDate').addEventListener('change', loadOrders);

async function loadOrders() {
  const tbody = $('ordersTableBody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Carregando...</td></tr>';

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
      return `
        <tr>
          <td><strong>#${o.id}</strong></td>
          <td>${escapeHtml(o.nome_cliente || 'N/A')}</td>
          <td title="${escapeHtml(items)}">${escapeHtml(items.slice(0, 40))}${items.length > 40 ? '...' : ''}</td>
          <td><strong>${formatMoney(o.total)}</strong></td>
          <td>${escapeHtml(o.forma_entrega || 'delivery')}</td>
          <td>
            <select class="status-select" data-order-id="${o.id}" style="font-size:.75rem;padding:4px 8px;border-radius:4px;border:1px solid #ddd;">
              <option value="pendente" ${o.status === 'pendente' ? 'selected' : ''}>Pendente</option>
              <option value="confirmado" ${o.status === 'confirmado' ? 'selected' : ''}>Confirmado</option>
              <option value="preparando" ${o.status === 'preparando' ? 'selected' : ''}>Preparando</option>
              <option value="saiu_entrega" ${o.status === 'saiu_entrega' ? 'selected' : ''}>Saiu p/ Entrega</option>
              <option value="entregue" ${o.status === 'entregue' ? 'selected' : ''}>Entregue</option>
              <option value="cancelado" ${o.status === 'cancelado' ? 'selected' : ''}>Cancelado</option>
            </select>
          </td>
          <td>${formatDate(o.created_at)}</td>
          <td><button class="btn btn--outline-sm btn--sm" onclick="viewOrder(${o.id})"><i class="fas fa-eye"></i></button></td>
        </tr>`;
    }).join('');

    // Status change listeners
    tbody.querySelectorAll('.status-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const orderId = parseInt(sel.dataset.orderId);
        const newStatus = sel.value;
        try {
          const { error } = await sb.from('pedidos').update({ status: newStatus }).eq('id', orderId);
          if (error) throw error;
          showToast('Status atualizado!', 'success');
        } catch (err) {
          showToast('Erro ao atualizar status', 'error');
          loadOrders();
        }
      });
    });
  } catch (err) {
    console.error('Orders error:', err);
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#E53935;">Erro ao carregar pedidos</td></tr>';
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
  $('productDestaque').checked = false;
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
  tbody.innerHTML = filtered.map(p => `
    <tr>
      <td>${p.imagem_url ? `<img class="table__img" src="${escapeHtml(p.imagem_url)}" alt="">` : '<div class="table__img" style="background:#f0f0f0;"></div>'}</td>
      <td><strong>${escapeHtml(p.nome)}</strong></td>
      <td>${escapeHtml(formatCategory(p.categoria))}</td>
      <td>${formatMoney(p.preco)}</td>
      <td>${p.destaque ? '<i class="fas fa-star" style="color:#D4AF37;"></i>' : '-'}</td>
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
  `).join('');
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
  $('productImagem').value = p.imagem_url || '';
  $('productDisponivel').checked = p.disponivel;
  $('productDestaque').checked = p.destaque || false;
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
  const id = $('productId').value;
  const payload = {
    nome: $('productNome').value.trim(),
    categoria: $('productCategoria').value.trim(),
    descricao: $('productDescricao').value.trim(),
    preco: parseFloat($('productPreco').value),
    ordem: parseInt($('productOrdem').value) || 0,
    imagem_url: $('productImagem').value.trim() || null,
    disponivel: $('productDisponivel').checked,
    destaque: $('productDestaque').checked,
  };

  try {
    if (id) {
      const { error } = await sb.from('produtos').update(payload).eq('id', parseInt(id));
      if (error) throw error;
      showToast('Produto atualizado!', 'success');
    } else {
      const { error } = await sb.from('produtos').insert([payload]);
      if (error) throw error;
      showToast('Produto criado!', 'success');
    }
    $('productFormModal').classList.add('hidden');
    loadProducts();
  } catch (err) {
    showToast('Erro ao salvar produto: ' + err.message, 'error');
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
//  CONFIG
// ============================================================
const configSections = {
  geral: { icon: 'fa-store', title: 'Geral', keys: ['restaurant_name', 'restaurant_subtitle', 'footer_text'] },
  contato: { icon: 'fa-phone', title: 'Contato', keys: ['whatsapp_number', 'instagram_url', 'email', 'facebook_url'] },
  endereco: { icon: 'fa-map-marker-alt', title: 'Endereço', keys: ['address', 'google_maps_embed', 'google_maps_link'] },
  entrega: { icon: 'fa-motorcycle', title: 'Entrega', keys: ['delivery_fee', 'min_order', 'delivery_time'] },
  pagamento: { icon: 'fa-credit-card', title: 'Pagamento', keys: ['infinitepay_handle'] },
  visual: { icon: 'fa-palette', title: 'Visual', keys: ['primary_color', 'accent_color', 'hero_image'] },
};

async function loadConfig() {
  try {
    const { data, error } = await sb.from('site_config').select('*');
    if (error) throw error;
    configData = {};
    (data || []).forEach(row => { configData[row.key] = row; });
    renderConfig();
  } catch (err) {
    console.error('Config error:', err);
  }
}

function renderConfig() {
  const grid = $('configGrid');
  grid.innerHTML = '';
  for (const [section, info] of Object.entries(configSections)) {
    const card = document.createElement('div');
    card.className = 'config-card';
    let fieldsHtml = '';
    info.keys.forEach(key => {
      const row = configData[key];
      if (!row) return;
      const label = row.label || key;
      const val = row.value || '';
      const isTextarea = val.length > 80 || key.includes('embed') || key.includes('link');
      fieldsHtml += `
        <div class="config-field">
          <label>${escapeHtml(label)}</label>
          ${isTextarea ?
            `<textarea data-config-key="${key}" rows="3">${escapeHtml(val)}</textarea>` :
            `<input type="text" data-config-key="${key}" value="${escapeHtml(val)}">`}
        </div>`;
    });
    card.innerHTML = `<h4><i class="fas ${info.icon}"></i> ${info.title}</h4>${fieldsHtml}`;
    grid.appendChild(card);
  }
}

$('btnSaveConfig').addEventListener('click', async () => {
  const fields = $$('[data-config-key]');
  const updates = [];
  fields.forEach(field => {
    const key = field.dataset.configKey;
    const value = field.value;
    updates.push(sb.from('site_config').update({ value }).eq('key', key));
  });

  try {
    await Promise.all(updates);
    showToast('Configurações salvas!', 'success');
  } catch (err) {
    showToast('Erro ao salvar configurações', 'error');
  }
});

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
