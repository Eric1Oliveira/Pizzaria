/**
 * Print Studio — editor visual de cupom + render por blocos
 */
(function (global) {
  'use strict';

  const SAMPLE_ORDER = {
    id: 14955,
    created_at: new Date().toISOString(),
    nome_cliente: 'emporio casa jose silva',
    telefone_cliente: '(11) 96566-5646',
    cpf_cliente: '446.774.878-47',
    endereco_entrega: 'Rua Exemplo, 123 - Centro',
    itens: [
      { id: 1, nome: 'Feijoada - Serve 4 pessoas (Somente de Quartas e Sabados)', preco: 89.99, qty: 1, categoria: 'Almoco - Serve 4 pessoas' },
      { id: 2, nome: 'Picanha grelhada - 4 pessoas', preco: 129.99, qty: 1, categoria: 'Almoco - Serve 4 pessoas', obs: 'Somente picanha e batata frita' }
    ],
    valor_subtotal: 359.98,
    valor_entrega: 0,
    valor_desconto: 40,
    total: 319.99,
    forma_pagamento: 'na_entrega_dinheiro',
    observacoes: 'Natalia 123 7',
    forma_entrega: 'delivery',
    canal_venda: 'mesa',
    mesa: '0'
  };

  const DEFAULT_BILL_BLOCKS = [
    { id: 'stars_top', type: 'separator', variant: 'stars', visible: true },
    { id: 'via_title', type: 'text', content: 'VIA PARA ENTREGA', align: 'center', size: 'md', bold: true, visible: true },
    { id: 'stars_after_title', type: 'separator', variant: 'stars', visible: true },
    { id: 'system_line', type: 'text', content: 'WABiz - Delivery System  Via: 1', align: 'left', size: 'sm', visible: true },
    { id: 'store_line', type: 'field', field: 'store_full', align: 'left', size: 'sm', visible: true },
    { id: 'order_number', type: 'field', field: 'order_id', prefix: 'Pedido n. ', size: 'xl', visible: true },
    { id: 'order_date', type: 'field', field: 'order_datetime', prefix: 'Data: ', visible: true },
    { id: 'div_1', type: 'separator', variant: 'dashed', visible: true },
    { id: 'customer', type: 'field', field: 'customer_name', prefix: 'Cliente: ', visible: true },
    { id: 'phone', type: 'field', field: 'customer_phone', prefix: 'Telefone: ', visible: true },
    { id: 'cpf', type: 'field', field: 'customer_cpf', prefix: 'CPF: ', visible: true },
    { id: 'div_2', type: 'separator', variant: 'dashed', visible: true },
    { id: 'mesa_badge', type: 'field', field: 'mesa_label', style: 'inverted', visible: true },
    { id: 'div_3', type: 'separator', variant: 'dashed', visible: true },
    { id: 'items_title', type: 'text', content: 'ITENS:', bold: true, visible: true },
    { id: 'div_4', type: 'separator', variant: 'dashed', visible: true },
    { id: 'items', type: 'items', showCategory: true, visible: true },
    { id: 'div_5', type: 'separator', variant: 'dashed', visible: true },
    { id: 'total', type: 'field', field: 'total', prefix: 'TOTAL:', align: 'split', size: 'md', bold: true, visible: true },
    { id: 'div_6', type: 'separator', variant: 'dashed', visible: true },
    { id: 'obs', type: 'field', field: 'order_obs', prefix: 'Obs: ', visible: true },
    { id: 'collect', type: 'field', field: 'collect_amount', prefix: 'Cobrar do cliente ', visible: true },
    { id: 'div_7', type: 'separator', variant: 'dashed', visible: true },
    { id: 'fiscal', type: 'text', content: '*********CUPOM SEM VALOR FISCAL*********', align: 'center', size: 'sm', visible: true }
  ];

  const DEFAULT_KITCHEN_BLOCKS = [
    { id: 'k_title', type: 'text', content: 'VIA COZINHA', align: 'center', size: 'lg', bold: true, visible: true },
    { id: 'k_sub', type: 'text', content: 'Comanda de preparo', align: 'center', size: 'sm', visible: true },
    { id: 'k_div1', type: 'separator', variant: 'dashed', visible: true },
    { id: 'k_order', type: 'field', field: 'order_id', prefix: 'Pedido #', size: 'lg', align: 'center', visible: true },
    { id: 'k_date', type: 'field', field: 'order_datetime', align: 'center', size: 'sm', visible: true },
    { id: 'k_type', type: 'field', field: 'delivery_type', align: 'center', visible: true },
    { id: 'k_div2', type: 'separator', variant: 'dashed', visible: true },
    { id: 'k_items', type: 'items', showCategory: false, visible: true },
    { id: 'k_obs', type: 'field', field: 'order_obs', prefix: 'Obs: ', visible: true }
  ];

  let state = {
    docType: 'bill',
    billBlocks: cloneBlocks(DEFAULT_BILL_BLOCKS),
    kitchenBlocks: cloneBlocks(DEFAULT_KITCHEN_BLOCKS),
    selectedBlockId: null,
    paperWidth: 78
  };

  function cloneBlocks(blocks) {
    return JSON.parse(JSON.stringify(blocks || []));
  }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  function fmtMoney(v) {
    if (typeof global.formatMoney === 'function') return global.formatMoney(v);
    return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  }

  function fmtMoneyPlain(v) {
    return Number(v || 0).toFixed(2).replace('.', ',');
  }

  function getCfg(key) {
    if (typeof global.cfg === 'function') return global.cfg(key) || '';
    return '';
  }

  function resolveField(field, order) {
    const items = Array.isArray(order.itens) ? order.itens : [];
    const isMesa = String(order.canal_venda || '').toLowerCase() === 'mesa';
    const mesaMatch = (order.observacoes || '').match(/\[Mesa ([^\]]+)\]/);
    const mesaNum = order.mesa != null ? String(order.mesa) : (mesaMatch ? mesaMatch[1] : '');
    const obs = (order.observacoes || '').replace(/\[Mesa [^\]]+\]/, '').trim();
    const restaurant = getCfg('restaurant_name') || 'Emporio Casa Jose Silva';
    const city = [getCfg('city'), getCfg('state')].filter(Boolean).join(' - ');
    const storeFull = [restaurant, city].filter(Boolean).join(' - ');
    const date = order.created_at
      ? new Date(order.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '';
    const tipoMap = { delivery: 'DELIVERY', retirada: 'RETIRADA', domo_home: 'DOMO HOME' };
    const tipo = isMesa && mesaNum ? `MESA ${mesaNum}` : (tipoMap[order.forma_entrega] || String(order.forma_entrega || '').toUpperCase());
    const payMap = {
      erede: 'Crédito online', erede_debito: 'Débito online', pix: 'Pix online',
      na_entrega_dinheiro: 'Dinheiro', na_entrega_cartao: 'Cartão', na_entrega_pix: 'Pix'
    };
    const pay = payMap[String(order.forma_pagamento || '').toLowerCase()] || (order.forma_pagamento || '');
    const total = Number(order.total || 0);
    const collect = String(order.forma_pagamento || '').startsWith('na_entrega') ? total : '';

    const map = {
      store_full: storeFull,
      order_id: String(order.id || ''),
      order_datetime: date,
      customer_name: order.nome_cliente || '',
      customer_phone: order.telefone_cliente || '',
      customer_cpf: order.cpf_cliente || '',
      customer_address: order.endereco_entrega || '',
      delivery_type: tipo,
      mesa_label: isMesa || mesaNum !== '' ? `Pedido na mesa: ${mesaNum || '0'}` : '',
      order_obs: obs,
      payment: pay,
      subtotal: fmtMoneyPlain(order.valor_subtotal || items.reduce((s, i) => s + Number(i.preco || 0) * Number(i.qty || 0), 0)),
      total: fmtMoneyPlain(total),
      collect_amount: collect ? fmtMoneyPlain(collect) : '',
      items_count: String(items.reduce((s, i) => s + Number(i.qty || 0), 0))
    };
    return map[field] != null ? String(map[field]) : '';
  }

  function renderItemsHtml(block, order) {
    const items = Array.isArray(order.itens) ? order.itens : [];
    if (!items.length) return '<div class="rb rb--muted">(sem itens)</div>';
    const showCat = block.showCategory !== false;
    let html = '';
    let lastCat = '';
    items.forEach(item => {
      const cat = item.categoria || item.category || '';
      const nome = item.nome || '';
      const qty = Number(item.qty || 1);
      const itemObs = item.obs || '';
      if (showCat && cat && cat !== lastCat) {
        html += `<div class="rb rb--cat">${esc(cat)}</div>`;
        lastCat = cat;
      }
      html += `<div class="rb rb--item">${qty}x ${esc(nome)}</div>`;
      if (itemObs) html += `<div class="rb rb--item-obs">Obs: ${esc(itemObs)}</div>`;
    });
    return html;
  }

  function blockToHtml(block, order) {
    if (!block.visible) return '';
    if (block.type === 'separator') {
      if (block.variant === 'stars') {
        return '<div class="rb rb--stars">* * * * * * * * * * * * * * * * * * * *</div>';
      }
      return '<hr class="rb rb--rule">';
    }
    if (block.type === 'items') {
      return renderItemsHtml(block, order);
    }
    if (block.type === 'text') {
      const align = block.align === 'center' ? ' rb--c' : '';
      const size = block.size ? ` rb--${block.size}` : '';
      const bold = block.bold ? ' rb--b' : '';
      const inv = block.style === 'inverted' ? ' rb--inv' : '';
      return `<div class="rb rb--text${align}${size}${bold}${inv}">${esc(block.content || '')}</div>`;
    }
    if (block.type === 'field') {
      const val = resolveField(block.field, order);
      if (!val) return '';
      const text = `${block.prefix || ''}${val}`;
      if (block.style === 'inverted') {
        return `<div class="rb rb--inv">${esc(text)}</div>`;
      }
      if (block.align === 'split' || block.field === 'total') {
        const parts = text.split(':');
        const label = parts[0] + (text.includes(':') ? ':' : '');
        const amount = block.field === 'total' ? val : parts.slice(1).join(':').trim();
        return `<div class="rb rb--split"><span class="rb--b">${esc(label)}</span><span class="rb--b">${esc(amount)}</span></div>`;
      }
      const align = block.align === 'center' ? ' rb--c' : '';
      const size = block.size === 'xl' ? ' rb--xl' : (block.size === 'lg' ? ' rb--lg' : '');
      const bold = block.bold ? ' rb--b' : '';
      return `<div class="rb rb--field${align}${size}${bold}">${esc(text)}</div>`;
    }
    return '';
  }

  function renderReceiptHtml(blocks, order, opts = {}) {
    const width = opts.width || state.paperWidth || 78;
    const body = (blocks || []).map(b => blockToHtml(b, order)).join('\n');
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Cupom</title><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:'Courier New',Consolas,monospace;font-size:13px;width:${width}mm;padding:4mm 3mm 8mm;background:#fff;color:#000;line-height:1.35}
      .rb{margin:2px 0;word-break:break-word}
      .rb--c{text-align:center}
      .rb--b{font-weight:700}
      .rb--sm{font-size:11px}
      .rb--md{font-size:14px;font-weight:700}
      .rb--lg{font-size:16px;font-weight:800}
      .rb--xl{font-size:20px;font-weight:800;margin:4px 0}
      .rb--stars{text-align:center;font-size:11px;letter-spacing:1px;margin:4px 0}
      .rb--rule{border:none;border-top:1px dashed #000;margin:6px 0}
      .rb--inv{background:#000;color:#fff;padding:4px 6px;font-weight:700;margin:6px 0}
      .rb--split{display:flex;justify-content:space-between;align-items:baseline;font-weight:700;margin:4px 0}
      .rb--cat{font-weight:700;margin-top:4px}
      .rb--item{margin:2px 0 4px;font-weight:700}
      .rb--item-obs{font-size:11px;margin:0 0 4px 8px}
      .rb--muted{color:#666;font-style:italic}
      @media print{#__pb{display:none!important}html,body{width:${width}mm}@page{size:${width}mm auto;margin:0}}
    </style></head><body>${body}</body></html>`;
  }

  function getBlocks(docType) {
    return docType === 'kitchen' ? state.kitchenBlocks : state.billBlocks;
  }

  function setBlocks(docType, blocks) {
    if (docType === 'kitchen') state.kitchenBlocks = cloneBlocks(blocks);
    else state.billBlocks = cloneBlocks(blocks);
  }

  function getBlockById(id, docType) {
    return getBlocks(docType || state.docType).find(b => b.id === id) || null;
  }

  function updateBlock(id, patch, docType) {
    const blocks = getBlocks(docType || state.docType);
    const idx = blocks.findIndex(b => b.id === id);
    if (idx < 0) return;
    blocks[idx] = { ...blocks[idx], ...patch };
    renderEditorPreview();
    renderBlockList();
    syncPreviewFrame();
  }

  function moveBlock(id, dir) {
    const blocks = getBlocks();
    const idx = blocks.findIndex(b => b.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= blocks.length) return;
    [blocks[idx], blocks[swap]] = [blocks[swap], blocks[idx]];
    renderEditorPreview();
    renderBlockList();
    syncPreviewFrame();
  }

  function renderEditorPreview() {
    const el = document.getElementById('receiptEditorPreview');
    if (!el) return;
    const order = global._PRINT_PREVIEW_SAMPLE_ORDER || SAMPLE_ORDER;
    const blocks = getBlocks(state.docType);
    const parts = blocks.filter(b => b.visible).map(block => {
      const selected = block.id === state.selectedBlockId ? ' is-selected' : '';
      const inner = blockToHtml({ ...block, visible: true }, order) || `<div class="rb rb--muted">(${blockLabel(block)})</div>`;
      return `<div class="receipt-block${selected}" data-block-id="${block.id}" tabindex="0" title="Clique para editar">${inner}</div>`;
    }).join('');
    el.innerHTML = parts;
    el.querySelectorAll('.receipt-block').forEach(node => {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        selectBlock(node.dataset.blockId);
      });
    });
  }

  function blockLabel(block) {
    if (block.type === 'text') return block.content || 'Texto';
    if (block.type === 'items') return 'Lista de itens';
    if (block.type === 'separator') return block.variant === 'stars' ? 'Linha ***' : 'Linha tracejada';
    const names = {
      store_full: 'Nome da loja', order_id: 'Número do pedido', order_datetime: 'Data/hora',
      customer_name: 'Cliente', customer_phone: 'Telefone', customer_cpf: 'CPF',
      mesa_label: 'Mesa', order_obs: 'Observações', total: 'Total', collect_amount: 'Valor a cobrar'
    };
    return names[block.field] || block.field || 'Campo';
  }

  function renderBlockList() {
    const list = document.getElementById('printBlockList');
    if (!list) return;
    const blocks = getBlocks(state.docType);
    list.innerHTML = blocks.map((block, i) => {
      const active = block.id === state.selectedBlockId ? ' is-active' : '';
      const hidden = block.visible ? '' : ' is-hidden';
      return `<button type="button" class="print-block-list__item${active}${hidden}" data-id="${block.id}">
        <span class="print-block-list__label">${esc(blockLabel(block))}</span>
        <span class="print-block-list__actions">
          <i class="fas fa-eye${block.visible ? '' : '-slash'}" data-act="toggle" title="Mostrar/ocultar"></i>
          ${i > 0 ? '<i class="fas fa-arrow-up" data-act="up"></i>' : ''}
          ${i < blocks.length - 1 ? '<i class="fas fa-arrow-down" data-act="down"></i>' : ''}
        </span>
      </button>`;
    }).join('');

    list.querySelectorAll('.print-block-list__item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset?.act;
        const id = btn.dataset.id;
        if (act === 'toggle') {
          e.stopPropagation();
          const b = getBlockById(id);
          updateBlock(id, { visible: !b.visible });
          return;
        }
        if (act === 'up') { e.stopPropagation(); moveBlock(id, -1); return; }
        if (act === 'down') { e.stopPropagation(); moveBlock(id, 1); return; }
        selectBlock(id);
      });
    });
  }

  function selectBlock(id) {
    state.selectedBlockId = id;
    renderEditorPreview();
    renderBlockList();
    renderInspector();
  }

  function renderInspector() {
    const panel = document.getElementById('printBlockInspector');
    if (!panel) return;
    const block = state.selectedBlockId ? getBlockById(state.selectedBlockId) : null;
    if (!block) {
      panel.innerHTML = '<p class="print-inspector__empty">Clique em qualquer linha do cupom à direita para editar.</p>';
      return;
    }

    let html = `<h4 class="print-inspector__title">${esc(blockLabel(block))}</h4>`;
    html += `<label class="switch-label print-inspector__row"><input type="checkbox" id="inspVisible" ${block.visible ? 'checked' : ''}><span class="switch"></span> Exibir no cupom</label>`;

    if (block.type === 'text') {
      html += `<label class="print-inspector__lbl">Texto</label>
        <textarea id="inspContent" class="printer-cfg-modal__input" rows="2">${esc(block.content || '')}</textarea>`;
      html += inspectorAlignSize(block);
    } else if (block.type === 'field') {
      html += `<label class="print-inspector__lbl">Texto antes do valor</label>
        <input type="text" id="inspPrefix" class="printer-cfg-modal__input" value="${esc(block.prefix || '')}">`;
      html += `<p class="print-inspector__hint">O valor vem automaticamente do pedido (${esc(block.field)}).</p>`;
      if (block.field === 'total') {
        html += `<label class="print-inspector__lbl">Alinhamento total</label>
          <select id="inspAlign" class="printer-cfg-modal__input">
            <option value="split" ${block.align === 'split' ? 'selected' : ''}>Label à esquerda · valor à direita</option>
            <option value="left" ${block.align !== 'split' ? 'selected' : ''}>Linha simples</option>
          </select>`;
      } else {
        html += inspectorAlignSize(block);
      }
      if (block.field === 'mesa_label') {
        html += `<label class="switch-label print-inspector__row"><input type="checkbox" id="inspInverted" ${block.style === 'inverted' ? 'checked' : ''}><span class="switch"></span> Fundo preto (destaque)</label>`;
      }
    } else if (block.type === 'items') {
      html += `<label class="switch-label print-inspector__row"><input type="checkbox" id="inspShowCat" ${block.showCategory !== false ? 'checked' : ''}><span class="switch"></span> Mostrar categoria acima do item</label>`;
    } else if (block.type === 'separator') {
      html += `<label class="print-inspector__lbl">Estilo da linha</label>
        <select id="inspVariant" class="printer-cfg-modal__input">
          <option value="dashed" ${block.variant !== 'stars' ? 'selected' : ''}>Tracejada</option>
          <option value="stars" ${block.variant === 'stars' ? 'selected' : ''}>Asteriscos (* * *)</option>
        </select>`;
    }

    panel.innerHTML = html;
    bindInspector(block);
  }

  function inspectorAlignSize(block) {
    return `<label class="print-inspector__lbl">Alinhamento</label>
      <select id="inspAlign" class="printer-cfg-modal__input">
        <option value="left" ${!block.align || block.align === 'left' ? 'selected' : ''}>Esquerda</option>
        <option value="center" ${block.align === 'center' ? 'selected' : ''}>Centro</option>
      </select>
      <label class="print-inspector__lbl">Tamanho</label>
      <select id="inspSize" class="printer-cfg-modal__input">
        <option value="sm" ${block.size === 'sm' ? 'selected' : ''}>Pequeno</option>
        <option value="md" ${block.size === 'md' ? 'selected' : ''}>Médio</option>
        <option value="lg" ${block.size === 'lg' ? 'selected' : ''}>Grande</option>
        <option value="xl" ${block.size === 'xl' ? 'selected' : ''}>Extra grande (nº pedido)</option>
      </select>
      <label class="switch-label print-inspector__row"><input type="checkbox" id="inspBold" ${block.bold ? 'checked' : ''}><span class="switch"></span> Negrito</label>`;
  }

  function bindInspector(block) {
    const id = block.id;
    $('inspVisible')?.addEventListener('change', e => updateBlock(id, { visible: e.target.checked }));
    $('inspContent')?.addEventListener('input', e => updateBlock(id, { content: e.target.value }));
    $('inspPrefix')?.addEventListener('input', e => updateBlock(id, { prefix: e.target.value }));
    $('inspAlign')?.addEventListener('change', e => updateBlock(id, { align: e.target.value }));
    $('inspSize')?.addEventListener('change', e => updateBlock(id, { size: e.target.value }));
    $('inspBold')?.addEventListener('change', e => updateBlock(id, { bold: e.target.checked }));
    $('inspInverted')?.addEventListener('change', e => updateBlock(id, { style: e.target.checked ? 'inverted' : 'normal' }));
    $('inspShowCat')?.addEventListener('change', e => updateBlock(id, { showCategory: e.target.checked }));
    $('inspVariant')?.addEventListener('change', e => updateBlock(id, { variant: e.target.value }));
  }

  function $(id) { return document.getElementById(id); }

  function setDocType(type) {
    state.docType = type;
    state.selectedBlockId = null;
    document.querySelectorAll('[data-print-doc]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.printDoc === type);
    });
    const hint = $('printEditorDocHint');
    if (hint) {
      hint.textContent = type === 'kitchen'
        ? 'Comanda enviada para a cozinha quando um pedido novo chega (se ativado).'
        : 'Cupom de entrega / nota — layout padrão do cliente (imagem de referência).';
    }
    renderBlockList();
    renderEditorPreview();
    renderInspector();
    syncPreviewFrame();
  }

  function syncPreviewFrame() {
    const frame = $('printerPreviewFrame');
    if (!frame) return;
    const order = global._PRINT_PREVIEW_SAMPLE_ORDER || SAMPLE_ORDER;
    frame.srcdoc = renderReceiptHtml(getBlocks(state.docType), order);
  }

  function collectLayoutPayload() {
    return {
      layoutMode: 'blocks',
      billBlocks: cloneBlocks(state.billBlocks),
      kitchenBlocks: cloneBlocks(state.kitchenBlocks),
      paperWidth: state.paperWidth
    };
  }

  function loadLayoutPayload(printLayout) {
    const pl = printLayout || {};
    if (Array.isArray(pl.billBlocks) && pl.billBlocks.length) {
      state.billBlocks = cloneBlocks(pl.billBlocks);
    }
    if (Array.isArray(pl.kitchenBlocks) && pl.kitchenBlocks.length) {
      state.kitchenBlocks = cloneBlocks(pl.kitchenBlocks);
    }
    state.paperWidth = pl.paperWidth || 78;
  }

  function migrateLegacyLayout(printLayout) {
    if (Array.isArray(printLayout?.billBlocks) && printLayout.billBlocks.length) return;
    const L = printLayout || {};
    const blocks = cloneBlocks(DEFAULT_BILL_BLOCKS);
    const setText = (id, content) => {
      const b = blocks.find(x => x.id === id);
      if (b && content) b.content = content;
    };
    setText('via_title', L.billTitle || 'VIA PARA ENTREGA');
    setText('system_line', L.billSubtitle || '');
    setText('fiscal', L.billFooter || '*********CUPOM SEM VALOR FISCAL*********');
    const vis = (id, v) => { const b = blocks.find(x => x.id === id); if (b) b.visible = v !== false; };
    vis('customer', L.billShowCustomer !== false);
    vis('phone', L.billShowPhone !== false);
    vis('cpf', true);
    vis('obs', L.billShowNotes !== false);
    vis('collect', L.billShowPayment !== false);
    state.billBlocks = blocks;
  }

  function bindPrinterUI(settings) {
    const s = settings || {};
    const setMode = (type, mode) => {
      const win = $(`print${type}UseWindows`);
      const named = $(`print${type}UseNamed`);
      if (win) win.checked = mode !== 'named';
      if (named) named.checked = mode === 'named';
      const row = $(`print${type}NamedRow`);
      if (row) row.classList.toggle('hidden', mode !== 'named');
    };
    setMode('Kitchen', s.kitchenPrinterMode === 'named' ? 'named' : 'windows');
    setMode('Bill', s.billPrinterMode === 'named' ? 'named' : 'windows');
    if ($('printerNameKitchen')) $('printerNameKitchen').value = s.kitchenPrinter || '';
    if ($('printerNameBill')) $('printerNameBill').value = s.billPrinter || '';
    if ($('printAutoPrintToggle')) {
      $('printAutoPrintToggle').checked = !!s.autoPrint;
    }
    if ($('printOptKitchenStudio')) $('printOptKitchenStudio').checked = s.printKitchen !== false;
    if ($('printOptBillStudio')) $('printOptBillStudio').checked = s.printBill !== false;
    updateAutoPrintHint();
  }

  function collectPrinterPayload() {
    return {
      autoPrint: !!$('printAutoPrintToggle')?.checked,
      printKitchen: !!$('printOptKitchenStudio')?.checked,
      printBill: !!$('printOptBillStudio')?.checked,
      kitchenPrinterMode: $('printKitchenUseNamed')?.checked ? 'named' : 'windows',
      billPrinterMode: $('printBillUseNamed')?.checked ? 'named' : 'windows',
      kitchenPrinter: ($('printerNameKitchen')?.value || '').trim(),
      billPrinter: ($('printerNameBill')?.value || '').trim()
    };
  }

  function updateAutoPrintHint() {
    const el = $('printAutoPrintHint');
    if (!el) return;
    const on = !!$('printAutoPrintToggle')?.checked;
    el.textContent = on
      ? 'Ligado: ao chegar pedido novo, imprime automaticamente (conforme opções abaixo).'
      : 'Desligado: impressão só manual pelo botão no pedido.';
    el.classList.toggle('is-on', on);
  }

  function renderPrinterChipsStudio(type) {
    if (typeof global.renderPrinterChips === 'function') {
      global.renderPrinterChips(type);
    }
  }

  function init(settings) {
    const s = settings || {};
    const pl = s.printLayout || {};
    migrateLegacyLayout(pl);
    loadLayoutPayload(pl);
    bindPrinterUI(s);

    document.querySelectorAll('[data-print-doc]').forEach(btn => {
      btn.addEventListener('click', () => setDocType(btn.dataset.printDoc));
    });
    $('printAutoPrintToggle')?.addEventListener('change', updateAutoPrintHint);
    ['printKitchenUseWindows', 'printKitchenUseNamed', 'printBillUseWindows', 'printBillUseNamed'].forEach(id => {
      $(id)?.addEventListener('change', () => {
        bindPrinterUI({
          kitchenPrinterMode: $('printKitchenUseNamed')?.checked ? 'named' : 'windows',
          billPrinterMode: $('printBillUseNamed')?.checked ? 'named' : 'windows'
        });
      });
    });
    $('printerNameKitchen')?.addEventListener('input', () => renderPrinterChipsStudio('kitchen'));
    $('printerNameBill')?.addEventListener('input', () => renderPrinterChipsStudio('bill'));

    $('btnPrintStudioTest')?.addEventListener('click', () => {
      const order = global._PRINT_PREVIEW_SAMPLE_ORDER || SAMPLE_ORDER;
      const html = renderReceiptHtml(getBlocks(state.docType), order);
      const printer = state.docType === 'kitchen'
        ? (global._resolvePrinterName?.('kitchen') || '')
        : (global._resolvePrinterName?.('bill') || '');
      if (typeof global._printOpen === 'function') {
        global._printOpen(html, 'auto', printer);
      }
    });

    $('btnPrintStudioReset')?.addEventListener('click', () => {
      if (!confirm('Restaurar layout padrão deste cupom?')) return;
      if (state.docType === 'kitchen') state.kitchenBlocks = cloneBlocks(DEFAULT_KITCHEN_BLOCKS);
      else state.billBlocks = cloneBlocks(DEFAULT_BILL_BLOCKS);
      state.selectedBlockId = null;
      renderBlockList();
      renderEditorPreview();
      renderInspector();
      syncPreviewFrame();
    });

    setDocType('bill');
    renderPrinterChipsStudio('kitchen');
    renderPrinterChipsStudio('bill');
  }

  global.PrintStudio = {
    init,
    setDocType,
    getBlocks,
    setBlocks,
    collectLayoutPayload,
    loadLayoutPayload,
    collectPrinterPayload,
    bindPrinterUI,
    renderReceiptHtml,
    renderEditorPreview: syncPreviewFrame,
    DEFAULT_BILL_BLOCKS,
    DEFAULT_KITCHEN_BLOCKS,
    SAMPLE_ORDER
  };

  global._PRINT_PREVIEW_SAMPLE_ORDER = SAMPLE_ORDER;

})(window);
