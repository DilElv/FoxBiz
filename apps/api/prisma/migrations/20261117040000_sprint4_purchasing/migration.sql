-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "po_no" TEXT NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT NOT NULL DEFAULT '',
    "cancel_reason" TEXT,
    "total" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ordered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "qty_ordered" DECIMAL(14,3) NOT NULL,
    "qty_received" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "stock_document_id" UUID NOT NULL,
    "received_by" UUID NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "note" TEXT NOT NULL,
    "external_reference" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty_received" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_tenant_id_status_name_idx" ON "suppliers"("tenant_id", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_id_key" ON "suppliers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_name_key" ON "suppliers"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_outlet_id_created_at_idx" ON "purchase_orders"("tenant_id", "outlet_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_id_key" ON "purchase_orders"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_po_no_key" ON "purchase_orders"("tenant_id", "po_no");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_idempotency_key_key" ON "purchase_orders"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_tenant_id_purchase_order_id_product_id_key" ON "purchase_order_items"("tenant_id", "purchase_order_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_stock_document_id_key" ON "goods_receipts"("stock_document_id");

-- CreateIndex
CREATE INDEX "goods_receipts_tenant_id_purchase_order_id_received_at_idx" ON "goods_receipts"("tenant_id", "purchase_order_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenant_id_id_key" ON "goods_receipts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenant_id_idempotency_key_key" ON "goods_receipts"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenant_id_stock_document_id_key" ON "goods_receipts"("tenant_id", "stock_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenant_id_id_purchase_order_id_key" ON "goods_receipts"("tenant_id", "id", "purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_items_tenant_id_goods_receipt_id_product_id_key" ON "goods_receipt_items"("tenant_id", "goods_receipt_id", "product_id");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_outlet_id_fkey" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "suppliers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tenant_id_purchase_order_id_fkey" FOREIGN KEY ("tenant_id", "purchase_order_id") REFERENCES "purchase_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_purchase_order_id_fkey" FOREIGN KEY ("tenant_id", "purchase_order_id") REFERENCES "purchase_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_stock_document_id_fkey" FOREIGN KEY ("tenant_id", "stock_document_id") REFERENCES "stock_documents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_received_by_fkey" FOREIGN KEY ("tenant_id", "received_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_tenant_id_goods_receipt_id_purchase_or_fkey" FOREIGN KEY ("tenant_id", "goods_receipt_id", "purchase_order_id") REFERENCES "goods_receipts"("tenant_id", "id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_tenant_id_purchase_order_id_product_id_fkey" FOREIGN KEY ("tenant_id", "purchase_order_id", "product_id") REFERENCES "purchase_order_items"("tenant_id", "purchase_order_id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Purchasing invariants; existing manual receiving remains independent.
ALTER TABLE suppliers ADD CONSTRAINT suppliers_valid CHECK (char_length(btrim(name)) BETWEEN 1 AND 120 AND char_length(contact) <= 200 AND status IN ('active','inactive'));
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_valid CHECK (
  status IN ('draft','ordered','partially_received','received','cancelled') AND total >= 0 AND version > 0 AND char_length(note) <= 200
  AND ((status = 'draft' AND ordered_at IS NULL AND cancelled_at IS NULL AND cancel_reason IS NULL)
    OR (status IN ('ordered','partially_received','received') AND ordered_at IS NOT NULL AND cancelled_at IS NULL AND cancel_reason IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND char_length(btrim(cancel_reason)) BETWEEN 3 AND 200 AND cancel_reason IS NOT NULL))
);
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_valid CHECK (qty_ordered > 0 AND qty_received >= 0 AND qty_received <= qty_ordered AND unit_cost >= 0 AND line_total = round(qty_ordered * unit_cost, 2));
ALTER TABLE goods_receipts ADD CONSTRAINT goods_receipts_valid CHECK (status = 'posted' AND char_length(btrim(note)) BETWEEN 3 AND 200 AND char_length(external_reference) <= 100);
ALTER TABLE goods_receipt_items ADD CONSTRAINT goods_receipt_items_positive CHECK (qty_received > 0);

-- Owners receive all purchasing permissions. Only unchanged Sprint 3 defaults
-- are upgraded automatically; customized roles keep their existing permissions.
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['purchasing.read','purchasing.suppliers.write','purchasing.orders.write','purchasing.orders.order','purchasing.orders.cancel','purchasing.receive']::text[])) WHERE code = 'owner';
UPDATE roles SET permissions = permissions || ARRAY['purchasing.read','purchasing.suppliers.write','purchasing.orders.write','purchasing.orders.order','purchasing.orders.cancel','purchasing.receive']::text[]
WHERE code = 'manager'
  AND permissions @> ARRAY['organization.read','catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold','pos.read','pos.checkout','pos.edc.confirm','pos.hold','inventory.adjust','inventory.receive','inventory.transfer.send','inventory.transfer.receive']::text[]
  AND permissions <@ ARRAY['organization.read','catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold','pos.read','pos.checkout','pos.edc.confirm','pos.hold','inventory.adjust','inventory.receive','inventory.transfer.send','inventory.transfer.receive']::text[];
UPDATE roles SET permissions = permissions || ARRAY['purchasing.read','purchasing.receive']::text[]
WHERE code = 'inventory'
  AND permissions @> ARRAY['catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold','inventory.adjust','inventory.receive','inventory.transfer.send','inventory.transfer.receive']::text[]
  AND permissions <@ ARRAY['catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold','inventory.adjust','inventory.receive','inventory.transfer.send','inventory.transfer.receive']::text[];
