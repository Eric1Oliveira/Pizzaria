// supabase/functions/saipos-webhook/index.ts
// Recebe notificações de status da Saipos via webhook
// URL pública: https://<projeto>.supabase.co/functions/v1/saipos-webhook
//
// Configure em Saipos: Configurações → Integrações → Webhook URL = essa URL
// Adicione o header X-Saipos-Secret = valor do env SAIPOS_WEBHOOK_SECRET
//
// @ts-nocheck

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Saipos-Secret, Authorization",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Mapeamento de status Saipos → status do site
const STATUS_MAP: Record<string, string> = {
  "ACCEPTED":   "confirmado",
  "PREPARING":  "preparando",
  "DISPATCHED": "saiu",
  "DELIVERED":  "entregue",
  "CANCELLED":  "cancelado",
  // variações comuns
  "accepted":   "confirmado",
  "preparing":  "preparando",
  "dispatched": "saiu",
  "delivered":  "entregue",
  "cancelled":  "cancelado",
  "canceled":   "cancelado",
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  // --- Autenticação do webhook via secret ---
  const webhookSecret = Deno.env.get("SAIPOS_WEBHOOK_SECRET");
  if (webhookSecret) {
    const receivedSecret = req.headers.get("X-Saipos-Secret") || req.headers.get("x-saipos-secret");
    if (receivedSecret !== webhookSecret) {
      console.warn("[webhook] Secret inválido recebido:", receivedSecret);
      return json({ error: "Unauthorized" }, 401);
    }
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Payload JSON inválido" }, 400);
  }

  console.log("[saipos-webhook] payload recebido:", JSON.stringify(payload));

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  // --- Extrair dados do payload ---
  // A Saipos normalmente envia algo como:
  // { "order_id": "SAI-123", "status": "ACCEPTED", "external_id": "CJS123456" }
  // external_id = nosso campo 'id_saipos' ou pode ser id numérico do pedido
  const saiposOrderId  = String(payload.order_id  || payload.id    || "");
  const saiposStatus   = String(payload.status     || payload.event  || "");
  const externalId     = String(payload.external_id || payload.ref   || "");

  let pedidoId: number | null = null;

  // Tentar encontrar o pedido pelo id_saipos ou external_id
  if (saiposOrderId) {
    const { data } = await sb
      .from("pedidos")
      .select("id")
      .eq("id_saipos", saiposOrderId)
      .maybeSingle();
    if (data) pedidoId = data.id;
  }

  if (!pedidoId && externalId) {
    // external_id pode ser nosso código NSU (ex: CJS1714080000000)
    const numericId = parseInt(externalId, 10);
    if (!isNaN(numericId)) {
      const { data } = await sb
        .from("pedidos")
        .select("id")
        .eq("id", numericId)
        .maybeSingle();
      if (data) pedidoId = data.id;
    }
  }

  // Log do recebimento
  await sb.from("integracao_logs").insert({
    tipo: "webhook_status",
    pedido_id: pedidoId,
    payload_enviado: null,
    payload_recebido: payload,
    status: pedidoId ? "sucesso" : "erro",
    erro_mensagem: pedidoId ? null : `Pedido não encontrado. saipos_id=${saiposOrderId} ext=${externalId}`,
  });

  if (!pedidoId) {
    console.warn("[saipos-webhook] Pedido não encontrado para:", saiposOrderId, externalId);
    // Retorna 200 para a Saipos não re-tentar indefinidamente
    return json({ ok: true, warning: "Pedido não mapeado no sistema" });
  }

  // Atualizar status no banco
  const novoStatus = STATUS_MAP[saiposStatus];
  const updates: Record<string, unknown> = {
    status_saipos: saiposStatus,
  };
  if (novoStatus) {
    updates.status = novoStatus;
  }

  const { error: updateError } = await sb
    .from("pedidos")
    .update(updates)
    .eq("id", pedidoId);

  if (updateError) {
    console.error("[saipos-webhook] Erro ao atualizar pedido:", updateError.message);
    await sb.from("integracao_logs").insert({
      tipo: "webhook_status",
      pedido_id: pedidoId,
      payload_recebido: payload,
      status: "erro",
      erro_mensagem: updateError.message,
    });
    return json({ error: "Erro interno ao atualizar pedido" }, 500);
  }

  console.log(`[saipos-webhook] Pedido ${pedidoId} → status="${novoStatus || '(mapeamento pendente)'}"`);
  return json({ ok: true, pedido_id: pedidoId, status_aplicado: novoStatus || null });
});
