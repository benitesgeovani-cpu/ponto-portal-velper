-- ============================================================
-- Migration 004: RPC para lançamento e ajuste avulso de estoque
-- Aplicar no Supabase SQL Editor após as migrations anteriores.
-- ============================================================

-- Garante que a sequência de entrega existe (idempotente)
CREATE SEQUENCE IF NOT EXISTS unif_delivery_seq START 1;

CREATE OR REPLACE FUNCTION ajustar_estoque_avulso(
  p_plant_id     uuid,
  p_items        jsonb,    -- [{item_id, size_id, qty, mode}]
                           -- mode: 'definir' = set absoluto | 'adicionar' = incremento
  p_obs          text,
  p_user_id      uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item     record;
  v_old_qty  int;
  v_new_qty  int;
  v_delta    int;
  v_move_type text;
BEGIN
  FOR v_item IN
    SELECT (x->>'item_id')::uuid  AS item_id,
           (x->>'size_id')::uuid  AS size_id,
           (x->>'qty')::int       AS qty,
           COALESCE(x->>'mode','definir') AS mode
    FROM jsonb_array_elements(p_items) x
  LOOP
    -- Lê saldo atual
    SELECT qty_available INTO v_old_qty
    FROM unif_stock
    WHERE plant_id = p_plant_id
      AND item_id  = v_item.item_id
      AND size_id  = v_item.size_id;

    v_old_qty := COALESCE(v_old_qty, 0);

    v_new_qty := CASE v_item.mode
      WHEN 'adicionar' THEN GREATEST(0, v_old_qty + v_item.qty)
      ELSE GREATEST(0, v_item.qty)          -- 'definir': substitui
    END;

    v_delta     := v_new_qty - v_old_qty;
    v_move_type := CASE WHEN v_old_qty = 0 AND v_item.mode = 'definir'
                        THEN 'lancamento_inicial'
                        ELSE 'ajuste_avulso'
                   END;

    -- Upsert no saldo
    INSERT INTO unif_stock (plant_id, item_id, size_id, qty_available, last_movement_at)
    VALUES (p_plant_id, v_item.item_id, v_item.size_id, v_new_qty, NOW())
    ON CONFLICT (plant_id, item_id, size_id) DO UPDATE
    SET qty_available    = v_new_qty,
        last_movement_at = NOW(),
        updated_at       = NOW();

    -- Movimento rastreável (só registra se houve mudança)
    IF v_delta <> 0 THEN
      INSERT INTO unif_stock_movements
        (plant_id, item_id, size_id, qty, movement_type, obs, created_by)
      VALUES
        (p_plant_id, v_item.item_id, v_item.size_id, v_delta,
         v_move_type, p_obs, p_user_id);
    END IF;

    -- Auditoria
    INSERT INTO unif_audit (entity, action, plant_id, old_value, new_value, obs, created_by)
    VALUES ('stock', v_move_type, p_plant_id,
      jsonb_build_object('qty', v_old_qty),
      jsonb_build_object('qty', v_new_qty,
                         'item_id', v_item.item_id,
                         'size_id', v_item.size_id),
      p_obs, p_user_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION ajustar_estoque_avulso TO authenticated;
