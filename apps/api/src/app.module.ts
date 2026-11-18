import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';
import { resolve } from 'node:path';
import { validateEnvironment } from './environment';
import { AuthGuard } from './auth.guard';
import { PermissionGuard } from './permissions';
import { Sprint1Controller } from './sprint1.controller';
import { IdentityService } from './identity.service';
import { OrganizationService } from './organization.service';
import { CatalogService } from './catalog.service';
import { InventoryService } from './inventory.service';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { HrisController } from './hris.controller';
import { HrisService } from './hris.service';
import { AttendancePhotoService } from './attendance-photo.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, envFilePath: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')], validate: validateEnvironment })],
  controllers: [HealthController, AuthController, Sprint1Controller, PosController, StockController, PurchasingController, FinanceController, CrmController, HrisController, DashboardController],
  providers: [PrismaService, AuthService, AuthGuard, PermissionGuard, IdentityService, OrganizationService, CatalogService, InventoryService, PosService, StockService, PurchasingService, FinanceService, CrmService, HrisService, AttendancePhotoService, DashboardService],
})
export class AppModule {}
