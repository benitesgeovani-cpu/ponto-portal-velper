-- ============================================================
-- UNIFORMES INTELIGENTES — Migration 003: RPCs transacionais
-- Todas as operações críticas de estoque são atômicas via RPC.
-- ============================================================

-- ── RPC: registrar_entrega ────────────────────────────────────
-- Valida estoque, cria entrega, reduz saldo, registra auditoria.
-- Retorna { delivery_id, protocol } ou lança EXCEPTION.
CREATE OR REPLACE FUNCTION registrar_entrega(
  p_plant_id     uuid,
  p_employee_id  text,
  p_employee_name text,
  p_employee_dept text,
  p_reason       text,
  p_responsible  text,
  p_obs          text,
  p_items        jsonb,  -- [{item_id, size_id, qty}]
  p_user_id      uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_delivery_id uuid;
  v_protocol    text;
  v_available   int;
  v_item        record;
BEGIN
  -- Validar estoque antes de qualquer escrita
  FOR v_item IN
    SELECT (x->>'item_id')::uuid AS item_id,
           (x->>'size_id')::uuid AS size_id,
           (x->>'qty')::int      AS qty
    FROM jsonb_array_elements(p_items) x
  LOOP
    SELECT qty_available INTO v_available
    FROM unif_stock
    WHERE plant_id = p_plant_id
      AND item_id  = v_item.item_id
      AND size_id  = v_item.size_id;

    IF v_available IS NULL THEN
      RAISE EXCEPTION 'Sem saldo cadastrado para item/tamanho solicitado.';
    END IF;
    IF v_available < v_item.qty THEN
      RAISE EXCEPTION 'Estoque insuficiente: disponível %, solicitado %.', v_available, v_item.qty;
    END IF;
  END LOOP;

  -- Gerar protocolo
  v_protocol := 'ENT-' || TO_CHAR(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYYMMDD')
                || '-' || LPAD(NEXTVAL('unif_delivery_seq')::text, 4, '0');

  -- Inserir entrega
  INSERT INTO unif_deliveries
    (protocol, plant_id, employee_id, employee_name, employee_dept, reason, responsible, obs, created_by)
  VALUES
    (v_protocol, p_plant_id, p_employee_id, p_employee_name, p_employee_dept, p_reason, p_responsible, p_obs, p_user_id)
  RETURNING id INTO v_delivery_id;

  -- Itens + redução de estoque
  FOR v_item IN
    SELECT (x->>'item_id')::uuid AS item_id,
           (x->>'size_id')::uuid AS size_id,
           (x->>'qty')::int      AS qty
    FROM jsonb_array_elements(p_items) x
  LOOP
    INSERT INTO unif_delivery_items (delivery_id, item_id, size_id, qty)
    VALUES (v_delivery_id, v_item.item_id, v_item.size_id, v_item.qty);

    UPDATE unif_stock
    SET qty_available    = qty_available - v_item.qty,
        last_movement_at = NOW()
    WHERE plant_id = p_plant_id
      AND item_id  = v_item.item_id
      AND size_id  = v_item.size_id;

    INSERT INTO unif_stock_movements
      (plant_id, item_id, size_id, qty, movement_type, reference_id, reference_type, created_by)
    VALUES
      (p_plant_id, v_item.item_id, v_item.size_id, -v_item.qty,
       'saida_entrega', v_delivery_id, 'delivery', p_user_id);
  END LOOP;

  -- Auditoria
  INSERT INTO unif_audit (entity, entity_id, action, plant_id, new_value, created_by)
  VALUES ('delivery', v_delivery_id, 'entrega_registrada', p_plant_id,
    jsonb_build_object('protocol', v_protocol, 'employee', p_employee_name,
                       'reason', p_reason, 'items', p_items), p_user_id);

  RETURN jsonb_build_object('delivery_id', v_delivery_id, 'protocol', v_protocol);
END;
$$;

-- ── RPC: cancelar_entrega ─────────────────────────────────────
CREATE OR REPLACE FUNCTION cancelar_entrega(
  p_delivery_id  uuid,
  p_reason       text,
  p_user_id      uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_del   unif_deliveries%ROWTYPE;
  v_item  record;
BEGIN
  SELECT * INTO v_del FROM unif_deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrega não encontrada.'; END IF;
  IF v_del.status = 'cancelada' THEN RAISE EXCEPTION 'Entrega já cancelada.'; END IF;

  UPDATE unif_deliveries
  SET status = 'cancelada', cancelled_by = p_user_id,
      cancelled_at = NOW(), cancel_reason = p_reason
  WHERE id = p_delivery_id;

  FOR v_item IN SELECT * FROM unif_delivery_items WHERE delivery_id = p_delivery_id
  LOOP
    UPDATE unif_stock
    SET qty_available    = qty_available + v_item.qty,
        last_movement_at = NOW()
    WHERE plant_id = v_del.plant_id
      AND item_id  = v_item.item_id
      AND size_id  = v_item.size_id;

    INSERT INTO unif_stock_movements
      (plant_id, item_id, size_id, qty, movement_type, reference_id, reference_type, obs, created_by)
    VALUES
      (v_del.plant_id, v_item.item_id, v_item.size_id, v_item.qty,
       'cancelamento', p_delivery_id, 'delivery', p_reason, p_user_id);
  END LOOP;

  INSERT INTO unif_audit (entity, entity_id, action, plant_id, new_value, created_by)
  VALUES ('delivery', p_delivery_id, 'entrega_cancelada', v_del.plant_id,
    jsonb_build_object('reason', p_reason), p_user_id);
END;
$$;

-- ── RPC: confirmar_recebimento ────────────────────────────────
-- Recebe (total ou parcial) um pedido e adiciona ao estoque.
CREATE OR REPLACE FUNCTION confirmar_recebimento(
  p_order_id    uuid,
  p_nf_number   text,
  p_obs         text,
  p_items       jsonb,  -- [{item_id, size_id, qty_received}]
  p_user_id     uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_receipt_id  uuid;
  v_plant_id    uuid;
  v_item        record;
  v_total_ord   int;
  v_total_rec   int;
  v_new_status  text;
BEGIN
  SELECT plant_id INTO v_plant_id FROM unif_purchase_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;

  INSERT INTO unif_receipts (order_id, plant_id, nf_number, obs, created_by)
  VALUES (p_order_id, v_plant_id, p_nf_number, p_obs, p_user_id)
  RETURNING id INTO v_receipt_id;

  FOR v_item IN
    SELECT (x->>'item_id')::uuid AS item_id,
           (x->>'size_id')::uuid AS size_id,
           (x->>'qty_received')::int AS qty_received
    FROM jsonb_array_elements(p_items) x
  LOOP
    INSERT INTO unif_receipt_items (receipt_id, item_id, size_id, qty_received)
    VALUES (v_receipt_id, v_item.item_id, v_item.size_id, v_item.qty_received);

    -- Upsert no saldo
    INSERT INTO unif_stock (plant_id, item_id, size_id, qty_available, last_movement_at)
    VALUES (v_plant_id, v_item.item_id, v_item.size_id, v_item.qty_received, NOW())
    ON CONFLICT (plant_id, item_id, size_id) DO UPDATE
    SET qty_available    = unif_stock.qty_available + EXCLUDED.qty_available,
        last_movement_at = NOW();

    -- Movimento
    INSERT INTO unif_stock_movements
      (plant_id, item_id, size_id, qty, movement_type, reference_id, reference_type, created_by)
    VALUES
      (v_plant_id, v_item.item_id, v_item.size_id, v_item.qty_received,
       'entrada_recebimento', v_receipt_id, 'receipt', p_user_id);

    -- Atualiza qty_received na linha do pedido
    UPDATE unif_purchase_order_items
    SET qty_received = qty_received + v_item.qty_received
    WHERE order_id  = p_order_id
      AND item_id   = v_item.item_id
      AND size_id   = v_item.size_id;
  END LOOP;

  -- Recalcula status do pedido
  SELECT SUM(qty_ordered), SUM(qty_received)
  INTO v_total_ord, v_total_rec
  FROM unif_purchase_order_items
  WHERE order_id = p_order_id;

  v_new_status := CASE
    WHEN v_total_rec >= v_total_ord THEN 'recebido'
    WHEN v_total_rec > 0            THEN 'recebido_parcial'
    ELSE 'aguardando_recebimento'
  END;

  UPDATE unif_purchase_orders
  SET status = v_new_status, updated_at = NOW()
  WHERE id = p_order_id;

  INSERT INTO unif_audit (entity, entity_id, action, plant_id, new_value, created_by)
  VALUES ('receipt', v_receipt_id, 'recebimento_confirmado', v_plant_id,
    jsonb_build_object('order_id', p_order_id, 'nf', p_nf_number, 'items', p_items), p_user_id);

  RETURN v_receipt_id;
END;
$$;

-- ── RPC: concluir_inventario ──────────────────────────────────
CREATE OR REPLACE FUNCTION concluir_inventario(
  p_inventory_id uuid,
  p_items        jsonb,  -- [{inventory_item_id, qty_counted, adjust_reason}]
  p_user_id      uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inv   unif_inventory%ROWTYPE;
  v_item  record;
  v_ii    unif_inventory_items%ROWTYPE;
  v_diff  int;
BEGIN
  SELECT * INTO v_inv FROM unif_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventário não encontrado.'; END IF;
  IF v_inv.status <> 'em_andamento' THEN RAISE EXCEPTION 'Inventário não está em andamento.'; END IF;

  FOR v_item IN
    SELECT (x->>'inventory_item_id')::uuid AS iid,
           (x->>'qty_counted')::int        AS qty_counted,
           (x->>'adjust_reason')::text     AS adjust_reason
    FROM jsonb_array_elements(p_items) x
  LOOP
    SELECT * INTO v_ii FROM unif_inventory_items WHERE id = v_item.iid;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_diff := v_item.qty_counted - v_ii.qty_expected;

    UPDATE unif_inventory_items
    SET qty_counted    = v_item.qty_counted,
        adjust_reason  = v_item.adjust_reason,
        adjusted_by    = p_user_id,
        adjusted_at    = NOW()
    WHERE id = v_item.iid;

    IF v_diff <> 0 THEN
      UPDATE unif_stock
      SET qty_available    = GREATEST(0, qty_available + v_diff),
          last_movement_at = NOW()
      WHERE plant_id = v_inv.plant_id
        AND item_id  = v_ii.item_id
        AND size_id  = v_ii.size_id;

      INSERT INTO unif_stock_movements
        (plant_id, item_id, size_id, qty, movement_type, reference_id, reference_type, obs, created_by)
      VALUES
        (v_inv.plant_id, v_ii.item_id, v_ii.size_id, v_diff,
         'ajuste_inventario', p_inventory_id, 'inventory', v_item.adjust_reason, p_user_id);
    END IF;
  END LOOP;

  UPDATE unif_inventory
  SET status = 'concluido', completed_by = p_user_id, completed_at = NOW()
  WHERE id = p_inventory_id;

  INSERT INTO unif_audit (entity, entity_id, action, plant_id, created_by)
  VALUES ('inventory', p_inventory_id, 'inventario_concluido', v_inv.plant_id, p_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION registrar_entrega    TO authenticated;
GRANT EXECUTE ON FUNCTION cancelar_entrega     TO authenticated;
GRANT EXECUTE ON FUNCTION confirmar_recebimento TO authenticated;
GRANT EXECUTE ON FUNCTION concluir_inventario  TO authenticated;
