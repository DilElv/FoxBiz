-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "pin_hash" TEXT,
    "all_outlets" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_outlets" (
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,

    CONSTRAINT "employee_outlets_pkey" PRIMARY KEY ("tenant_id","employee_id","outlet_id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "work_date" VARCHAR(10) NOT NULL,
    "clock_in_at" TIMESTAMP(3) NOT NULL,
    "clock_out_at" TIMESTAMP(3),
    "clock_in_photo" TEXT,
    "clock_out_photo" TEXT,
    "clock_in_photo_hash" TEXT,
    "clock_out_photo_hash" TEXT,
    "clock_in_latitude" DOUBLE PRECISION,
    "clock_in_longitude" DOUBLE PRECISION,
    "clock_in_accuracy" DOUBLE PRECISION,
    "clock_out_latitude" DOUBLE PRECISION,
    "clock_out_longitude" DOUBLE PRECISION,
    "clock_out_accuracy" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'kiosk',
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employees_tenant_id_status_name_idx" ON "employees"("tenant_id", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_id_key" ON "employees"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_code_key" ON "employees"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "attendances_tenant_id_outlet_id_work_date_idx" ON "attendances"("tenant_id", "outlet_id", "work_date");

-- CreateIndex
CREATE INDEX "attendances_tenant_id_employee_id_clock_out_at_idx" ON "attendances"("tenant_id", "employee_id", "clock_out_at");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_tenant_id_employee_id_work_date_key" ON "attendances"("tenant_id", "employee_id", "work_date");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_outlets" ADD CONSTRAINT "employee_outlets_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_outlets" ADD CONSTRAINT "employee_outlets_tenant_id_outlet_id_fkey" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenant_id_outlet_id_fkey" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill HRIS permissions for existing tenants.
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['hris.read','hris.employees.write','hris.attendance.kiosk','hris.attendance.manage']::text[])) WHERE "code" = 'owner';
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['hris.read','hris.employees.write','hris.attendance.kiosk','hris.attendance.manage']::text[])) WHERE "code" = 'manager';
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['hris.read','hris.employees.write','hris.attendance.kiosk','hris.attendance.manage']::text[])) WHERE "code" = 'hr';
INSERT INTO "roles" ("id", "tenant_id", "name", "code", "permissions")
SELECT gen_random_uuid(), "id", 'HR Staff', 'hr', ARRAY['hris.read','hris.employees.write','hris.attendance.kiosk','hris.attendance.manage']::text[]
FROM "tenants" t
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."tenant_id" = t."id" AND r."code" = 'hr');
