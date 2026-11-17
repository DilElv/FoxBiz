import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthenticatedRequest } from './auth.types';
import { PermissionGuard, RequirePermission } from './permissions';
import { StockDocumentDto } from './stock.dto';
import { StockService } from './stock.service';

@Controller('inventory')
@UseGuards(AuthGuard, PermissionGuard)
export class StockController {
  constructor(private readonly stock: StockService) {}
  @Get('destinations') @RequirePermission('inventory.transfer.send') destinations(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outletId: string) { return this.stock.destinations(req.user!, outletId); }
  @Get('documents') @RequirePermission('inventory.read') list(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outletId: string, @Query('page') page?: string, @Query('kind') kind?: string, @Query('status') status?: string) { return this.stock.list(req.user!, outletId, page, kind, status); }
  @Get('documents/by-key/:key') @RequirePermission('inventory.read') byKey(@Req() req: AuthenticatedRequest, @Param('key', ParseUUIDPipe) key: string, @Query('outletId', ParseUUIDPipe) outletId: string) { return this.stock.byKey(req.user!, key, outletId); }
  @Get('documents/:id') @RequirePermission('inventory.read') detail(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Query('outletId', ParseUUIDPipe) outletId: string) { return this.stock.detail(req.user!, id, outletId); }
  @Post('documents') @RequirePermission('inventory.read') create(@Req() req: AuthenticatedRequest, @Body() dto: StockDocumentDto) { return this.stock.create(req.user!, dto); }
  @Post('documents/:id/receive') @RequirePermission('inventory.transfer.receive') receive(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.stock.receive(req.user!, id); }
}
