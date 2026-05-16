// supabase/functions/enviar-pedido-saipos/index.ts
// Envia um pedido para a API da Saipos e salva o resultado
//
// Chamada pelo painel admin:
//   POST /functions/v1/enviar-pedido-saipos
//   Body: { "pedido_id": 42 }
//   Header: Authorization: Bearer <SUPABASE_ANON_KEY>
//
// Variáveis de ambiente necessárias (Supabase → Settings → Edge Functions):
//   SAIPOS_API_BASE    = https://api.saipos.com  (confirmar com Saipos)
//   SAIPOS_API_KEY     = sua chave de API Saipos
//   SAIPOS_STORE_ID    = ID do estabelecimento na Saipos
//
// @ts-nocheck

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Adapta status do site para o formato Saipos
function mapFormaPagamento(formaPagamento: string): string {
  const map: Record<string, string> = {
    "erede":              "CREDIT_CARD",
    "infinitepay":        "CREDIT_CARD",
    "na_entrega_dinheiro": "CASH",
    "na_entrega_cartao":  "DEBIT_CARD",
    "na_entrega_pix":     "PIX",
  };
  return map[formaPagamento] || "CASH";
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  // Variáveis obrigatórias
  const SAIPOS_API_BASE = Deno.env.get("SAIPOS_API_BASE") || "";
  const SAIPOS_API_KEY  = Deno.env.get("SAIPOS_API_KEY")  || "";
  const SAIPOS_STORE_ID = Deno.env.get("SAIPOS_STORE_ID") || "";

  if (!SAIPOS_API_BASE || !SAIPOS_API_KEY || !SAIPOS_STORE_ID) {
    return json({
      error: "Configuração Saipos incompleta. Defina SAIPOS_API_BASE, SAIPOS_API_KEY e SAIPOS_STORE_ID.",
    }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Payload JSON inválido" }, 400);
  }

  const pedidoId = Number(body.pedido_id);
  if (!pedidoId || isNaN(pedidoId)) {
    return json({ error: "pedido_id é obrigatório" }, 400);
  }

  // Supabase client com service_role para acesso total
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  // --- Buscar pedido + itens normalizados ---
  const { data: pedido, error: pedidoErr } = await sb
    .from("pedidos")
    .select("*")
    .eq("id", pedidoId)
    .single();

  if (pedidoErr || !pedido) {
    return json({ error: "Pedido não encontrado", detail: pedidoErr?.message }, 404);
  }

  if (pedido.enviado_saipos) {
    return json({ error: "Pedido já foi enviado para a Saipos", id_saipos: pedido.id_saipos }, 409);
  }

  const { data: itens } = await sb
    .from("pedido_itens")
    .select("*")
    .eq("pedido_id", pedidoId);

  // --- Montar payload no formato esperado pela Saipos ---
  // ATENÇÃO: ajuste os campos conforme a documentação real da API Saipos
  const saiposPayload = {
    store_id:    SAIPOS_STORE_ID,
    external_id: String(pedido.id),              // nosso ID, para rastrear webhook
    customer: {
      name:  pedido.nome_cliente   || "Cliente",
      phone: pedido.telefone_cliente || "",
      email: pedido.email_cliente   || "",
      cpf:   pedido.cpf_cliente     || "",
    },
    delivery: {
      type:    pedido.forma_entrega === "retirada" ? "PICKUP" : "DELIVERY",
      address: pedido.forma_entrega === "retirada" ? null : {
        street:       pedido.rua           || pedido.endereco_entrega || "",
        number:       pedido.numero        || "",
        complement:   pedido.complemento   || "",
        neighborhood: pedido.bairro        || "",
        city:         pedido.cidade        || "",
        state:        pedido.estado        || "SP",
        postal_code:  pedido.cep           || "",
      },
    },
    payment: {
      method: mapFormaPagamento(pedido.forma_pagamento),
      change: pedido.troco_para ? Number(pedido.troco_para) : null,
      total:  Number(pedido.total),
    },
    items: (itens || []).map((item: Record<string, unknown>) => ({
      external_id: String(item.produto_id || ""),
      sku:         item.codigo_saipos || null,
      name:        item.nome,
      quantity:    item.quantidade,
      unit_price:  Number(item.preco_unitario),
      total_price: Number(item.preco_unitario) * Number(item.quantidade),
      note:        item.observacao || null,
    })),
    totals: {
      subtotal:  Number(pedido.valor_subtotal || 0),
      delivery:  Number(pedido.valor_entrega  || 0),
      discount:  Number(pedido.valor_desconto || 0),
      total:     Number(pedido.total),
    },
    note: pedido.observacoes || null,
    origin: "SITE",
  };

  console.log("[enviar-pedido-saipos] Enviando pedido", pedidoId, "→ Saipos");

  // --- Chamar API da Saipos ---
  let saiposResponse: Response;
  let saiposData: Record<string, unknown> = {};
  let apiError: string | null = null;

  try {
    saiposResponse = await fetch(`${SAIPOS_API_BASE}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SAIPOS_API_KEY}`,
        "X-Store-Id":   SAIPOS_STORE_ID,
      },
      body: JSON.stringify(saiposPayload),
    });

    const rawText = await saiposResponse.text();
    try {
      saiposData = JSON.parse(rawText);
    } catch {
      saiposData = { raw: rawText };
    }
  } catch (fetchErr: unknown) {
    apiError = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
  }

  const sucesso = !apiError && saiposResponse!.ok;
  const saiposOrderId = sucesso
    ? (String(saiposData.id || saiposData.order_id || saiposData.orderId || ""))
    : null;

  // --- Salvar log ---
  await sb.from("integracao_logs").insert({
    tipo:             "envio_pedido",
    pedido_id:        pedidoId,
    payload_enviado:  saiposPayload,
    payload_recebido: saiposData,
    status:           sucesso ? "sucesso" : "erro",
    erro_mensagem:    apiError || (sucesso ? null : `HTTP ${saiposResponse!.status}`),
  });

  // --- Atualizar pedido ---
  if (sucesso) {
    await sb.from("pedidos").update({
      enviado_saipos:      true,
      data_envio_saipos:   new Date().toISOString(),
      id_saipos:           saiposOrderId || null,
      erro_saipos:         null,
    }).eq("id", pedidoId);

    console.log(`[enviar-pedido-saipos] Pedido ${pedidoId} enviado. Saipos ID: ${saiposOrderId}`);
    return json({ ok: true, pedido_id: pedidoId, id_saipos: saiposOrderId });
  } else {
    const errMsg = apiError || `Saipos retornou HTTP ${saiposResponse!.status}`;
    await sb.from("pedidos").update({
      erro_saipos: errMsg,
    }).eq("id", pedidoId);

    console.error("[enviar-pedido-saipos] Falha:", errMsg, saiposData);
    return json({ error: errMsg, detail: saiposData }, 502);
  }
});
