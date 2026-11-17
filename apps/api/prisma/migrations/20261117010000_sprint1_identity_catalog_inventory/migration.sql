-- Additive Sprint 1 migration. Existing users receive no permissions until explicitly assigned.
ALTER TABLE "outlets" ADD COLUMN "address" TEXT NOT NULL DEFAULT '';
ALTER TABLE "products" ADD COLUMN "category_id" UUID, ADD COLUMN "unit" TEXT NOT NULL DEFAULT 'pcs', ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "tenants" ADD COLUMN "address" TEXT NOT NULL DEFAULT '', ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'IDR', ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta';
ALTER TABLE "users" ADD COLUMN "all_outlets" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "role_id" UUID;
CREATE TABLE "roles" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "name" TEXT NOT NULL, "code" TEXT NOT NULL, "permissions" TEXT[] NOT NULL DEFAULT '{}'
);
CREATE TABLE "user_outlets" (
 "tenant_id" UUID NOT NULL, "user_id" UUID NOT NULL, "outlet_id" UUID NOT NULL, PRIMARY KEY ("tenant_id", "user_id", "outlet_id")
);
CREATE TABLE "categories" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "name" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE "stock_balances" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "outlet_id" UUID NOT NULL, "product_id" UUID NOT NULL,
 "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0 CHECK ("quantity" >= 0),
 "low_stock_threshold" DECIMAL(14,3) NOT NULL DEFAULT 0 CHECK ("low_stock_threshold" >= 0),
 "opened_at" TIMESTAMP(3), "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "stock_movements" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "outlet_id" UUID NOT NULL, "product_id" UUID NOT NULL,
 "quantity" DECIMAL(14,3) NOT NULL, "movement_type" TEXT NOT NULL, "reference" TEXT NOT NULL,
 "created_by" UUID NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "audit_logs" (
 "id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "actor_user_id" UUID NOT NULL, "action" TEXT NOT NULL,
 "entity_type" TEXT NOT NULL, "entity_id" TEXT NOT NULL, "before_data" JSONB, "after_data" JSONB,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "roles_tenant_id_id_key" ON "roles"("tenant_id", "id");
CREATE UNIQUE INDEX "roles_tenant_id_code_key" ON "roles"("tenant_id", "code");
CREATE UNIQUE INDEX "roles_tenant_id_name_key" ON "roles"("tenant_id", "name");
CREATE UNIQUE INDEX "categories_tenant_id_id_key" ON "categories"("tenant_id", "id");
CREATE UNIQUE INDEX "categories_tenant_id_name_key" ON "categories"("tenant_id", "name");
CREATE UNIQUE INDEX "outlets_tenant_id_id_key" ON "outlets"("tenant_id", "id");
CREATE UNIQUE INDEX "products_tenant_id_id_key" ON "products"("tenant_id", "id");
CREATE UNIQUE INDEX "products_tenant_id_barcode_key" ON "products"("tenant_id", "barcode");
CREATE UNIQUE INDEX "users_tenant_id_id_key" ON "users"("tenant_id", "id");
CREATE UNIQUE INDEX "stock_balances_tenant_id_outlet_id_product_id_key" ON "stock_balances"("tenant_id", "outlet_id", "product_id");
CREATE INDEX "stock_balances_tenant_id_outlet_id_idx" ON "stock_balances"("tenant_id", "outlet_id");
CREATE UNIQUE INDEX "stock_movements_tenant_id_outlet_id_product_id_reference_key" ON "stock_movements"("tenant_id", "outlet_id", "product_id", "reference");
CREATE INDEX "stock_movements_tenant_id_outlet_id_created_at_idx" ON "stock_movements"("tenant_id", "outlet_id", "created_at");
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "categories"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_outlets" ADD CONSTRAINT "user_outlets_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_outlets" ADD CONSTRAINT "user_outlets_tenant_id_outlet_id_fkey" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_outlet_id_fkey" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_outlet_id_fkey" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Defense in depth for ledger authors; these constraints are intentionally maintained in SQL.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_tenant_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_tenant_fkey" FOREIGN KEY ("tenant_id", "actor_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT;
