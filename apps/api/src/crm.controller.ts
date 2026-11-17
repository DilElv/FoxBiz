import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthenticatedRequest } from './auth.types';
import { CreateCustomerDto, UpdateCustomerDto } from './crm.dto';
import { CrmService } from './crm.service';
import { PermissionGuard, RequirePermission } from './permissions';

@Controller('crm/customers')
@UseGuards(AuthGuard, PermissionGuard)
export class CrmController {
  constructor(private readonly crm: CrmService) {}
  @Get() @RequirePermission('crm.read') list(@Req() req: AuthenticatedRequest, @Query('search') search?: string, @Query('segment') segment?: string, @Query('page') page?: string) { return this.crm.list(req.user!, search, segment, page); }
  @Post() @RequirePermission('crm.customers.write') create(@Req() req: AuthenticatedRequest, @Body() dto: CreateCustomerDto) { return this.crm.create(req.user!, dto); }
  @Get(':id') @RequirePermission('crm.read') get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.crm.get(req.user!, id); }
  @Patch(':id') @RequirePermission('crm.customers.write') update(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) { return this.crm.update(req.user!, id, dto); }
  @Get(':id/sales') @RequirePermission('crm.read') sales(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Query('page') page?: string) { return this.crm.sales(req.user!, id, page); }
}
