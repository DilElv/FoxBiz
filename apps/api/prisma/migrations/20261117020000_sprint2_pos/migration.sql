-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "cashier_id" UUID NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "receipt_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "tendered" DECIMAL(14,2) NOT NULL,
    "change" DECIMAL(14,2) NOT NULL,
    "manual_confirmed_by" UUID,
    "confirmed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "held_carts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "cashier_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'held',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "held_carts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_tenant_id_outlet_id_created_at_idx" ON "sales"("tenant_id", "outlet_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenant_id_id_key" ON "sales"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenant_id_receipt_no_key" ON "sales"("tenant_id", "receipt_no");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenant_id_idempotency_key_key" ON "sales"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_tenant_id_sale_id_product_id_key" ON "sale_items"("tenant_id", "sale_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_sale_id_key" ON "payments"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_sale_id_key" ON "payments"("tenant_id", "sale_id");

-- CreateIndex
CREATE INDEX "held_carts_tenant_id_outlet_id_cashier_id_status_idx" ON "held_carts"("tenant_id", "outlet_id", "cashier_id", "status");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_outlet_id_fkey" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_cashier_id_fkey" FOREIGN KEY ("tenant_id", "cashier_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_tenant_id_sale_id_fkey" FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sales"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_sale_id_fkey" FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sales"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_carts" ADD CONSTRAINT "held_carts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_carts" ADD CONSTRAINT "held_carts_tenant_id_outlet_id_fkey" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_carts" ADD CONSTRAINT "held_carts_tenant_id_cashier_id_fkey" FOREIGN KEY ("tenant_id", "cashier_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sprint 2 invariants. Discount/tax configuration and unpaid sales are later work.
ALTER TABLE sales ADD CONSTRAINT sales_paid_totals CHECK
  (status = 'paid' AND subtotal >= 0 AND discount = 0 AND tax = 0 AND total = subtotal);
ALTER TABLE sale_items ADD CONSTRAINT sale_items_positive_quantity CHECK
  (quantity > 0 AND unit_price >= 0 AND line_total = round(quantity * unit_price, 2));
ALTER TABLE payments ADD CONSTRAINT payments_valid_confirmation CHECK
  (amount >= 0 AND tendered >= amount AND change = tendered - amount AND
   ((method = 'cash' AND status = 'received' AND manual_confirmed_by IS NULL) OR
    (method = 'edc' AND status = 'manually_confirmed' AND manual_confirmed_by IS NOT NULL AND change = 0)));
ALTER TABLE held_carts ADD CONSTRAINT held_carts_valid_state CHECK
  (status IN ('held', 'completed') AND version > 0 AND jsonb_typeof(items) = 'array');

-- Protected owners always receive new permissions. Upgrade only unchanged stock
-- manager/cashier definitions, preserving customized role permissions.
UPDATE roles SET permissions = permissions || ARRAY['pos.checkout','pos.edc.confirm','pos.hold']::text[]
WHERE code = 'owner';
UPDATE roles SET permissions = permissions || ARRAY['pos.checkout','pos.edc.confirm','pos.hold']::text[]
WHERE (code = 'cashier' AND permissions @> ARRAY['catalog.read','inventory.read','pos.read']::text[]
       AND permissions <@ ARRAY['catalog.read','inventory.read','pos.read']::text[])
   OR (code = 'manager' AND permissions @> ARRAY['organization.read','catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold','pos.read']::text[]
       AND permissions <@ ARRAY['organization.read','catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold','pos.read']::text[]);
