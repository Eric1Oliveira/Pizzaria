# =============================================================
#  SCRIPT DE HOMOLOGAÇÃO SAIPOS — rode APÓS o deploy
#  Execute: .\testar-homologacao.ps1
# =============================================================

$FN  = "https://uufzqceljdkrnpgjotxw.supabase.co/functions/v1/enviar-pedido-saipos"
$KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1ZnpxY2VsamRrcm5wZ2pvdHh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MzIzMjUsImV4cCI6MjA4OTAwODMyNX0.lDBwSOYlF3SlMKblt2WsHo7rdVcZ-wXgjJolD41cNfk"

# Pedido base para os testes (deve existir no banco com rua, bairro etc.)
$PEDIDO = 62

function Chamar($cenario, $obj) {
    Write-Host "`n==============================" -ForegroundColor Cyan
    Write-Host " $cenario" -ForegroundColor Yellow
    Write-Host "==============================" -ForegroundColor Cyan

    $json = $obj | ConvertTo-Json -Depth 10 -Compress
    $tmp  = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmp, $json, [System.Text.Encoding]::UTF8)

    $raw = curl.exe -s -X POST `
        -H "Content-Type: application/json" `
        -H "Authorization: Bearer $KEY" `
        --data-binary "@$tmp" $FN

    Remove-Item $tmp -Force

    try {
        $r = $raw | ConvertFrom-Json
        $cor = if ($r.ok) { "Green" } else { "Red" }
        Write-Host "ok: $($r.ok)" -ForegroundColor $cor
        if ($r.payload_sent) {
            $ps = $r.payload_sent
            Write-Host ("  order_id:      " + $ps.order_id)
            Write-Host ("  total_amount:  " + $ps.total_amount)
            Write-Host ("  delivery_fee:  " + $ps.order_method.delivery_fee)
            Write-Host ("  payment:       " + ($ps.payment_types | ConvertTo-Json -Compress))
            if ($ps.notes) { Write-Host ("  notes:         " + $ps.notes) }
        }
        Write-Host ("  Saipos: " + ($r.response | ConvertTo-Json -Compress)) -ForegroundColor $(if($r.ok){"Green"}else{"Yellow"})
        if ($r.error) { Write-Host "  ERRO: $($r.error)" -ForegroundColor Red }
    } catch {
        Write-Host "Raw: $raw" -ForegroundColor Yellow
    }
}

# Gera um order_id único para cada teste (evita erro 904 de duplicidade)
$TS = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

# ============================================================
# CENÁRIO 1 — Pedido Agendado
# PRÉ-REQUISITO: no Supabase, pedido $PEDIDO deve ter
#   agendamento_entrega = "2026-10-08T01:25:49+00:00"
# ============================================================
Chamar "C1 — Pedido Agendado" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C1-$TS" }
}

# ============================================================
# CENÁRIO 2 — Mesmo order_id (enviar duas vezes o mesmo)
# ============================================================
Chamar "C2 — Mesmo order_id (1ª vez)" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C2-$TS" }
}
Chamar "C2 — Mesmo order_id (2ª vez — deve dar erro 904)" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C2-$TS" }
}

# ============================================================
# CENÁRIO 3 — Dois pedidos com mesmo ID de cliente
# PRÉ-REQUISITO: dois pedidos com o mesmo user_id
# Troque $PEDIDO2 pelo segundo ID
# ============================================================
$PEDIDO2 = 61   # <-- ajuste se necessário
Chamar "C3 — 1º pedido mesmo cliente" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C3a-$TS" }
}
Chamar "C3 — 2º pedido mesmo cliente" @{
    pedido_id = $PEDIDO2
    overrides = @{ force = $true; order_id = "C3b-$TS" }
}

# ============================================================
# CENÁRIO 4 — Consumidor não identificado (customer.id = -1)
# ============================================================
Chamar "C4 — Consumidor não identificado" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C4-$TS"; user_id = $null }
}

# ============================================================
# CENÁRIO 5 — Código PDV do produto
# (integration_code vem de i.codigo_saipos do banco)
# ============================================================
Chamar "C5 — Código PDV produto" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C5-$TS" }
}

# ============================================================
# CENÁRIO 6 — Múltiplas formas de pagamento
# ============================================================
Chamar "C6 — Múltiplos pagamentos" @{
    pedido_id = $PEDIDO
    overrides = @{
        force         = $true
        order_id      = "C6-$TS"
        payment_types = @(
            @{ code = "DIN"; amount = 20; change_for = 0; complement = ""; type = "OFFLINE" }
            @{ code = "CRE"; amount = 19; change_for = 0; complement = "VISA"; type = "OFFLINE" }
        )
    }
}

# ============================================================
# CENÁRIO 7 — Pagamento online PIX
# ============================================================
Chamar "C7 — PIX ONLINE" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C7-$TS"; forma_pagamento = "pix" }
}

# ============================================================
# CENÁRIO 8 — Pagamento offline (dinheiro)
# ============================================================
Chamar "C8 — Dinheiro OFFLINE" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C8-$TS"; forma_pagamento = "dinheiro" }
}

# ============================================================
# CENÁRIO 9 — Cartão com bandeira VISA
# ============================================================
Chamar "C9 — Cartão VISA OFFLINE" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C9-$TS"; forma_pagamento = "credito"; bandeira = "VISA" }
}

# ============================================================
# CENÁRIO 10 — PIX no parceiro (PARTNER_PAYMENT)
# ============================================================
Chamar "C10 — PIX PARTNER_PAYMENT" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C10-$TS"; forma_pagamento = "pix" }
}

# ============================================================
# CENÁRIO 11 — Dinheiro com troco (change_for = 5)
# ============================================================
Chamar "C11 — Dinheiro com troco" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C11-$TS"; forma_pagamento = "dinheiro"; troco = 5 }
}

# ============================================================
# CENÁRIO 12 — Observações dos itens
# PRÉ-REQUISITO: edite o array itens do pedido no Supabase
#   e coloque "observacao": "sem cebola" em um dos itens
# ============================================================
Chamar "C12 — Obs. dos itens" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C12-$TS" }
}

# ============================================================
# CENÁRIO 13 — Observações do pedido
# PRÉ-REQUISITO: edite o campo observacoes do pedido
#   e coloque "entregar na rua 43"
# ============================================================
Chamar "C13 — Obs. do pedido" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C13-$TS" }
}

# ============================================================
# CENÁRIO 14 — Desconto (total_discount = 10)
# ============================================================
Chamar "C14 — Desconto" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C14-$TS"; total_discount = 10 }
}

# ============================================================
# CENÁRIO 15 — Acréscimo (total_increase = 10)
# ============================================================
Chamar "C15 — Acréscimo" @{
    pedido_id = $PEDIDO
    overrides = @{ force = $true; order_id = "C15-$TS"; total_increase = 10 }
}

Write-Host "`n=============================="
Write-Host " TESTES CONCLUÍDOS" -ForegroundColor Green
Write-Host "=============================="
