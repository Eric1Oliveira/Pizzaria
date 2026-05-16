// supabase/functions/rapid-endpoint/index.ts
// Proxy da e-Rede com OAuth 2.0 para processar transacoes de cartao no checkout.

// @ts-nocheck

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

const EREDE_OAUTH_URL = Deno.env.get("EREDE_OAUTH_URL") || "https://api.userede.com.br/redelabs/oauth2/token";
const EREDE_TX_URL = Deno.env.get("EREDE_TX_URL") || "https://api.userede.com.br/erede/v2/transactions";
const EREDE_TOKEN_URL = Deno.env.get("EREDE_TOKEN_URL") || "https://api.userede.com.br/redelabs/token-service/oauth/v2/tokenization";

const EREDE_CLIENT_ID = Deno.env.get("EREDE_CLIENT_ID") || Deno.env.get("EREDE_PV") || "";
const EREDE_CLIENT_SECRET = Deno.env.get("EREDE_CLIENT_SECRET") || Deno.env.get("EREDE_TOKEN") || "";

let tokenCache = "";
let tokenExpiresAt = 0;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function toBase64(value: string): string {
  return btoa(value);
}

async function getOAuthToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && now < tokenExpiresAt - 60000) {
    return tokenCache;
  }

  if (!EREDE_CLIENT_ID || !EREDE_CLIENT_SECRET) {
    throw new Error("Credenciais da e-Rede ausentes. Configure EREDE_CLIENT_ID/EREDE_CLIENT_SECRET.");
  }

  // e-Rede: PV não pode ter zeros à esquerda
  const clientId = EREDE_CLIENT_ID.replace(/^0+/, "");
  const auth = toBase64(`${clientId}:${EREDE_CLIENT_SECRET}`);

  console.log("[OAuth] clientId (sem zeros):", clientId, "url:", EREDE_OAUTH_URL);

  const response = await fetch(EREDE_OAUTH_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const text = await response.text();
  let parsed: any = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  if (!response.ok || !parsed?.access_token) {
    console.error("e-Rede OAuth error:", response.status, JSON.stringify(parsed));
    throw new Error(parsed?.error_description || parsed?.error || parsed?.returnMessage || `Falha ao autenticar OAuth (${response.status})`);
  }

  const expiresInSec = Number(parsed.expires_in || 1440);
  tokenCache = String(parsed.access_token);
  tokenExpiresAt = now + (expiresInSec * 1000);
  return tokenCache;
}

function sanitizePayload(raw: any) {
  const payload = raw?.payload || {};

  const reference = String(payload.reference || "").trim();
  const amount = Number(payload.amount || 0);
  const cardholderName = String(payload.cardholderName || "").trim();
  const cardNumber = String(payload.cardNumber || "").replace(/\D/g, "");
  const expirationMonth = String(payload.expirationMonth || "").replace(/\D/g, "");
  const expirationYear = String(payload.expirationYear || "").replace(/\D/g, "");
  const securityCode = String(payload.securityCode || "").replace(/\D/g, "");

  if (!reference) throw new Error("reference é obrigatório");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount inválido");
  if (cardNumber.length < 13 || cardNumber.length > 19) throw new Error("cardNumber inválido");
  if (!cardholderName) throw new Error("cardholderName é obrigatório");
  if (expirationMonth.length < 1 || expirationMonth.length > 2) throw new Error("expirationMonth inválido");
  if (expirationYear.length !== 4) throw new Error("expirationYear inválido");
  if (securityCode.length < 3 || securityCode.length > 4) throw new Error("securityCode inválido");

  return {
    capture: payload.capture !== false,
    kind: payload.kind || "credit",
    reference,
    amount: Math.round(amount),
    installments: Number(payload.installments || 1),
    cardholderName,
    cardNumber,
    expirationMonth: expirationMonth.padStart(2, "0"),
    expirationYear,
    securityCode,
  };
}

function sanitizeTokenizePayload(raw: any) {
  const payload = raw?.payload || {};
  const cardNumber = String(payload.cardNumber || "").replace(/\D/g, "");
  const expirationMonth = String(payload.expirationMonth || "").replace(/\D/g, "");
  const expirationYear = String(payload.expirationYear || "").replace(/\D/g, "");
  const email = String(payload.email || "").trim();

  if (!email || !email.includes("@")) throw new Error("email válido é obrigatório para tokenização");
  if (cardNumber.length < 13 || cardNumber.length > 19) throw new Error("cardNumber inválido");
  if (expirationMonth.length < 1 || expirationMonth.length > 2) throw new Error("expirationMonth inválido");
  if (expirationYear.length !== 4) throw new Error("expirationYear inválido");

  const result: any = {
    email,
    cardNumber,
    expirationMonth: expirationMonth.padStart(2, "0"),
    expirationYear,
    storageCard: "0",
    embeddedZeroDollar: false,
  };
  const cardholderName = String(payload.cardholderName || "").trim();
  if (cardholderName) result.cardholderName = cardholderName;
  const securityCode = String(payload.securityCode || "").replace(/\D/g, "");
  if (securityCode.length >= 3) result.securityCode = securityCode;
  return result;
}

function sanitizeTokenPayload(raw: any) {
  const payload = raw?.payload || {};
  const reference = String(payload.reference || "").trim();
  const amount = Number(payload.amount || 0);
  const cardToken = String(payload.cardToken || "").trim();

  if (!reference) throw new Error("reference é obrigatório");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount inválido");
  if (!cardToken) throw new Error("cardToken é obrigatório");

  return {
    capture: payload.capture !== false,
    kind: payload.kind || "credit",
    reference,
    amount: Math.round(amount),
    installments: Number(payload.installments || 1),
    cardToken,
    storageCard: "2",
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido" }, 405);
  }

  try {
    const body = await req.json();
    const action = String(body.action || "charge");

    if (action === "tokenize") {
      const tokenPayload = sanitizeTokenizePayload(body);
      const accessToken = await getOAuthToken();
      const tokenResponse = await fetch(EREDE_TOKEN_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tokenPayload),
      });
      const tokenText = await tokenResponse.text();
      let tokenData: any = {};
      try { tokenData = JSON.parse(tokenText); } catch { tokenData = { raw: tokenText }; }
      if (!tokenResponse.ok) {
        console.error("e-Rede tokenize error:", tokenResponse.status, tokenData);
        return jsonResponse({ error: tokenData?.returnMessage || `Falha na tokenização (${tokenResponse.status})`, details: tokenData }, tokenResponse.status);
      }
      return jsonResponse(tokenData, 200);
    }

    const txPayload = body?.payload?.cardToken ? sanitizeTokenPayload(body) : sanitizePayload(body);

    const accessToken = await getOAuthToken();

    console.log("[TX] payload:", JSON.stringify(txPayload));
    const txResponse = await fetch(EREDE_TX_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(txPayload),
    });

    const txText = await txResponse.text();
    let txData: any = {};
    try {
      txData = JSON.parse(txText);
    } catch {
      txData = { raw: txText };
    }

    if (!txResponse.ok) {
      console.error("e-Rede transaction HTTP error:", txResponse.status, txData);
      return jsonResponse({
        error: txData?.returnMessage || `Falha HTTP na transação (${txResponse.status})`,
        details: txData,
      }, txResponse.status);
    }

    return jsonResponse(txData, 200);
  } catch (err) {
    console.error("rapid-endpoint error:", err);
    return jsonResponse({ error: "Erro interno", message: String(err) }, 500);
  }
});
