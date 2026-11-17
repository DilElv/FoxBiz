CREATE TABLE "finance_entries" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "outlet_id" UUID NOT NULL,
  "created_by" UUID NOT NULL, "idempotency_key" UUID NOT NULL, "request_hash" TEXT NOT NULL,
  "kind" TEXT NOT NULL, "category" TEXT NOT NULL, "amount" DECIMAL(14,2) NOT NULL,
  "business_date" DATE NOT NULL, "note" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'posted',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voided_at" TIMESTAMP(3), "voided_by" UUID, "void_reason" TEXT,
  CONSTRAINT "finance_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "finance_entries_amount_check" CHECK (amount > 0),
  CONSTRAINT "finance_entries_note_check" CHECK (length(btrim(note)) BETWEEN 3 AND 200),
  CONSTRAINT "finance_entries_category_check" CHECK (
    (kind = 'income' AND category IN ('owner_funding', 'other_income')) OR
    (kind = 'expense' AND category IN ('operational', 'utilities', 'supplies', 'transport', 'other_expense'))),
  CONSTRAINT "finance_entries_status_check" CHECK (
    (status = 'posted' AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR
    (status = 'voided' AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND length(btrim(void_reason)) BETWEEN 3 AND 200))
);
CREATE INDEX "finance_entries_tenant_id_outlet_id_business_date_status_idx" ON "finance_entries"("tenant_id", "outlet_id", "business_date", "status");
CREATE UNIQUE INDEX "finance_entries_tenant_id_id_key" ON "finance_entries"("tenant_id", "id");
CREATE UNIQUE INDEX "finance_entries_tenant_id_idempotency_key_key" ON "finance_entries"("tenant_id", "idempotency_key");
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_tenant_id_outlet_id_fkey" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_tenant_id_voided_by_fkey" FOREIGN KEY ("tenant_id", "voided_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Upgrade owners and exact default managers only; preserve customized manager/other roles.
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['finance.read','finance.entries.write','finance.void'])) WHERE code = 'owner';
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['finance.read','finance.entries.write','finance.void']))
WHERE code = 'manager'
AND permissions @> ARRAY['organization.read','catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold','pos.read','pos.checkout','pos.edc.confirm','pos.hold','inventory.adjust','inventory.receive','inventory.transfer.send','inventory.transfer.receive','purchasing.read','purchasing.suppliers.write','purchasing.orders.write','purchasing.orders.order','purchasing.orders.cancel','purchasing.receive']::text[]
AND permissions <@ ARRAY['organization.read','catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold','pos.read','pos.checkout','pos.edc.confirm','pos.hold','inventory.adjust','inventory.receive','inventory.transfer.send','inventory.transfer.receive','purchasing.read','purchasing.suppliers.write','purchasing.orders.write','purchasing.orders.order','purchasing.orders.cancel','purchasing.receive']::text[];
