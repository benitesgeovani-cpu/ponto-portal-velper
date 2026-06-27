-- ============================================================
-- UNIFORMES INTELIGENTES — Migration 001: tabelas e índices
-- Aplicar no Supabase SQL Editor (Dashboard > SQL Editor)
-- NÃO afeta nenhuma tabela do módulo Ponto Inteligente DP.
-- ============================================================

-- SEQUÊNCIA para protocolo de entrega
CREATE SEQUENCE IF NOT EXISTS unif_delivery_seq START 1;

-- ── PLANTAS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_plants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  code        text NOT NULL UNIQUE,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW(),
  created_by  uuid REFERENCES auth.users(id)
);
INSERT INTO unif_plants (name, code) VALUES
  ('Aço',         'ACO'),
  ('Arutec',      'ARU'),
  ('Pinheirinho', 'PIN')
ON CONFLICT (code) DO NOTHING;

-- ── ITENS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  description text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW(),
  created_by  uuid REFERENCES auth.users(id)
);
INSERT INTO unif_items (name, description) VALUES
  ('Calça',    'Calça de trabalho'),
  ('Camiseta', 'Camiseta de trabalho')
ON CONFLICT (name) DO NOTHING;

-- ── TAMANHOS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_sizes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);
INSERT INTO unif_sizes (code, name, sort_order) VALUES
  ('P',   'P',   1),
  ('M',   'M',   2),
  ('G',   'G',   3),
  ('GG',  'GG',  4),
  ('XG',  'XG',  5),
  ('XGG', 'XGG', 6)
ON CONFLICT (code) DO NOTHING;

-- ── FORNECEDORES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_suppliers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  cnpj        text,
  contact     text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW(),
  created_by  uuid REFERENCES auth.users(id)
);
INSERT INTO unif_suppliers (name) VALUES
  ('Viva Vida Confecções Ltda.')
ON CONFLICT DO NOTHING;

-- ── ESTOQUE (saldo atual) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_stock (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id         uuid NOT NULL REFERENCES unif_plants(id),
  item_id          uuid NOT NULL REFERENCES unif_items(id),
  size_id          uuid NOT NULL REFERENCES unif_sizes(id),
  qty_available    int NOT NULL DEFAULT 0 CHECK (qty_available >= 0),
  qty_minimum      int NOT NULL DEFAULT 0,
  last_movement_at timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (plant_id, item_id, size_id)
);
CREATE INDEX IF NOT EXISTS idx_unif_stock_plant  ON unif_stock(plant_id);
CREATE INDEX IF NOT EXISTS idx_unif_stock_item   ON unif_stock(item_id);
CREATE INDEX IF NOT EXISTS idx_unif_stock_status ON unif_stock(qty_available, qty_minimum);

-- ── MOVIMENTOS DE ESTOQUE ────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_stock_movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id       uuid NOT NULL REFERENCES unif_plants(id),
  item_id        uuid NOT NULL REFERENCES unif_items(id),
  size_id        uuid NOT NULL REFERENCES unif_sizes(id),
  qty            int NOT NULL,           -- positivo = entrada, negativo = saída
  movement_type  text NOT NULL,          -- entrada_recebimento | saida_entrega | ajuste_inventario | cancelamento | transferencia
  reference_id   uuid,
  reference_type text,                   -- delivery | receipt | inventory | transfer
  obs            text,
  created_by     uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_unif_mov_plant  ON unif_stock_movements(plant_id);
CREATE INDEX IF NOT EXISTS idx_unif_mov_item   ON unif_stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_unif_mov_date   ON unif_stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unif_mov_ref    ON unif_stock_movements(reference_id);

-- ── PEDIDOS DE COMPRA ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_purchase_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id        uuid NOT NULL REFERENCES unif_plants(id),
  supplier_id     uuid REFERENCES unif_suppliers(id),
  po_number       text,
  order_date      date,
  expected_date   date,
  status          text NOT NULL DEFAULT 'rascunho',
  -- rascunho | pedido_realizado | aguardando_recebimento | recebido_parcial | recebido | em_atraso | cancelado
  total_value     numeric(12,2),
  obs             text,
  created_by      uuid REFERENCES auth.users(id),
  updated_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_unif_po_plant  ON unif_purchase_orders(plant_id);
CREATE INDEX IF NOT EXISTS idx_unif_po_status ON unif_purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_unif_po_date   ON unif_purchase_orders(order_date DESC);

-- ── LINHAS DO PEDIDO ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_purchase_order_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES unif_purchase_orders(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES unif_items(id),
  size_id      uuid NOT NULL REFERENCES unif_sizes(id),
  qty_ordered  int NOT NULL CHECK (qty_ordered > 0),
  qty_received int NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_value   numeric(10,2)
);
CREATE INDEX IF NOT EXISTS idx_unif_poi_order ON unif_purchase_order_items(order_id);

-- ── RECEBIMENTOS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES unif_purchase_orders(id),
  plant_id     uuid NOT NULL REFERENCES unif_plants(id),
  receipt_date date NOT NULL DEFAULT CURRENT_DATE,
  nf_number    text,
  obs          text,
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_unif_rec_order ON unif_receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_unif_rec_plant ON unif_receipts(plant_id);
CREATE INDEX IF NOT EXISTS idx_unif_rec_date  ON unif_receipts(receipt_date DESC);

-- ── LINHAS DO RECEBIMENTO ────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_receipt_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id   uuid NOT NULL REFERENCES unif_receipts(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES unif_items(id),
  size_id      uuid NOT NULL REFERENCES unif_sizes(id),
  qty_received int NOT NULL CHECK (qty_received > 0)
);
CREATE INDEX IF NOT EXISTS idx_unif_ri_receipt ON unif_receipt_items(receipt_id);

-- ── ENTREGAS DE UNIFORME ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol        text NOT NULL UNIQUE,
  plant_id        uuid NOT NULL REFERENCES unif_plants(id),
  employee_id     text,                    -- solides_internal_id (texto, como no ponto)
  employee_name   text NOT NULL,
  employee_dept   text,
  reason          text NOT NULL,
  responsible     text NOT NULL,
  obs             text,
  status          text NOT NULL DEFAULT 'ativa',  -- ativa | cancelada
  cancelled_by    uuid REFERENCES auth.users(id),
  cancelled_at    timestamptz,
  cancel_reason   text,
  created_by      uuid REFERENCES auth.users(id),
  delivered_at    timestamptz NOT NULL DEFAULT NOW(),
  created_at      timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_unif_del_plant    ON unif_deliveries(plant_id);
CREATE INDEX IF NOT EXISTS idx_unif_del_emp      ON unif_deliveries(employee_id);
CREATE INDEX IF NOT EXISTS idx_unif_del_date     ON unif_deliveries(delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_unif_del_status   ON unif_deliveries(status);

-- ── ITENS DA ENTREGA ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_delivery_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES unif_deliveries(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES unif_items(id),
  size_id     uuid NOT NULL REFERENCES unif_sizes(id),
  qty         int NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS idx_unif_di_delivery ON unif_delivery_items(delivery_id);

-- ── SOLICITAÇÕES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id        uuid NOT NULL REFERENCES unif_plants(id),
  employee_id     text,
  employee_name   text NOT NULL,
  employee_dept   text,
  requester_id    uuid REFERENCES auth.users(id),
  requester_name  text,
  status          text NOT NULL DEFAULT 'pendente',
  -- pendente | aprovada | recusada | entregue | cancelada
  obs             text,
  review_note     text,
  reviewed_by     uuid REFERENCES auth.users(id),
  reviewed_at     timestamptz,
  delivery_id     uuid REFERENCES unif_deliveries(id),
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_unif_req_plant    ON unif_requests(plant_id);
CREATE INDEX IF NOT EXISTS idx_unif_req_status   ON unif_requests(status);
CREATE INDEX IF NOT EXISTS idx_unif_req_date     ON unif_requests(created_at DESC);

-- ── ITENS DA SOLICITAÇÃO ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_request_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES unif_requests(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES unif_items(id),
  size_id     uuid NOT NULL REFERENCES unif_sizes(id),
  qty         int NOT NULL CHECK (qty > 0),
  reason      text
);
CREATE INDEX IF NOT EXISTS idx_unif_rqi_request ON unif_request_items(request_id);

-- ── INVENTÁRIOS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_inventory (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id      uuid NOT NULL REFERENCES unif_plants(id),
  status        text NOT NULL DEFAULT 'em_andamento',  -- em_andamento | concluido | cancelado
  obs           text,
  started_by    uuid REFERENCES auth.users(id),
  started_at    timestamptz NOT NULL DEFAULT NOW(),
  completed_by  uuid REFERENCES auth.users(id),
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_unif_inv_plant  ON unif_inventory(plant_id);
CREATE INDEX IF NOT EXISTS idx_unif_inv_status ON unif_inventory(status);

-- ── ITENS DO INVENTÁRIO ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_inventory_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id  uuid NOT NULL REFERENCES unif_inventory(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES unif_items(id),
  size_id       uuid NOT NULL REFERENCES unif_sizes(id),
  qty_expected  int NOT NULL DEFAULT 0,
  qty_counted   int,
  qty_diff      int GENERATED ALWAYS AS (COALESCE(qty_counted,0) - qty_expected) STORED,
  adjust_reason text,
  adjusted_by   uuid REFERENCES auth.users(id),
  adjusted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_unif_invit_inventory ON unif_inventory_items(inventory_id);

-- ── AUDITORIA DE UNIFORMES ────────────────────────────────────
CREATE TABLE IF NOT EXISTS unif_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity      text NOT NULL,          -- delivery | stock | order | receipt | request | inventory | plant | item | size | supplier
  entity_id   uuid,
  action      text NOT NULL,
  plant_id    uuid REFERENCES unif_plants(id),
  old_value   jsonb,
  new_value   jsonb,
  obs         text,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_unif_aud_entity ON unif_audit(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_unif_aud_plant  ON unif_audit(plant_id);
CREATE INDEX IF NOT EXISTS idx_unif_aud_date   ON unif_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unif_aud_user   ON unif_audit(created_by);

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DO $$ DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['unif_plants','unif_items','unif_suppliers','unif_stock','unif_purchase_orders','unif_requests'])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_updated_at ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END $$;
