BEGIN;
ALTER TABLE public.parts_order_items
  ADD COLUMN received_qty integer,
  ADD COLUMN receive_note text,
  ADD COLUMN receive_op uuid,
  ADD CONSTRAINT parts_order_items_received_qty_check CHECK (received_qty BETWEEN 0 AND 999999);

CREATE FUNCTION public.parts_order_has_receipt(p_order uuid) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.parts_order_items
    WHERE order_id = p_order AND (received_qty IS NOT NULL OR btrim(coalesce(receive_note, '')) <> ''));
$$;

CREATE FUNCTION public.guard_parts_order_items() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM public.parts_orders WHERE id = OLD.order_id FOR UPDATE;
    IF public.parts_order_has_receipt(OLD.order_id) THEN
      RAISE EXCEPTION '입고 기록이 있어 삭제할 수 없습니다' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM public.parts_orders WHERE id = NEW.order_id FOR UPDATE;
    IF public.parts_order_has_receipt(NEW.order_id) THEN
      RAISE EXCEPTION '입고 기록이 있는 발주에는 품목을 추가할 수 없습니다' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.part_id IS DISTINCT FROM OLD.part_id OR NEW.quantity IS DISTINCT FROM OLD.quantity) THEN
    PERFORM 1 FROM public.parts_orders WHERE id IN (OLD.order_id, NEW.order_id) ORDER BY id FOR UPDATE;
    IF public.parts_order_has_receipt(OLD.order_id) OR public.parts_order_has_receipt(NEW.order_id) THEN
      RAISE EXCEPTION '입고 기록이 있어 품목을 변경할 수 없습니다' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF (TG_OP = 'INSERT' AND (NEW.received_qty IS NOT NULL OR btrim(coalesce(NEW.receive_note, '')) <> ''))
     OR (TG_OP = 'UPDATE' AND (NEW.received_qty IS DISTINCT FROM OLD.received_qty
                            OR NEW.receive_note IS DISTINCT FROM OLD.receive_note)) THEN
    SELECT status INTO v_status FROM public.parts_orders WHERE id = NEW.order_id FOR UPDATE;
    IF v_status IS DISTINCT FROM 'confirmed' THEN
      RAISE EXCEPTION '확정된 발주만 입고를 기록할 수 있습니다' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.guard_parts_orders_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'confirmed' AND NEW.status <> 'confirmed' AND public.parts_order_has_receipt(OLD.id) THEN
    RAISE EXCEPTION '입고 기록이 있어 작성중으로 되돌릴 수 없습니다' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER guard_parts_order_items BEFORE INSERT OR UPDATE OR DELETE ON public.parts_order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_parts_order_items();
CREATE TRIGGER guard_parts_orders_status BEFORE UPDATE ON public.parts_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_parts_orders_status();
COMMIT;
