import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthenticatedRequest } from './auth.types';
import { PermissionGuard, RequirePermission } from './permissions';
import { GoodsReceiptDto, PurchaseActionDto, PurchaseOrderDto, SupplierDto, UpdatePurchaseOrderDto } from './purchasing.dto';
import { PurchasingService } from './purchasing.service';

@Controller()
@UseGuards(AuthGuard, PermissionGuard)
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}
  @Get('suppliers') @RequirePermission('purchasing.read') suppliers(@Req() req: AuthenticatedRequest, @Query('search') search?: string, @Query('page') page?: string, @Query('status') status?: string) { return this.purchasing.suppliers(req.user!, search, page, status); }
  @Post('suppliers') @RequirePermission('purchasing.suppliers.write') createSupplier(@Req() req: AuthenticatedRequest, @Body() dto: SupplierDto) { return this.purchasing.saveSupplier(req.user!, dto); }
  @Patch('suppliers/:id') @RequirePermission('purchasing.suppliers.write') updateSupplier(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupplierDto) { return this.purchasing.saveSupplier(req.user!, dto, id); }
  @Get('purchasing/products') @RequirePermission('purchasing.read') products(@Req() req: AuthenticatedRequest, @Query('search') search?: string, @Query('page') page?: string) { return this.purchasing.products(req.user!, search, page); }
  @Get('purchase-orders') @RequirePermission('purchasing.read') orders(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outletId: string, @Query('page') page?: string, @Query('status') status?: string) { return this.purchasing.orders(req.user!, outletId, page, status); }
  @Get('purchase-orders/by-key/:key') @RequirePermission('purchasing.read') orderByKey(@Req() req: AuthenticatedRequest, @Param('key', ParseUUIDPipe) key: string, @Query('outletId', ParseUUIDPipe) outletId: string) { return this.purchasing.orderByKey(req.user!, key, outletId); }
  @Get('purchase-orders/:id') @RequirePermission('purchasing.read') detail(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Query('outletId', ParseUUIDPipe) outletId: string) { return this.purchasing.detail(req.user!, id, outletId); }
  @Post('purchase-orders') @RequirePermission('purchasing.orders.write') createOrder(@Req() req: AuthenticatedRequest, @Body() dto: PurchaseOrderDto) { return this.purchasing.createOrder(req.user!, dto); }
  @Patch('purchase-orders/:id') @RequirePermission('purchasing.orders.write') updateOrder(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePurchaseOrderDto) { return this.purchasing.updateOrder(req.user!, id, dto); }
  @Post('purchase-orders/:id/order') @RequirePermission('purchasing.orders.order') order(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PurchaseActionDto) { return this.purchasing.action(req.user!, id, 'order', dto); }
  @Post('purchase-orders/:id/cancel') @RequirePermission('purchasing.orders.cancel') cancel(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PurchaseActionDto) { return this.purchasing.action(req.user!, id, 'cancel', dto); }
  @Get('goods-receipts') @RequirePermission('purchasing.read') receipts(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outletId: string, @Query('page') page?: string) { return this.purchasing.receipts(req.user!, outletId, page); }
  @Get('goods-receipts/by-key/:key') @RequirePermission('purchasing.read') receiptByKey(@Req() req: AuthenticatedRequest, @Param('key', ParseUUIDPipe) key: string, @Query('outletId', ParseUUIDPipe) outletId: string) { return this.purchasing.receiptByKey(req.user!, key, outletId); }
  @Post('goods-receipts') @RequirePermission('purchasing.receive') receive(@Req() req: AuthenticatedRequest, @Body() dto: GoodsReceiptDto) { return this.purchasing.receive(req.user!, dto); }
}
