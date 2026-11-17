-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "after_quantity" DECIMAL(14,3),
ADD COLUMN     "before_quantity" DECIMAL(14,3),
ADD COLUMN     "note" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "stock_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "destination_outlet_id" UUID,
    "created_by" UUID NOT NULL,
    "received_by" UUID,
    "idempotency_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "external_reference" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMP(3),

    CONSTRAINT "stock_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_document_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "stock_document_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_documents_tenant_id_outlet_id_created_at_idx" ON "stock_documents"("tenant_id", "outlet_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_documents_tenant_id_destination_outlet_id_status_idx" ON "stock_documents"("tenant_id", "destination_outlet_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_documents_tenant_id_id_key" ON "stock_documents"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_documents_tenant_id_idempotency_key_key" ON "stock_documents"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "stock_document_items_tenant_id_document_id_product_id_key" ON "stock_document_items"("tenant_id", "document_id", "product_id");

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_tenant_id_outlet_id_fkey" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_tenant_id_destination_outlet_id_fkey" FOREIGN KEY ("tenant_id", "destination_outlet_id") REFERENCES "outlets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_tenant_id_received_by_fkey" FOREIGN KEY ("tenant_id", "received_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_document_items" ADD CONSTRAINT "stock_document_items_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "stock_documents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_document_items" ADD CONSTRAINT "stock_document_items_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sprint 3 invariants. Simple receiving is independent from purchasing/PO.
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_valid_state" CHECK (
  kind IN ('adjustment', 'receiving', 'transfer')
  AND status IN ('posted', 'sent', 'received')
  AND char_length(note) BETWEEN 3 AND 200
  AND char_length(external_reference) <= 100
  AND (
    (kind IN ('adjustment', 'receiving') AND status = 'posted'
      AND destination_outlet_id IS NULL AND received_by IS NULL AND received_at IS NULL)
    OR
    (kind = 'transfer' AND destination_outlet_id IS NOT NULL AND destination_outlet_id <> outlet_id
      AND ((status = 'sent' AND received_by IS NULL AND received_at IS NULL)
        OR (status = 'received' AND received_by IS NOT NULL AND received_at IS NOT NULL)))
  )
);
ALTER TABLE "stock_document_items" ADD CONSTRAINT "stock_document_items_nonzero_quantity" CHECK (quantity <> 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_valid_snapshot" CHECK (
  (before_quantity IS NULL AND after_quantity IS NULL)
  OR (before_quantity IS NOT NULL AND after_quantity IS NOT NULL AND before_quantity >= 0 AND after_quantity = before_quantity + quantity)
);

-- Protected owners always receive new permissions. Upgrade only unchanged manager
-- and inventory role definitions, preserving customized role permissions.
UPDATE roles SET permissions = permissions || ARRAY['inventory.adjust','inventory.receive','inventory.transfer.send','inventory.transfer.receive']::text[]
WHERE code = 'owner';
UPDATE roles SET permissions = permissions || ARRAY['inventory.adjust','inventory.receive','inventory.transfer.send','inventory.transfer.receive']::text[]
WHERE code = 'manager' AND (
  (permissions @> ARRAY['organization.read','catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold','pos.read']::text[]
   AND permissions <@ ARRAY['organization.read','catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold','pos.read']::text[])
  OR
  (permissions @> ARRAY['organization.read','catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold','pos.read','pos.checkout','pos.edc.confirm','pos.hold']::text[]
   AND permissions <@ ARRAY['organization.read','catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold','pos.read','pos.checkout','pos.edc.confirm','pos.hold']::text[])
);
UPDATE roles SET permissions = permissions || ARRAY['inventory.adjust','inventory.receive','inventory.transfer.send','inventory.transfer.receive']::text[]
WHERE code = 'inventory'
  AND permissions @> ARRAY['catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold']::text[]
  AND permissions <@ ARRAY['catalog.read','catalog.write','inventory.read','inventory.opening','inventory.threshold']::text[];

