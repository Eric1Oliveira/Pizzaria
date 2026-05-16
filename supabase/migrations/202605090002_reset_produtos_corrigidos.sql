-- =============================================================
-- RESET COMPLETO DE PRODUTOS — Casa José Silva Pizzaria
-- Execute no SQL Editor do Supabase (substitui o anterior)
-- =============================================================

BEGIN;

-- Desvincular promoções dos produtos antes de deletar
UPDATE public.promotion_popups SET product_id = NULL, product_ids = '{}'::bigint[];
DELETE FROM public.promotion_popup_events WHERE product_id IS NOT NULL;

-- Deletar todos os produtos e reiniciar sequência de IDs
DELETE FROM public.produtos;
ALTER TABLE public.produtos ALTER COLUMN id RESTART WITH 1;

-- =============================================================
-- PIZZAS
-- =============================================================
INSERT INTO public.produtos (nome, descricao, preco, categoria, subcategoria, disponivel, destaque, ordem, midias, midias_types, codigo_saipos) VALUES
-- Salgadas
('Al Nero',                    NULL, 105.50, 'Pizzas', 'Salgada', true, false,  1, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Aliche',                     NULL, 128.90, 'Pizzas', 'Salgada', true, false,  2, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Artesanal',                  NULL,  99.90, 'Pizzas', 'Salgada', true, false,  3, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Atum',                       NULL, 105.50, 'Pizzas', 'Salgada', true, false,  4, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Bacon',                      NULL,  94.50, 'Pizzas', 'Salgada', true, false,  5, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Brie',                       NULL, 105.50, 'Pizzas', 'Salgada', true, false,  6, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Broccolis',                  NULL, 104.90, 'Pizzas', 'Salgada', true, false,  7, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Burrata',                    NULL, 128.90, 'Pizzas', 'Salgada', true, false,  8, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Calabresa',                  NULL,  94.50, 'Pizzas', 'Salgada', true, false,  9, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Caprese',                    NULL, 105.50, 'Pizzas', 'Salgada', true, false, 10, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Fiore',                      NULL, 105.50, 'Pizzas', 'Salgada', true, false, 11, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Frango com Catupiry',        NULL, 104.90, 'Pizzas', 'Salgada', true, false, 12, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Lombo',                      NULL, 104.90, 'Pizzas', 'Salgada', true, false, 13, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Lombo e Limone',             NULL, 105.50, 'Pizzas', 'Salgada', true, false, 14, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Margherita',                 NULL,  94.50, 'Pizzas', 'Salgada', true, false, 15, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Mugurito',                   NULL, 104.50, 'Pizzas', 'Salgada', true, false, 16, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Palmito',                    NULL,  94.50, 'Pizzas', 'Salgada', true, false, 17, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Parma',                      NULL, 105.50, 'Pizzas', 'Salgada', true, false, 18, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Pepperoni',                  NULL,  94.50, 'Pizzas', 'Salgada', true, false, 19, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Peito',                      NULL, 115.50, 'Pizzas', 'Salgada', true, false, 20, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Portuguesa',                 NULL, 105.50, 'Pizzas', 'Salgada', true, false, 21, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Quatro Queijos Tradicional', NULL, 105.50, 'Pizzas', 'Salgada', true, false, 22, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Quatro Formaggi',            NULL, 128.90, 'Pizzas', 'Salgada', true, false, 23, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Siciliano com Tomate Seco',  NULL, 104.90, 'Pizzas', 'Salgada', true, false, 24, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Toscana',                    NULL, 105.50, 'Pizzas', 'Salgada', true, false, 25, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Toscana 2',                  NULL, 105.50, 'Pizzas', 'Salgada', true, false, 26, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Zucchini',                   NULL, 105.50, 'Pizzas', 'Salgada', true, false, 27, ARRAY[]::text[], ARRAY[]::text[], NULL),
-- Doces
('Banana',                     NULL,  95.50, 'Pizzas', 'Doce',    true, false, 28, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Nutella',                    NULL,  89.90, 'Pizzas', 'Doce',    true, false, 29, ARRAY[]::text[], ARRAY[]::text[], NULL);

-- =============================================================
-- ALMOÇO — 1 Pessoa
-- =============================================================
INSERT INTO public.produtos (nome, descricao, preco, categoria, subcategoria, disponivel, destaque, ordem, midias, midias_types, codigo_saipos) VALUES
('Contra de Cavalo',                       'Serve 1 pessoa',                             47.90, 'Almoço', '1 Pessoa', true, false,  1, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Centro Acebolado',                       'Serve 1 pessoa',                             48.90, 'Almoço', '1 Pessoa', true, false,  2, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Costela no Bafo c/ Mandioca e Manteiga', 'Serve 1 pessoa',                             48.90, 'Almoço', '1 Pessoa', true, false,  3, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Feijoada',                               'Somente Quartas e Sábados — Serve 1 pessoa', 44.90, 'Almoço', '1 Pessoa', true, false,  4, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Frango',                         'Serve 1 pessoa',                             52.90, 'Almoço', '1 Pessoa', true, false,  5, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Mignon à Milanesa',              'Serve 1 pessoa',                             53.90, 'Almoço', '1 Pessoa', true, false,  6, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Peixe',                          'Serve 1 pessoa',                             52.90, 'Almoço', '1 Pessoa', true, false,  7, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Peixe Empanado com Fritas',      'Serve 1 pessoa',                             52.90, 'Almoço', '1 Pessoa', true, false,  8, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Peixe Empanado com Purê',        'Serve 1 pessoa',                             52.90, 'Almoço', '1 Pessoa', true, false,  9, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé Mignon à Milanesa',                 'Serve 1 pessoa',                             53.90, 'Almoço', '1 Pessoa', true, false, 10, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Omelete',                                'Serve 1 pessoa',                             32.90, 'Almoço', '1 Pessoa', true, false, 11, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Parmegiana de Frango',                   'Serve 1 pessoa',                             52.90, 'Almoço', '1 Pessoa', true, false, 12, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Parmegiana de Mignon',                   'Serve 1 pessoa',                             53.90, 'Almoço', '1 Pessoa', true, false, 13, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Picadinho de Carne',                     'Serve 1 pessoa',                             52.90, 'Almoço', '1 Pessoa', true, false, 14, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Picanha Grelhada',                       'Serve 1 pessoa',                             58.90, 'Almoço', '1 Pessoa', true, false, 15, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Strogonoff de Frango',                   'Serve 1 pessoa',                             52.90, 'Almoço', '1 Pessoa', true, false, 16, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Strogonoff de Mignon',                   'Serve 1 pessoa',                             53.90, 'Almoço', '1 Pessoa', true, false, 17, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Virado de Paulista',                     'Serve 1 pessoa',                             54.90, 'Almoço', '1 Pessoa', true, false, 18, ARRAY[]::text[], ARRAY[]::text[], NULL);

-- =============================================================
-- ALMOÇO — 2 Pessoas
-- =============================================================
INSERT INTO public.produtos (nome, descricao, preco, categoria, subcategoria, disponivel, destaque, ordem, midias, midias_types, codigo_saipos) VALUES
('Contra de Cavalo',                       'Serve 2 pessoas',  79.90, 'Almoço', '2 Pessoas', true, false,  1, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Centro Acebolado',                       'Serve 2 pessoas',  84.90, 'Almoço', '2 Pessoas', true, false,  2, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Costela no Bafo c/ Mandioca e Manteiga', 'Serve 2 pessoas',  84.90, 'Almoço', '2 Pessoas', true, false,  3, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Feijoada',                               'Serve 2 pessoas',  84.90, 'Almoço', '2 Pessoas', true, false,  4, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Frango',                         'Serve 2 pessoas',  92.90, 'Almoço', '2 Pessoas', true, false,  5, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Mignon à Milanesa',              'Serve 2 pessoas',  94.90, 'Almoço', '2 Pessoas', true, false,  6, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Peixe',                          'Serve 2 pessoas',  92.90, 'Almoço', '2 Pessoas', true, false,  7, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Peixe Empanado com Legumes',     'Serve 2 pessoas',  92.90, 'Almoço', '2 Pessoas', true, false,  8, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Peixe Empanado com Purê',        'Serve 2 pessoas',  92.90, 'Almoço', '2 Pessoas', true, false,  9, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé Mignon à Milanesa',                 'Serve 2 pessoas',  94.90, 'Almoço', '2 Pessoas', true, false, 10, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Omelete',                                'Serve 2 pessoas',  52.90, 'Almoço', '2 Pessoas', true, false, 11, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Parmegiana de Frango',                   'Serve 2 pessoas',  92.90, 'Almoço', '2 Pessoas', true, false, 12, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Parmegiana de Mignon',                   'Serve 2 pessoas',  94.90, 'Almoço', '2 Pessoas', true, false, 13, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Picadinho de Carne',                     'Serve 2 pessoas',  92.90, 'Almoço', '2 Pessoas', true, false, 14, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Picanha Grelhada',                       'Serve 2 pessoas',  98.90, 'Almoço', '2 Pessoas', true, false, 15, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Strogonoff de Frango',                   'Serve 2 pessoas',  92.90, 'Almoço', '2 Pessoas', true, false, 16, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Strogonoff de Mignon',                   'Serve 2 pessoas',  94.90, 'Almoço', '2 Pessoas', true, false, 17, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Virado de Paulista',                     'Serve 2 pessoas',  94.90, 'Almoço', '2 Pessoas', true, false, 18, ARRAY[]::text[], ARRAY[]::text[], NULL);

-- =============================================================
-- ALMOÇO — 4 Pessoas
-- =============================================================
INSERT INTO public.produtos (nome, descricao, preco, categoria, subcategoria, disponivel, destaque, ordem, midias, midias_types, codigo_saipos) VALUES
('Contra de Cavalo',                       'Serve 4 pessoas', 174.90, 'Almoço', '4 Pessoas', true, false,  1, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Centro Acebolado',                       'Serve 4 pessoas', 183.90, 'Almoço', '4 Pessoas', true, false,  2, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Costela no Bafo c/ Mandioca e Manteiga', 'Serve 4 pessoas', 183.90, 'Almoço', '4 Pessoas', true, false,  3, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Feijoada',                               'Serve 4 pessoas', 183.90, 'Almoço', '4 Pessoas', true, false,  4, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Frango',                         'Serve 4 pessoas', 198.90, 'Almoço', '4 Pessoas', true, false,  5, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Mignon à Milanesa',              'Serve 4 pessoas', 204.90, 'Almoço', '4 Pessoas', true, false,  6, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Peixe',                          'Serve 4 pessoas', 198.90, 'Almoço', '4 Pessoas', true, false,  7, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Peixe Empanado com Fritas',      'Serve 4 pessoas', 198.90, 'Almoço', '4 Pessoas', true, false,  8, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé de Peixe Empanado com Purê',        'Serve 4 pessoas', 198.90, 'Almoço', '4 Pessoas', true, false,  9, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Filé Mignon à Milanesa',                 'Serve 4 pessoas', 204.90, 'Almoço', '4 Pessoas', true, false, 10, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Omelete',                                'Serve 4 pessoas',  92.90, 'Almoço', '4 Pessoas', true, false, 11, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Parmegiana de Frango',                   'Serve 4 pessoas', 198.90, 'Almoço', '4 Pessoas', true, false, 12, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Parmegiana de Mignon',                   'Serve 4 pessoas', 204.90, 'Almoço', '4 Pessoas', true, false, 13, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Picadinho de Carne',                     'Serve 4 pessoas', 198.90, 'Almoço', '4 Pessoas', true, false, 14, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Picanha Grelhada',                       'Serve 4 pessoas', 218.90, 'Almoço', '4 Pessoas', true, false, 15, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Strogonoff de Frango',                   'Serve 4 pessoas', 198.90, 'Almoço', '4 Pessoas', true, false, 16, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Strogonoff de Mignon',                   'Serve 4 pessoas', 204.90, 'Almoço', '4 Pessoas', true, false, 17, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Virado de Paulista',                     'Serve 4 pessoas', 198.90, 'Almoço', '4 Pessoas', true, false, 18, ARRAY[]::text[], ARRAY[]::text[], NULL);

-- =============================================================
-- PORÇÕES E SALADAS
-- =============================================================
INSERT INTO public.produtos (nome, descricao, preco, categoria, subcategoria, disponivel, destaque, ordem, midias, midias_types, codigo_saipos) VALUES
('Arroz Branco 200g',           'Porção',          9.00, 'Porções e Saladas', NULL, true, false, 1, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Arroz Branco 500g',           'Porção',         18.00, 'Porções e Saladas', NULL, true, false, 2, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Batata Frita 450g',           'Porção',         26.90, 'Porções e Saladas', NULL, true, false, 3, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Coxinha da Asa no Bafo 210g', 'Porção',         35.90, 'Porções e Saladas', NULL, true, false, 4, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Feijão 300g',                 'Porção',         12.00, 'Porções e Saladas', NULL, true, false, 5, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Feijão 500g',                 'Porção',         20.00, 'Porções e Saladas', NULL, true, false, 6, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Picanha na Chapa 450g',       'Porção',         89.00, 'Porções e Saladas', NULL, true, false, 7, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Salada Simples',              'Serve 1 pessoa', 12.00, 'Porções e Saladas', NULL, true, false, 8, ARRAY[]::text[], ARRAY[]::text[], NULL);

-- =============================================================
-- VINHOS E ESPUMANTES
-- (vinhos sem preço ficam disponivel=false até atualizar no admin)
-- =============================================================
INSERT INTO public.produtos (nome, descricao, preco, categoria, subcategoria, disponivel, destaque, ordem, midias, midias_types, codigo_saipos) VALUES
('Espumante Brut Casa Perini 750ml',               NULL,  89.90, 'Vinhos e Espumantes', 'Espumantes',    true,  false,  1, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Espumante Cava Península 750ml',                 NULL,  89.90, 'Vinhos e Espumantes', 'Espumantes',    true,  false,  2, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Espumante Demi-Sec Casa Perini 750ml',           NULL,  89.90, 'Vinhos e Espumantes', 'Espumantes',    true,  false,  3, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Vinho Argentino Tinto Portillo Malbec 750ml',    NULL,   0.00, 'Vinhos e Espumantes', 'Vinhos Tintos', false, false,  4, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Vinho Chileno Tinto Carmenere Santa Carolina 750ml', NULL, 0.00, 'Vinhos e Espumantes', 'Vinhos Tintos', false, false, 5, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Vinho Italiano Tinto Negroamaro 750ml',          NULL,   0.00, 'Vinhos e Espumantes', 'Vinhos Tintos', false, false,  6, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Vinho Tinto Casa Perini Cabernet Sauvignon 750ml',NULL,  0.00, 'Vinhos e Espumantes', 'Vinhos Tintos', false, false,  7, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Vinho Tinto Chileno Carmenere 750ml',            NULL,   0.00, 'Vinhos e Espumantes', 'Vinhos Tintos', false, false,  8, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Vinho Branco Dan Guerrieri Sémillon 750ml',      NULL,   0.00, 'Vinhos e Espumantes', 'Vinhos Brancos',false, false,  9, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Cachaça da Fazenda Bai Perini 600ml',            NULL, 165.00, 'Vinhos e Espumantes', 'Destilados',    true,  false, 10, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Cachaça Brut Casa Perini 750ml',                 NULL,  89.90, 'Vinhos e Espumantes', 'Destilados',    true,  false, 11, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Vodka Absolut Original 750ml',                   NULL,  85.00, 'Vinhos e Espumantes', 'Destilados',    true,  false, 12, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Vodka Absolut Citron 750ml',                     NULL,  85.00, 'Vinhos e Espumantes', 'Destilados',    true,  false, 13, ARRAY[]::text[], ARRAY[]::text[], NULL);

-- =============================================================
-- BEBIDAS (todas com subcategoria para o dropdown funcionar)
-- =============================================================
INSERT INTO public.produtos (nome, descricao, preco, categoria, subcategoria, disponivel, destaque, ordem, midias, midias_types, codigo_saipos) VALUES
('Cerveja Heineken 600ml',            NULL, 24.90, 'Bebidas', 'Cervejas',      true, false,  1, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Cerveja Heineken Long Neck 330ml',  NULL, 14.90, 'Bebidas', 'Cervejas',      true, false,  2, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Cerveja Original 600ml',            NULL, 24.90, 'Bebidas', 'Cervejas',      true, false,  3, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Coca Cola 2 litros',                NULL, 18.00, 'Bebidas', 'Refrigerantes', true, false,  4, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Coca Cola Zero 2 litros',           NULL, 18.00, 'Bebidas', 'Refrigerantes', true, false,  5, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Guaraná Antarctica 2 litros',       NULL, 16.00, 'Bebidas', 'Refrigerantes', true, false,  6, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Guaraná Antarctica Zero 2 litros',  NULL, 16.00, 'Bebidas', 'Refrigerantes', true, false,  7, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Pepsi 350ml',                       NULL, 13.00, 'Bebidas', 'Refrigerantes', true, false,  8, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Pepsi Zero 350ml',                  NULL, 13.00, 'Bebidas', 'Refrigerantes', true, false,  9, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Schweppes Citrus 350ml',            NULL, 13.00, 'Bebidas', 'Refrigerantes', true, false, 10, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Soda Limonada 350ml',               NULL, 13.00, 'Bebidas', 'Refrigerantes', true, false, 11, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Água Mineral 500ml',                NULL,  5.00, 'Bebidas', 'Águas',         true, false, 12, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Água Mineral com Gás 500ml',        NULL,  7.00, 'Bebidas', 'Águas',         true, false, 13, ARRAY[]::text[], ARRAY[]::text[], NULL),
('H2O Limão 500ml',                   NULL,  8.00, 'Bebidas', 'Águas',         true, false, 14, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Suco de Uva ou Laranja',            NULL, 13.00, 'Bebidas', 'Sucos',         true, false, 15, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Energético Monster 473ml',          NULL, 15.00, 'Bebidas', 'Energéticos',   true, false, 16, ARRAY[]::text[], ARRAY[]::text[], NULL),
('Energético Red Bull 250ml',         NULL, 18.00, 'Bebidas', 'Energéticos',   true, false, 17, ARRAY[]::text[], ARRAY[]::text[], NULL);

COMMIT;

-- =============================================================
-- APÓS INTEGRAR COM SAIPOS — vincule os códigos:
--   UPDATE public.produtos SET codigo_saipos = 'COD'
--   WHERE nome = 'Margherita' AND categoria = 'Pizzas';
-- =============================================================
