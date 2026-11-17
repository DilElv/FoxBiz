import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { PermissionGuard, RequirePermission } from './permissions';
import { AuthenticatedRequest } from './auth.types';
import { PosService } from './pos.service';
import { CartDto, CheckoutDto, HoldDto } from './pos.dto';

@Controller()
@UseGuards(AuthGuard, PermissionGuard)
export class PosController {
  constructor(private readonly pos: PosService) {}
  @Get('pos/categories') @RequirePermission('pos.read') categories(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outlet: string) { return this.pos.categories(req.user!, outlet); }
  @Get('pos/products') @RequirePermission('pos.read') products(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outlet: string, @Query('search') search?: string, @Query('page') page?: string, @Query('categoryId', new ParseUUIDPipe({ optional: true })) category?: string) { return this.pos.products(req.user!, outlet, search, page, category); }
  @Get('pos/customers') @RequirePermission('pos.read') customers(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outlet: string, @Query('search') search?: string) { return this.pos.customers(req.user!, outlet, search); }
  @Post('pos/quote') @RequirePermission('pos.read') quote(@Req() req: AuthenticatedRequest, @Body() dto: CartDto) { return this.pos.quote(req.user!, dto); }
  @Post('sales') @RequirePermission('pos.checkout') checkout(@Req() req: AuthenticatedRequest, @Body() dto: CheckoutDto) { return this.pos.checkout(req.user!, dto); }
  @Get('sales') @RequirePermission('pos.read') sales(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outlet: string, @Query('page') page?: string) { return this.pos.sales(req.user!, outlet, page); }
  @Get('sales/by-key/:key') @RequirePermission('pos.read') byKey(@Req() req: AuthenticatedRequest, @Param('key', ParseUUIDPipe) key: string, @Query('outletId', ParseUUIDPipe) outlet: string) { return this.pos.byKey(req.user!, key, outlet); }
  @Get('sales/:id') @RequirePermission('pos.read') receipt(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.pos.receipt(req.user!, id); }
  @Get('pos/holds') @RequirePermission('pos.hold') holds(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outlet: string) { return this.pos.holds(req.user!, outlet); }
  @Post('pos/holds') @RequirePermission('pos.hold') hold(@Req() req: AuthenticatedRequest, @Body() dto: HoldDto) { return this.pos.hold(req.user!, dto); }
  @Get('pos/holds/:id') @RequirePermission('pos.hold') resume(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.pos.resume(req.user!, id); }
}
