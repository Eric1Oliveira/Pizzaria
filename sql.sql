esse era o sql 

-- ============================================================
-- CASA JOSÉ SILVA — SQL COMPLETO
-- Apaga tudo e recria do zero. Cole no SQL Editor do Supabase.
-- ============================================================

-- ============================================================
-- 1. LIMPAR TUDO (verifica se tabela existe antes de dropar policies)
-- ============================================================
DO $$
BEGIN
  -- Produtos
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='produtos') THEN
    DROP POLICY IF EXISTS "Produtos visíveis para todos" ON produtos;
    DROP POLICY IF EXISTS "Admins gerenciam produtos" ON produtos;
    DROP POLICY IF EXISTS "Admins editam produtos" ON produtos;
    DROP POLICY IF EXISTS "Admins deletam produtos" ON produtos;
  END IF;
  -- Pedidos
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pedidos') THEN
    DROP POLICY IF EXISTS "Usuários podem criar seus pedidos" ON pedidos;
    DROP POLICY IF EXISTS "Usuários veem apenas seus pedidos" ON pedidos;
    DROP POLICY IF EXISTS "Admins atualizam pedidos" ON pedidos;
  END IF;
  -- Site Config
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='site_config') THEN
    DROP POLICY IF EXISTS "Config visível para todos" ON site_config;
    DROP POLICY IF EXISTS "Admins editam config" ON site_config;
  END IF;
  -- Admin Users
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='admin_users') THEN
    DROP POLICY IF EXISTS "Admin read" ON admin_users;
    DROP POLICY IF EXISTS "Admin update" ON admin_users;
    DROP POLICY IF EXISTS "Users can check own admin status" ON admin_users;
    DROP POLICY IF EXISTS "Users can link own auth_user_id" ON admin_users;
  END IF;
END $$;

DROP TABLE IF EXISTS admin_users CASCADE;
DROP TABLE IF EXISTS site_config CASCADE;
DROP TABLE IF EXISTS pedidos CASCADE;
DROP TABLE IF EXISTS produtos CASCADE;

DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS is_admin() CASCADE;

-- ============================================================
-- 2. TABELA DE PRODUTOS
--    Colunas: nome, descricao, preco, categoria, imagem_url
--    (nomes em português = mesmo que o JS usa)
-- ============================================================
CREATE TABLE produtos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  preco NUMERIC(10,2) NOT NULL CHECK (preco >= 0),
  categoria TEXT NOT NULL,
  subcategoria TEXT,
  imagem_url TEXT,
  disponivel BOOLEAN NOT NULL DEFAULT true,
  destaque BOOLEAN NOT NULL DEFAULT false,
  ordem INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_produtos_disponivel ON produtos (disponivel);
CREATE INDEX idx_produtos_categoria  ON produtos (categoria);
CREATE INDEX idx_produtos_destaque   ON produtos (destaque);

-- ============================================================
-- 3. TABELA DE PEDIDOS
--    Colunas: nome_cliente, email_cliente, telefone_cliente,
--    endereco_entrega, forma_entrega, forma_pagamento, etc.
-- ============================================================
CREATE TABLE pedidos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_cliente TEXT NOT NULL,
  email_cliente TEXT NOT NULL,
  telefone_cliente TEXT,
  endereco_entrega TEXT,
  observacoes TEXT,
  forma_entrega TEXT DEFAULT 'delivery' CHECK (forma_entrega IN ('delivery','retirada','mesa')),
  forma_pagamento TEXT DEFAULT 'infinitepay',
  itens JSONB NOT NULL DEFAULT '[]'::jsonb,
  total NUMERIC(10,2) NOT NULL CHECK (total >= 0),
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','confirmado','preparando','saiu_entrega','entregue','cancelado')),
  infinitepay_ref TEXT,
  checkout_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pedidos_user_id    ON pedidos (user_id);
CREATE INDEX idx_pedidos_status     ON pedidos (status);
CREATE INDEX idx_pedidos_created_at ON pedidos (created_at DESC);

-- ============================================================
-- 4. TABELA DE ADMINISTRADORES
--    admin.js lê .nome e .email
-- ============================================================
CREATE TABLE admin_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','superadmin')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. TABELA DE CONFIGURAÇÃO DO SITE
--    Chaves devem bater exatamente com admin.js configSections
-- ============================================================
CREATE TABLE site_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text'
    CHECK (type IN ('text','color','url','json','number','boolean','image')),
  label TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT 'geral',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. FUNÇÃO: VERIFICAR SE É ADMIN
-- ============================================================
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_users
    WHERE auth_user_id = auth.uid() AND active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- 7. TRIGGER updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_produtos_updated_at
  BEFORE UPDATE ON produtos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_pedidos_updated_at
  BEFORE UPDATE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 8. ROW LEVEL SECURITY
-- ============================================================

-- PRODUTOS (qualquer um lê, só admin escreve)
ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Produtos visíveis para todos"
  ON produtos FOR SELECT USING (true);

CREATE POLICY "Admins gerenciam produtos"
  ON produtos FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins editam produtos"
  ON produtos FOR UPDATE TO authenticated
  USING (is_admin());

CREATE POLICY "Admins deletam produtos"
  ON produtos FOR DELETE TO authenticated
  USING (is_admin());

-- PEDIDOS (usuário cria/lê os seus, admin lê/edita todos)
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários podem criar seus pedidos"
  ON pedidos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuários veem apenas seus pedidos"
  ON pedidos FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR is_admin());

CREATE POLICY "Admins atualizam pedidos"
  ON pedidos FOR UPDATE TO authenticated
  USING (is_admin());

-- SITE_CONFIG (qualquer um lê, admin edita)
ALTER TABLE site_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Config visível para todos"
  ON site_config FOR SELECT USING (true);

CREATE POLICY "Admins editam config"
  ON site_config FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ADMIN_USERS
-- Permite que o próprio usuário leia sua linha (por email do JWT)
-- e que admins confirmados leiam/editem tudo.
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can check own admin status"
  ON admin_users FOR SELECT TO authenticated
  USING (
    email = (auth.jwt() ->> 'email')
    OR is_admin()
  );

CREATE POLICY "Users can link own auth_user_id"
  ON admin_users FOR UPDATE TO authenticated
  USING (
    email = (auth.jwt() ->> 'email')
    OR is_admin()
  )
  WITH CHECK (
    email = (auth.jwt() ->> 'email')
    OR is_admin()
  );

-- ============================================================
-- 9. CONFIGURAÇÕES INICIAIS DO SITE
--    As chaves (key) e seções (section) batem com admin.js
-- ============================================================
INSERT INTO site_config (key, value, type, label, section) VALUES
-- Geral
('restaurant_name',      'CASA JOSÉ SILVA',                                 'text',  'Nome do Restaurante',          'geral'),
('restaurant_subtitle',  'empório & café',                                  'text',  'Subtítulo',                    'geral'),
('footer_text',          '© 2024 Casa José Silva - Todos os direitos reservados', 'text', 'Texto do Rodapé',        'geral'),
-- Contato
('whatsapp_number',      '5511916835853',                                   'text',  'WhatsApp (com DDI)',           'contato'),
('instagram_url',        'https://instagram.com/emporiocasajosessilva',     'url',   'Instagram URL',                'contato'),
('email',                'contato@emporiocasajosessilva.com.br',            'text',  'E-mail',                       'contato'),
('facebook_url',         'https://facebook.com/emporiocasajosessilva',      'url',   'Facebook URL',                 'contato'),
-- Endereço
('address',              'Rua Banda, 733 – Jardim do Mar, São Bernardo do Campo – SP', 'text', 'Endereço',           'endereco'),
('google_maps_embed',    'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3654.4789234567890!2d-46.53!3d-23.69', 'url', 'Google Maps Embed URL', 'endereco'),
('google_maps_link',     'https://www.google.com/maps/search/?api=1&query=Rua+Banda%2C+733%2C+Jardim+do+Mar%2C+S%C3%A3o+Bernardo+do+Campo%2C+SP', 'url', 'Google Maps Link', 'endereco'),
-- Entrega
('delivery_fee',         '5.00',        'number', 'Taxa de Entrega (R$)',        'entrega'),
('min_order',            '25.00',       'number', 'Pedido Mínimo (R$)',          'entrega'),
('delivery_time',        '40-60 min',   'text',   'Tempo Estimado de Entrega',   'entrega'),
-- Pagamento
('infinitepay_handle',   'eric-eduardo-p78', 'text', 'Handle InfinitePay',       'pagamento'),
-- Visual
('primary_color',        '#D4AF37',     'color',  'Cor Principal (Ouro)',        'visual'),
('accent_color',         '#4A7043',     'color',  'Cor de Destaque (Verde)',     'visual'),
('hero_image',           '',            'image',  'Imagem de Destaque (URL)',    'visual'),
-- Horários (JSON para uso futuro)
('horarios', '[{"dia":"Domingo","horario":"18:00 às 22:00"},{"dia":"Segunda-feira","horario":"11:00 às 15:00"},{"dia":"Terça-feira","horario":"11:00 às 15:00 / 18:00 às 22:00"},{"dia":"Quarta-feira","horario":"11:00 às 15:00 / 18:00 às 22:00"},{"dia":"Quinta-feira","horario":"11:00 às 15:00 / 18:00 às 22:00"},{"dia":"Sexta-feira","horario":"11:00 às 15:00 / 18:00 às 23:30"},{"dia":"Sábado","horario":"11:00 às 15:00 / 18:00 às 23:30"}]', 'json', 'Horários de Funcionamento', 'horarios');

-- ============================================================
-- 10. DADOS INICIAIS DO CARDÁPIO
--     Colunas: nome, descricao, preco, categoria, subcategoria,
--     imagem_url, disponivel, destaque, ordem
-- ============================================================
INSERT INTO produtos (nome, descricao, preco, categoria, subcategoria, imagem_url, disponivel, destaque, ordem) VALUES
-- Menu
('Menu Executivo Individual', 'Prato principal, arroz, feijão, salada e bebida',               28.00, 'menu', '1pessoa',  'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop', true, false, 1),
('Menu para Casal',           'Dois pratos principais, arroz, feijão, salada e 2 bebidas',     52.00, 'menu', '2pessoas', 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop', true, false, 2),
('Menu Família',              'Quatro pratos principais, arroz, feijão, salada e 4 bebidas',   98.00, 'menu', '4pessoas', 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop', true, true,  3),
-- Entradas
('Bruschetta Tradicional',    'Pão italiano, tomate, manjericão e azeite',                     18.90, 'entradas', NULL, 'https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=400&h=300&fit=crop', true, false, 10),
('Bolinho de Bacalhau',       '6 unidades com molho especial',                                 24.90, 'entradas', NULL, NULL, true, false, 11),
-- Pizzas Tradicionais (8 fatias)
('Pizza Margherita',           'Molho de tomate, muçarela de búfala e manjericão',             45.90, 'pizzas-tradicionais', '8fatias', 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400&h=300&fit=crop', true, true,  20),
('Pizza Calabresa',            'Calabresa fatiada, cebola e azeitona',                         42.90, 'pizzas-tradicionais', '8fatias', 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400&h=300&fit=crop', true, true,  21),
('Pizza Portuguesa',           'Presunto, ovos, cebola, azeitona e ervilha',                   48.90, 'pizzas-tradicionais', '8fatias', NULL, true, false, 22),
('Pizza Frango com Catupiry',  'Frango desfiado com catupiry cremoso',                         46.90, 'pizzas-tradicionais', '8fatias', NULL, true, false, 23),
-- Pizzas Tradicionais (4 fatias)
('Pizza Margherita (4 fatias)', 'Molho de tomate, muçarela de búfala e manjericão',            28.90, 'pizzas-tradicionais', '4fatias', 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400&h=300&fit=crop', true, false, 24),
('Pizza Calabresa (4 fatias)',  'Calabresa fatiada, cebola e azeitona',                        26.90, 'pizzas-tradicionais', '4fatias', NULL, true, false, 25),
-- Pizzas Especiais (8 fatias)
('Pizza Quatro Queijos',       'Muçarela, provolone, gorgonzola e parmesão',                   54.90, 'pizzas-especiais', '8fatias', NULL, true, true,  30),
('Pizza Filé Mignon',          'Filé mignon, cebola caramelizada e cream cheese',              58.90, 'pizzas-especiais', '8fatias', NULL, true, true,  31),
('Pizza Camarão',              'Camarão, catupiry e tomate seco',                              62.90, 'pizzas-especiais', '8fatias', NULL, true, false, 32),
-- Pizzas Especiais (4 fatias)
('Pizza Quatro Queijos (4 fatias)', 'Muçarela, provolone, gorgonzola e parmesão',              34.90, 'pizzas-especiais', '4fatias', NULL, true, false, 33),
('Pizza Filé Mignon (4 fatias)',    'Filé mignon, cebola caramelizada e cream cheese',         36.90, 'pizzas-especiais', '4fatias', NULL, true, false, 34),
-- Pizzas Doces (8 fatias)
('Pizza Chocolate',            'Chocolate ao leite com morangos frescos',                      48.90, 'pizzas-doces', '8fatias', 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400&h=300&fit=crop', true, false, 40),
('Pizza Brigadeiro',           'Brigadeiro cremoso com granulado',                             46.90, 'pizzas-doces', '8fatias', NULL, true, false, 41),
('Pizza Romeu e Julieta',      'Goiabada com queijo minas derretido',                          44.90, 'pizzas-doces', '8fatias', NULL, true, false, 42),
-- Pizzas Doces (4 fatias)
('Pizza Chocolate (4 fatias)', 'Chocolate ao leite com morangos frescos',                      29.90, 'pizzas-doces', '4fatias', NULL, true, false, 43),
('Pizza Brigadeiro (4 fatias)','Brigadeiro cremoso com granulado',                             28.90, 'pizzas-doces', '4fatias', NULL, true, false, 44),
-- Bebidas
('Refrigerante Lata',          'Coca-Cola, Guaraná ou Fanta',                                   6.00, 'bebidas', NULL, NULL, true, false, 50),
('Suco Natural 500ml',         'Laranja, limão ou abacaxi',                                    12.00, 'bebidas', NULL, NULL, true, false, 51),
('Água Mineral 500ml',         'Com ou sem gás',                                                4.00, 'bebidas', NULL, NULL, true, false, 52),
-- Cervejas
('Heineken Long Neck',         '330ml gelada',                                                  9.90, 'cervejas', NULL, NULL, true, false, 60),
('Brahma Duplo Malte',         '350ml gelada',                                                  8.90, 'cervejas', NULL, NULL, true, false, 61),
('Corona Extra',               '330ml gelada',                                                 12.90, 'cervejas', NULL, NULL, true, false, 62),
-- Drinks
('Caipirinha',                 'Limão, vodka ou cachaça',                                      18.00, 'drinks', NULL, NULL, true, false, 70),
('Mojito',                     'Hortelã, limão e rum',                                         22.00, 'drinks', NULL, NULL, true, false, 71),
('Gin Tônica',                 'Gin, água tônica, limão e especiarias',                        24.00, 'drinks', NULL, NULL, true, false, 72),
-- Sobremesas
('Petit Gateau',               'Bolo de chocolate com sorvete de creme',                       16.90, 'sobremesas', NULL, NULL, true, false, 80),
('Torta de Limão',             'Massa crocante com creme de limão',                            14.90, 'sobremesas', NULL, NULL, true, false, 81),
('Açaí 500ml',                 'Açaí com banana, granola e leite condensado',                  19.90, 'sobremesas', NULL, NULL, true, false, 82);

-- ============================================================
-- 11. CRIAR ADMIN INICIAL
-- ============================================================
-- PASSO A PASSO:
-- 1) Acesse o site (index.html) e crie uma conta com seu email
-- 2) Volte aqui e execute o comando abaixo substituindo o email:
--
-- INSERT INTO admin_users (auth_user_id, nome, email, role)
-- SELECT id, 'Seu Nome', 'SEU_EMAIL@AQUI.COM', 'superadmin'
-- FROM auth.users WHERE email = 'SEU_EMAIL@AQUI.COM';
--
-- Pronto! Agora esse email pode acessar admin.html.
-- ============================================================

-- ============================================================
-- 12. SUPABASE STORAGE — BUCKET DE IMAGENS
-- Cole no SQL Editor do Supabase para criar o bucket e as policies.
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('images', 'images', true)
ON CONFLICT (id) DO NOTHING;

-- Admins podem fazer upload
CREATE POLICY "Admins podem enviar imagens" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'images' AND is_admin());

-- Admins podem atualizar
CREATE POLICY "Admins podem atualizar imagens" ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'images' AND is_admin());

-- Admins podem deletar
CREATE POLICY "Admins podem deletar imagens" ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'images' AND is_admin());

-- Todos podem visualizar (bucket público)
CREATE POLICY "Imagens públicas para leitura" ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'images');

-- ============================================================
--  DELIVERY ZONES
-- ============================================================
CREATE TABLE IF NOT EXISTS delivery_zones (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  nome TEXT NOT NULL,
  raio_km NUMERIC(6,2) NOT NULL,
  taxa_entrega NUMERIC(8,2) NOT NULL DEFAULT 0,
  prazo_entrega TEXT NOT NULL DEFAULT '30-45 min',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE delivery_zones ENABLE ROW LEVEL SECURITY;

-- Qualquer um pode ler (para o checkout calcular frete)
CREATE POLICY "delivery_zones_select" ON delivery_zones FOR SELECT
  TO public USING (true);

-- Apenas admins podem inserir
CREATE POLICY "delivery_zones_insert" ON delivery_zones FOR INSERT
  TO authenticated WITH CHECK (is_admin());

-- Apenas admins podem atualizar
CREATE POLICY "delivery_zones_update" ON delivery_zones FOR UPDATE
  TO authenticated USING (is_admin());

-- Apenas admins podem deletar
CREATE POLICY "delivery_zones_delete" ON delivery_zones FOR DELETE
  TO authenticated USING (is_admin());

-- ============================================================
-- 13. MIGRACAO INCREMENTAL (ADMIN PODE CRIAR PEDIDO DE MESA)
-- Execute este bloco em bancos ja existentes (sem reset total).
-- ============================================================

-- Vincula auth_user_id em admin_users pelo email (quando estiver nulo)
UPDATE admin_users au
SET auth_user_id = u.id
FROM auth.users u
WHERE au.email = u.email
  AND au.auth_user_id IS NULL;

-- Garante policy de insert para admin em pedidos
DROP POLICY IF EXISTS "Admins podem criar pedidos" ON pedidos;
CREATE POLICY "Admins podem criar pedidos"
  ON pedidos FOR INSERT TO authenticated
  WITH CHECK (is_admin());

-- ============================================================
-- 14. PROMOCOES POPUP + CUPONS (MIGRACAO INCREMENTAL)
-- ============================================================

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS coupon_code TEXT,
  ADD COLUMN IF NOT EXISTS coupon_discount NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coupon_meta JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS promotion_popups (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  promo_type TEXT NOT NULL DEFAULT 'general'
    CHECK (promo_type IN ('general','daily','weekly','first_login','first_order')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  rules TEXT,
  image_url TEXT,
  coupon_code TEXT,
  discount_percent NUMERIC(5,2) CHECK (discount_percent >= 0 AND discount_percent <= 100),
  original_price NUMERIC(10,2) CHECK (original_price >= 0),
  promo_price NUMERIC(10,2) CHECK (promo_price >= 0),
  product_id BIGINT REFERENCES produtos(id) ON DELETE SET NULL,
  product_ids BIGINT[] NOT NULL DEFAULT '{}'::BIGINT[],
  button_text TEXT DEFAULT 'Ver produto',
  start_date DATE,
  end_date DATE,
  start_time TIME NOT NULL DEFAULT '00:00',
  end_time TIME NOT NULL DEFAULT '23:59',
  days_of_week INT[] NOT NULL DEFAULT '{}'::INT[],
  delay_seconds INT NOT NULL DEFAULT 3 CHECK (delay_seconds >= 0),
  cooldown_minutes INT NOT NULL DEFAULT 180 CHECK (cooldown_minutes >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  highlight_style BOOLEAN NOT NULL DEFAULT false,
  priority INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promotion_date_range_chk CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

ALTER TABLE promotion_popups
  ADD COLUMN IF NOT EXISTS product_ids BIGINT[] NOT NULL DEFAULT '{}'::BIGINT[];

CREATE INDEX IF NOT EXISTS idx_promotion_popups_active ON promotion_popups (is_active, priority DESC);
CREATE INDEX IF NOT EXISTS idx_promotion_popups_type ON promotion_popups (promo_type);
CREATE INDEX IF NOT EXISTS idx_promotion_popups_period ON promotion_popups (start_date, end_date);

DROP TRIGGER IF EXISTS trigger_promotion_popups_updated_at ON promotion_popups;
CREATE TRIGGER trigger_promotion_popups_updated_at
  BEFORE UPDATE ON promotion_popups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE promotion_popups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Promotion popups public read" ON promotion_popups;
CREATE POLICY "Promotion popups public read"
  ON promotion_popups FOR SELECT
  TO public
  USING (is_active = true);

DROP POLICY IF EXISTS "Promotion popups admin all" ON promotion_popups;
CREATE POLICY "Promotion popups admin all"
  ON promotion_popups FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE TABLE IF NOT EXISTS discount_coupons (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  discount_type TEXT NOT NULL DEFAULT 'percent'
    CHECK (discount_type IN ('percent','fixed')),
  discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value >= 0),
  min_order_value NUMERIC(10,2) DEFAULT 0 CHECK (min_order_value >= 0),
  usage_limit INT,
  usage_count INT NOT NULL DEFAULT 0,
  per_user_limit INT NOT NULL DEFAULT 1,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  linked_promotion_id BIGINT REFERENCES promotion_popups(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discount_coupons_code ON discount_coupons (code);
CREATE INDEX IF NOT EXISTS idx_discount_coupons_active ON discount_coupons (is_active, expires_at);

DROP TRIGGER IF EXISTS trigger_discount_coupons_updated_at ON discount_coupons;
CREATE TRIGGER trigger_discount_coupons_updated_at
  BEFORE UPDATE ON discount_coupons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE discount_coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Discount coupons public read" ON discount_coupons;
CREATE POLICY "Discount coupons public read"
  ON discount_coupons FOR SELECT
  TO public
  USING (is_active = true);

DROP POLICY IF EXISTS "Discount coupons admin all" ON discount_coupons;
CREATE POLICY "Discount coupons admin all"
  ON discount_coupons FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE TABLE IF NOT EXISTS promotion_popup_events (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  promotion_id BIGINT NOT NULL REFERENCES promotion_popups(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('view','click','conversion')),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT,
  coupon_code TEXT,
  product_id BIGINT REFERENCES produtos(id) ON DELETE SET NULL,
  order_id BIGINT REFERENCES pedidos(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotion_events_promo ON promotion_popup_events (promotion_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promotion_events_type ON promotion_popup_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promotion_events_session ON promotion_popup_events (session_id);

ALTER TABLE promotion_popup_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Promotion events public insert" ON promotion_popup_events;
CREATE POLICY "Promotion events public insert"
  ON promotion_popup_events FOR INSERT
  TO public
  WITH CHECK (true);

DROP POLICY IF EXISTS "Promotion events admin read" ON promotion_popup_events;
CREATE POLICY "Promotion events admin read"
  ON promotion_popup_events FOR SELECT
  TO authenticated
  USING (is_admin());

INSERT INTO site_config (key, value, type, label, section) VALUES
('sales_open_days', '0,2,3,4,5,6', 'text', 'Dias Abertos Para Pedido', 'horarios'),
('lunch_open_days', '0,2,3,4,5,6', 'text', 'Dias Com Almoço', 'horarios'),
('lunch_start', '11:00', 'text', 'Início Almoço (HH:MM)', 'horarios'),
('lunch_end', '15:00', 'text', 'Fim Almoço (HH:MM)', 'horarios'),
('lunch_categories', 'menu', 'text', 'Categorias Liberadas Almoço', 'horarios'),
('closed_between_start', '15:00', 'text', 'Início Intervalo Fechado', 'horarios'),
('closed_between_end', '18:00', 'text', 'Fim Intervalo Fechado', 'horarios'),
('dinner_open_days', '0,2,3,4,5,6', 'text', 'Dias Com Jantar', 'horarios'),
('dinner_start', '18:00', 'text', 'Início Jantar (HH:MM)', 'horarios'),
('dinner_end', '22:00', 'text', 'Fim Jantar (HH:MM)', 'horarios'),
('dinner_categories', 'pizzas-tradicionais,pizzas-especiais,pizzas-doces', 'text', 'Categorias Liberadas Jantar', 'horarios'),
('schedule_message_closed', 'Fechado no momento', 'text', 'Mensagem Quando Fechado', 'horarios')
ON CONFLICT (key) DO NOTHING;
