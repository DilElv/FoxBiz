import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthenticatedRequest } from './auth.types';
import { PermissionGuard, RequirePermission } from './permissions';
import { FinanceEntryDto, VoidFinanceDto } from './finance.dto';
import { FinanceService } from './finance.service';

@Controller('finance')
@UseGuards(AuthGuard, PermissionGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}
  @Get('metadata') @RequirePermission('finance.read') metadata(@Req() req: AuthenticatedRequest) { return this.finance.metadata(req.user!); }
  @Get('report') @RequirePermission('finance.read') report(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outletId: string, @Query('from') from?: string, @Query('to') to?: string) { return this.finance.report(req.user!, outletId, from, to); }
  @Get('entries') @RequirePermission('finance.read') entries(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outletId: string, @Query('from') from?: string, @Query('to') to?: string, @Query('page') page?: string, @Query('kind') kind?: string, @Query('status') status?: string) { return this.finance.entries(req.user!, outletId, from, to, page, kind, status); }
  @Get('entries/by-key/:key') @RequirePermission('finance.read') byKey(@Req() req: AuthenticatedRequest, @Param('key', ParseUUIDPipe) key: string, @Query('outletId', ParseUUIDPipe) outletId: string) { return this.finance.byKey(req.user!, key, outletId); }
  @Post('entries') @RequirePermission('finance.entries.write') create(@Req() req: AuthenticatedRequest, @Body() dto: FinanceEntryDto) { return this.finance.create(req.user!, dto); }
  @Post('entries/:id/void') @RequirePermission('finance.void') void(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidFinanceDto) { return this.finance.void(req.user!, id, dto); }
}
