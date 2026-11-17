CREATE TABLE "customers" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customers_name_check" CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  CONSTRAINT "customers_phone_check" CHECK (phone ~ '^\+?[0-9]{7,15}$'),
  CONSTRAINT "customers_email_check" CHECK (email IS NULL OR (length(email) BETWEEN 3 AND 254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  CONSTRAINT "customers_notes_check" CHECK (length(notes) <= 500)
);
CREATE UNIQUE INDEX "customers_tenant_id_id_key" ON "customers"("tenant_id", "id");
CREATE UNIQUE INDEX "customers_tenant_id_phone_key" ON "customers"("tenant_id", "phone");
CREATE INDEX "customers_tenant_id_name_idx" ON "customers"("tenant_id", "name");
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales" ADD COLUMN "customer_id" UUID;
ALTER TABLE "held_carts" ADD COLUMN "customer_id" UUID;
CREATE INDEX "sales_tenant_id_customer_id_status_created_at_idx" ON "sales"("tenant_id", "customer_id", "status", "created_at");
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "held_carts" ADD CONSTRAINT "held_carts_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Upgrade owners and exact default managers only; preserve customized manager/other roles.
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['crm.read','crm.customers.write'])) WHERE code = 'owner';
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['crm.read','crm.customers.write']))
WHERE code = 'manager'
AND permissions @> ARRAY['finance.read','finance.entries.write','finance.void','organization.read','catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold','pos.read','pos.checkout','pos.edc.confirm','pos.hold','inventory.adjust','inventory.receive','inventory.transfer.send','inventory.transfer.receive','purchasing.read','purchasing.suppliers.write','purchasing.orders.write','purchasing.orders.order','purchasing.orders.cancel','purchasing.receive']::text[]
AND permissions <@ ARRAY['finance.read','finance.entries.write','finance.void','organization.read','catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold','pos.read','pos.checkout','pos.edc.confirm','pos.hold','inventory.adjust','inventory.receive','inventory.transfer.send','inventory.transfer.receive','purchasing.read','purchasing.suppliers.write','purchasing.orders.write','purchasing.orders.order','purchasing.orders.cancel','purchasing.receive']::text[];
