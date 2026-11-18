import { Controller, Get, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthenticatedRequest } from './auth.types';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get() summary(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outletId: string, @Query('period') period?: string) {
    return this.dashboard.summary(req.user!, outletId, period);
  }
}
