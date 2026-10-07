-- Custom migration: database-level guards that protect financial history even if
-- application code (or someone with a SQL prompt) tries to bypass the service layer,
-- plus trigram indexes for fast subscriber search.

-- ---------------------------------------------------------------------------
-- 1. Posted financial records and audit rows can never be deleted.
-- ---------------------------------------------------------------------------
CREATE FUNCTION bcis_forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are permanent financial/audit history and cannot be deleted. Use a reversal, void or adjustment.', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION bcis_forbid_delete();
--> statement-breakpoint
CREATE TRIGGER payment_allocations_no_delete BEFORE DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bcis_forbid_delete();
--> statement-breakpoint
CREATE TRIGGER payment_reversals_no_delete BEFORE DELETE ON payment_reversals FOR EACH ROW EXECUTE FUNCTION bcis_forbid_delete();
--> statement-breakpoint
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION bcis_forbid_delete();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION bcis_forbid_delete();
--> statement-breakpoint
CREATE TRIGGER adjustments_no_delete BEFORE DELETE ON adjustments FOR EACH ROW EXECUTE FUNCTION bcis_forbid_delete();
--> statement-breakpoint
CREATE TRIGGER collector_remittances_no_delete BEFORE DELETE ON collector_remittances FOR EACH ROW EXECUTE FUNCTION bcis_forbid_delete();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION bcis_forbid_delete();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Ledger entries, audit rows, reversals and adjustments are append-only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION bcis_forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are append-only and cannot be modified.', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION bcis_forbid_update();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION bcis_forbid_update();
--> statement-breakpoint
CREATE TRIGGER payment_reversals_no_update BEFORE UPDATE ON payment_reversals FOR EACH ROW EXECUTE FUNCTION bcis_forbid_update();
--> statement-breakpoint
CREATE TRIGGER adjustments_no_update BEFORE UPDATE ON adjustments FOR EACH ROW EXECUTE FUNCTION bcis_forbid_update();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. The facts of a posted payment are immutable; only its status and
--    unapplied (advance credit) amount may change, and REVERSED is final.
-- ---------------------------------------------------------------------------
CREATE FUNCTION bcis_guard_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subscriber_id IS DISTINCT FROM OLD.subscriber_id
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.reference_no IS DISTINCT FROM OLD.reference_no
     OR NEW.received_by IS DISTINCT FROM OLD.received_by THEN
    RAISE EXCEPTION 'A posted payment cannot be edited. Reverse it and post a correct payment instead.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'REVERSED' AND NEW.status <> 'REVERSED' THEN
    RAISE EXCEPTION 'A reversed payment cannot be re-posted.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payments_guard BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION bcis_guard_payment();
--> statement-breakpoint

CREATE FUNCTION bcis_guard_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.receipt_no IS DISTINCT FROM OLD.receipt_no OR NEW.payment_id IS DISTINCT FROM OLD.payment_id THEN
    RAISE EXCEPTION 'Receipt numbers are permanent and cannot be reassigned.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'VOID' AND NEW.status <> 'VOID' THEN
    RAISE EXCEPTION 'A voided receipt cannot be re-issued.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER receipts_guard BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION bcis_guard_receipt();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Finalized invoices are immutable except through payment allocation,
--    adjustment and void workflows (which only touch the running amounts).
-- ---------------------------------------------------------------------------
CREATE FUNCTION bcis_guard_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Finalized invoice % cannot be deleted. Void it instead.', OLD.invoice_no USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' THEN
    IF NEW.invoice_no IS DISTINCT FROM OLD.invoice_no
       OR NEW.subscriber_id IS DISTINCT FROM OLD.subscriber_id
       OR NEW.service_account_id IS DISTINCT FROM OLD.service_account_id
       OR NEW.billing_period IS DISTINCT FROM OLD.billing_period
       OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.discount_total IS DISTINCT FROM OLD.discount_total
       OR NEW.total IS DISTINCT FROM OLD.total THEN
      RAISE EXCEPTION 'Finalized invoice % is immutable. Use an adjustment or void.', OLD.invoice_no USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'DRAFT' OR (OLD.status = 'VOID' AND NEW.status <> 'VOID') THEN
      RAISE EXCEPTION 'Invalid invoice state change from % to %.', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION bcis_guard_invoice();
--> statement-breakpoint

CREATE FUNCTION bcis_guard_invoice_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status invoice_status;
BEGIN
  SELECT status INTO parent_status FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  -- parent_status is NULL only while a draft invoice is being discarded (cascade delete).
  IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Line items of a finalized invoice cannot be changed.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_items_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_items FOR EACH ROW EXECUTE FUNCTION bcis_guard_invoice_item();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Fast "contains" search across 20,000+ subscribers.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX subscribers_name_trgm_idx ON subscribers USING gin (full_name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX subscribers_phone_trgm_idx ON subscribers USING gin (phone gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX subscriber_addresses_trgm_idx ON subscriber_addresses USING gin ((line1 || ' ' || barangay || ' ' || city) gin_trgm_ops);
