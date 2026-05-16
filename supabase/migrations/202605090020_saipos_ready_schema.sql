-- =============================================================
-- PREPARAÇÃO PARA INTEGRAÇÃO SAIPOS
-- Execute no SQL Editor do Supabase
-- =============================================================

BEGIN;

-- ============================================================
-- 1. COLUNAS SAIPOS NA TABELA PEDIDOS (idempotente)
-- ============================================================
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS id_saipos       text,
  ADD COLUMN IF NOT EXISTS enviado_saipos  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_envio_saipos timestamptz,
  ADD COLUMN IF NOT EXISTS status_saipos   text,          -- status retornado pela Saipos
  ADD COLUMN IF NOT EXISTS erro_saipos     text;          -- mensagem de erro da Saipos

CREATE INDEX IF NOT EXISTS idx_pedidos_enviado_saipos ON public.pedidos (enviado_saipos)
  WHERE enviado_saipos = false;

-- ============================================================
-- 2. TABELA pedido_itens
-- Normaliza os itens do pedido (hoje guardados em JSON)
-- A Saipos precisa de items estruturados, não JSON
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pedido_itens (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pedido_id        bigint NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  produto_id       bigint REFERENCES public.produtos(id) ON DELETE SET NULL,
  nome             text   NOT NULL,
  quantidade       integer NOT NULL DEFAULT 1,
  preco_unitario   numeric(10,2) NOT NULL,
  is_promotional   boolean NOT NULL DEFAULT false,
  observacao       text,
  codigo_saipos    text,   -- copiado do produto no momento do pedido
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido_id ON public.pedido_itens (pedido_id);

-- RLS
ALTER TABLE public.pedido_itens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'pedido_itens' AND policyname = 'pedido_itens_owner'
  ) THEN
    CREATE POLICY pedido_itens_owner ON public.pedido_itens
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.pedidos
          WHERE id = pedido_id AND user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ============================================================
-- 3. TRIGGER: popula pedido_itens a partir do JSON ao inserir pedido
-- ============================================================
CREATE OR REPLACE FUNCTION public.populate_pedido_itens()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  item       jsonb;
  prod_id    bigint;
  cod_saipos text;
BEGIN
  IF NEW.itens IS NOT NULL THEN
    FOR item IN SELECT * FROM jsonb_array_elements(NEW.itens)
    LOOP
      prod_id := nullif(item->>'id', '')::bigint;

      SELECT codigo_saipos
        INTO cod_saipos
        FROM public.produtos
       WHERE id = prod_id;

      INSERT INTO public.pedido_itens (
        pedido_id, produto_id, nome, quantidade,
        preco_unitario, is_promotional, codigo_saipos
      ) VALUES (
        NEW.id,
        prod_id,
        COALESCE(item->>'nome', 'Produto'),
        COALESCE(nullif(item->>'qty',  '')::integer, 1),
        COALESCE(nullif(item->>'preco','')::numeric, 0),
        COALESCE(nullif(item->>'is_promotional','')::boolean, false),
        cod_saipos
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_populate_pedido_itens ON public.pedidos;
CREATE TRIGGER trg_populate_pedido_itens
  AFTER INSERT ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.populate_pedido_itens();

-- ============================================================
-- 4. TABELA integracao_logs
-- Todos os envios/recebimentos da API Saipos ficam aqui
-- Essencial para depurar erros de integração
-- ============================================================
CREATE TABLE IF NOT EXISTS public.integracao_logs (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo             text   NOT NULL,  -- 'envio_pedido' | 'webhook_status' | 'sync_catalogo' | 'erro'
  pedido_id        bigint REFERENCES public.pedidos(id) ON DELETE SET NULL,
  payload_enviado  jsonb,
  payload_recebido jsonb,
  status           text NOT NULL DEFAULT 'pendente', -- 'sucesso' | 'erro' | 'pendente'
  erro_mensagem    text,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integracao_logs_pedido   ON public.integracao_logs (pedido_id);
CREATE INDEX IF NOT EXISTS idx_integracao_logs_tipo     ON public.integracao_logs (tipo);
CREATE INDEX IF NOT EXISTS idx_integracao_logs_status   ON public.integracao_logs (status);
CREATE INDEX IF NOT EXISTS idx_integracao_logs_created  ON public.integracao_logs (created_at DESC);

-- RLS: só service_role acessa (Edge Functions rodam como service_role)
ALTER TABLE public.integracao_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'integracao_logs' AND policyname = 'logs_deny_public'
  ) THEN
    CREATE POLICY logs_deny_public ON public.integracao_logs FOR ALL USING (false);
  END IF;
END $$;

-- ============================================================
-- 5. TABELA adicionais (para expansão futura do cardápio)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.adicionais (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome       text   NOT NULL,
  preco      numeric(10,2) NOT NULL DEFAULT 0,
  disponivel boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.adicionais ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'adicionais' AND policyname = 'adicionais_public_read'
  ) THEN
    CREATE POLICY adicionais_public_read ON public.adicionais
      FOR SELECT USING (disponivel = true);
  END IF;
END $$;

-- ============================================================
-- 6. TABELA produto_adicionais (muitos-para-muitos)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.produto_adicionais (
  produto_id   bigint NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  adicional_id bigint NOT NULL REFERENCES public.adicionais(id) ON DELETE CASCADE,
  PRIMARY KEY (produto_id, adicional_id)
);

ALTER TABLE public.produto_adicionais ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'produto_adicionais' AND policyname = 'produto_adicionais_public_read'
  ) THEN
    CREATE POLICY produto_adicionais_public_read ON public.produto_adicionais
      FOR SELECT USING (true);
  END IF;
END $$;

-- ============================================================
-- 7. VIEW: pedidos_pendentes_saipos
-- Facilita buscar pedidos que ainda não foram enviados para Saipos
-- ============================================================
CREATE OR REPLACE VIEW public.pedidos_pendentes_saipos AS
SELECT
  p.id,
  p.created_at,
  p.status,
  p.total,
  p.forma_pagamento,
  p.nome_cliente,
  p.telefone_cliente,
  p.endereco_entrega,
  p.enviado_saipos,
  p.id_saipos,
  p.erro_saipos,
  (
    SELECT json_agg(json_build_object(
      'nome',           pi.nome,
      'quantidade',     pi.quantidade,
      'preco_unitario', pi.preco_unitario,
      'codigo_saipos',  pi.codigo_saipos
    ))
    FROM public.pedido_itens pi
    WHERE pi.pedido_id = p.id
  ) AS itens_normalizados
FROM public.pedidos p
WHERE p.enviado_saipos = false
  AND p.status IN ('confirmado', 'preparando', 'saiu', 'entregue')
ORDER BY p.created_at DESC;

COMMIT;
