-- ============================================================
-- UNIFORMES INTELIGENTES — Migration 002: RLS e políticas
-- Seguindo o mesmo padrão do módulo Ponto (anon key autenticado).
-- ============================================================

-- Ativar RLS em todas as tabelas de uniformes
ALTER TABLE unif_plants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_sizes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_suppliers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_stock           ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_receipts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_receipt_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_deliveries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_delivery_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_request_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_inventory       ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE unif_audit           ENABLE ROW LEVEL SECURITY;

-- Helper: retorna o role do usuário logado (mesmo padrão usado no Ponto)
CREATE OR REPLACE FUNCTION get_my_unif_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM user_roles
  WHERE user_id = auth.uid() AND is_active = true
  ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'supervisor_dp' THEN 1 ELSE 2 END
  LIMIT 1;
$$;

-- ── LEITURA: qualquer usuário autenticado pode ler ────────────
-- (controle fino feito no frontend via MODULE/ROLE)
DO $$ DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'unif_plants','unif_items','unif_sizes','unif_suppliers',
    'unif_stock','unif_stock_movements',
    'unif_purchase_orders','unif_purchase_order_items',
    'unif_receipts','unif_receipt_items',
    'unif_deliveries','unif_delivery_items',
    'unif_requests','unif_request_items',
    'unif_inventory','unif_inventory_items',
    'unif_audit'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "read_authenticated" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "read_authenticated" ON %I FOR SELECT TO authenticated USING (true)',
      t
    );
  END LOOP;
END $$;

-- ── ESCRITA: owner e supervisor_dp (RH) têm acesso total ─────
DO $$ DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'unif_plants','unif_items','unif_sizes','unif_suppliers',
    'unif_stock','unif_stock_movements',
    'unif_purchase_orders','unif_purchase_order_items',
    'unif_receipts','unif_receipt_items',
    'unif_deliveries','unif_delivery_items',
    'unif_requests','unif_request_items',
    'unif_inventory','unif_inventory_items',
    'unif_audit'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "write_rh" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "write_rh" ON %I FOR ALL TO authenticated
       USING (get_my_unif_role() IN (''owner'',''supervisor_dp''))
       WITH CHECK (get_my_unif_role() IN (''owner'',''supervisor_dp''))',
      t
    );
  END LOOP;
END $$;

-- ── SOLICITAÇÕES: gestores podem inserir e ver suas próprias ──
DROP POLICY IF EXISTS "request_insert_any_auth" ON unif_requests;
CREATE POLICY "request_insert_any_auth" ON unif_requests
  FOR INSERT TO authenticated
  WITH CHECK (true);  -- qualquer autenticado pode criar uma solicitação

DROP POLICY IF EXISTS "request_items_insert_any_auth" ON unif_request_items;
CREATE POLICY "request_items_insert_any_auth" ON unif_request_items
  FOR INSERT TO authenticated
  WITH CHECK (true);
