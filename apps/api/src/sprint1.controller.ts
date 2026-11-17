import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { PermissionGuard, RequirePermission } from './permissions';
import { AuthenticatedRequest } from './auth.types';
import { IdentityService } from './identity.service';
import { OrganizationService } from './organization.service';
import { CatalogService } from './catalog.service';
import { InventoryService } from './inventory.service';
import { CategoryDto, OpeningStockDto, OrganizationDto, OutletDto, ProductDto, RoleDto, ThresholdDto, UserDto } from './sprint1.dto';

@Controller()
@UseGuards(AuthGuard, PermissionGuard)
export class Sprint1Controller {
  constructor(private readonly identity: IdentityService, private readonly organization: OrganizationService, private readonly catalog: CatalogService, private readonly inventory: InventoryService) {}
  @Get('organization') @RequirePermission('organization.read') profile(@Req() req: AuthenticatedRequest) { return this.organization.profile(req.user!); }
  @Patch('organization') @RequirePermission('organization.write') saveProfile(@Req() req: AuthenticatedRequest, @Body() dto: OrganizationDto) { return this.organization.saveProfile(req.user!, dto); }
  @Get('outlets') @RequirePermission('organization.read') outlets(@Req() req: AuthenticatedRequest) { return this.organization.outlets(req.user!); }
  @Post('outlets') @RequirePermission('organization.write') createOutlet(@Req() req: AuthenticatedRequest, @Body() dto: OutletDto) { return this.organization.saveOutlet(req.user!, dto); }
  @Patch('outlets/:id') @RequirePermission('organization.write') updateOutlet(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OutletDto) { return this.organization.saveOutlet(req.user!, dto, id); }
  @Get('roles') @RequirePermission('roles.read') roles(@Req() req: AuthenticatedRequest) { return this.identity.roles(req.user!); }
  @Get('permissions') @RequirePermission('roles.read') permissions() { return this.identity.permissions(); }
  @Post('roles') @RequirePermission('roles.write') createRole(@Req() req: AuthenticatedRequest, @Body() dto: RoleDto) { return this.identity.saveRole(req.user!, dto); }
  @Patch('roles/:id') @RequirePermission('roles.write') updateRole(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleDto) { return this.identity.saveRole(req.user!, dto, id); }
  @Get('users') @RequirePermission('users.read') users(@Req() req: AuthenticatedRequest, @Query('page') page?: string) { return this.identity.users(req.user!, page); }
  @Post('users') @RequirePermission('users.write') createUser(@Req() req: AuthenticatedRequest, @Body() dto: UserDto) { return this.identity.saveUser(req.user!, dto); }
  @Patch('users/:id') @RequirePermission('users.write') updateUser(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UserDto) { return this.identity.saveUser(req.user!, dto, id); }
  @Get('categories') @RequirePermission('catalog.read') categories(@Req() req: AuthenticatedRequest) { return this.catalog.categories(req.user!); }
  @Post('categories') @RequirePermission('catalog.write') createCategory(@Req() req: AuthenticatedRequest, @Body() dto: CategoryDto) { return this.catalog.saveCategory(req.user!, dto); }
  @Patch('categories/:id') @RequirePermission('catalog.write') updateCategory(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoryDto) { return this.catalog.saveCategory(req.user!, dto, id); }
  @Get('products') @RequirePermission('catalog.read') products(@Req() req: AuthenticatedRequest, @Query('search') search?: string, @Query('categoryId') categoryId?: string, @Query('status') status?: string, @Query('page') page?: string) { return this.catalog.products(req.user!, { search, categoryId, status, page }); }
  @Post('products') @RequirePermission('catalog.write') createProduct(@Req() req: AuthenticatedRequest, @Body() dto: ProductDto) { return this.catalog.saveProduct(req.user!, dto); }
  @Patch('products/:id') @RequirePermission('catalog.write') updateProduct(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProductDto) { return this.catalog.saveProduct(req.user!, dto, id); }
  @Get('inventory/balances') @RequirePermission('inventory.read') balances(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outletId: string, @Query('search') search?: string, @Query('page') page?: string) { return this.inventory.balances(req.user!, outletId, search, page); }
  @Get('inventory/movements') @RequirePermission('inventory.read') movements(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outletId: string, @Query('page') page?: string) { return this.inventory.movements(req.user!, outletId, page); }
  @Post('inventory/opening') @RequirePermission('inventory.opening') opening(@Req() req: AuthenticatedRequest, @Body() dto: OpeningStockDto) { return this.inventory.opening(req.user!, dto); }
  @Patch('inventory/threshold') @RequirePermission('inventory.threshold') threshold(@Req() req: AuthenticatedRequest, @Body() dto: ThresholdDto) { return this.inventory.threshold(req.user!, dto); }
  @Get('audit-logs') @RequirePermission('audit.read') logs(@Req() req: AuthenticatedRequest, @Query('page') page?: string) { return this.organization.logs(req.user!, page); }
}
