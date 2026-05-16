-- =============================================================
-- ZERAR DADOS DE TESTE
-- Apaga pedidos, histórico de clientes e promoções
-- Execute no SQL Editor do Supabase
-- =============================================================

BEGIN;

-- ---------- Pedidos (inclui histórico de clientes) ----------
DELETE FROM public.pedidos;
ALTER TABLE public.pedidos ALTER COLUMN id RESTART WITH 1;

-- ---------- Promoções ----------
DELETE FROM public.promotion_popup_events;
DELETE FROM public.promotion_popups;

-- ---------- Atualizar categorias dos horários para os nomes reais ----------
INSERT INTO public.site_config (key, value, type, label, section)
VALUES
  ('lunch_categories',  'Almoço,Bebidas,Porções e Saladas',                          'text', 'Categorias no Almoço',  'horarios'),
  ('dinner_categories', 'Pizzas,Bebidas,Vinhos e Espumantes,Porções e Saladas',       'text', 'Categorias no Jantar',  'horarios')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

COMMIT;
